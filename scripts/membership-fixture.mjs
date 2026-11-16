// Node-only local harness. This module is never imported by deployed Workers.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {HDKey} from '@scure/bip32';
import {localConfig} from './membership-local-config.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {scanMembership} from '../worker/membership-scanner.mjs';
export async function fixture({filename=':memory:',wallet,origin='https://membership.test'}={}){
 const sql=new DatabaseSync(filename);sql.exec('PRAGMA foreign_keys=ON');
 const fresh=!sql.prepare("SELECT 1 FROM sqlite_master WHERE name='accounts'").get();
 if(fresh)for(const file of ['mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','mcp-oauth/migrations/0004_native_identity.sql','worker/migrations/0022-web-accounts.sql','worker/migrations/0023-membership.sql','worker/migrations/0024-membership-scan-windows.sql','worker/migrations/0025-membership-job-lease.sql','worker/migrations/0026-membership-account-wallets.sql','worker/migrations/0027-membership-payment-method.sql','worker/migrations/0028-membership-duration-only.sql','worker/migrations/0029-membership-collections.sql'])sql.exec(readFileSync(file,'utf8'));
 const DB={prepare(query){const statement=sql.prepare(query);let params=[];return {bind(...p){params=p;return this},first(){return statement.get(...params)||null},all(){return {results:statement.all(...params)}},run(){return statement.run(...params)}}},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(s.all());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 wallet ||= {xpub:HDKey.fromMasterSeed(new Uint8Array(32).fill(7)).derive("m/44'/60'/0'/0").publicExtendedKey,minOrderIndex:3};
 const env={DB,...localConfig(wallet),PUBLIC_ORIGIN:origin,IDENTITY_CANONICAL_V2:'true'},account='local-membership-user',sessionId='local-membership-session',token=crypto.randomUUID()+crypto.randomUUID(),nativeToken='ab'.repeat(32),now=Date.now();
 sql.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?,?,NULL)').run(account,'本地测试账户',now);
 sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL').run(sessionId,await hash(nativeToken),account,now,now+86400000,now,'Membership local fixture');
 sql.prepare('INSERT OR IGNORE INTO account_native_sessions VALUES(?,?)').run(sessionId,now);
 sql.prepare('INSERT INTO membership_web_sessions VALUES(?,?,?)').run(await hash(token),sessionId,now+86400000);
 if(!fresh){const prior=sql.prepare('SELECT xpub FROM fixture_wallet WHERE id=1').get();if(prior.xpub!==wallet.xpub){sql.close();throw Error('Local database belongs to a different wallet; use a fresh fixture database')}}
 if(fresh){
 sql.exec('CREATE TABLE fixture_wallet(id INTEGER PRIMARY KEY,xpub TEXT NOT NULL)');sql.prepare('INSERT INTO fixture_wallet VALUES(1,?)').run(wallet.xpub);
 sql.exec('CREATE TABLE fixture_rpc_logs(chain_id INTEGER,body TEXT); CREATE TABLE fixture_rpc_heads(chain_id INTEGER PRIMARY KEY,block INTEGER NOT NULL);');
 }
 const configs=JSON.parse(env.MEMBERSHIP_NETWORKS);
 for(const c of configs)sql.prepare('INSERT OR IGNORE INTO fixture_rpc_heads VALUES(?,100)').run(c.chainId);
 let failed=false;
 const fetcher=async(url,options)=>{
 if(failed)throw Error('Simulated RPC outage');
 if(!url.startsWith('https://rpc.simulation.invalid/'))throw Error('Harness forbids real RPC');
 const chainId=Number(new URL(url).pathname.slice(1)),q=JSON.parse(options.body),head=sql.prepare('SELECT block FROM fixture_rpc_heads WHERE chain_id=?').get(chainId).block;let result;
 if(q.method==='eth_chainId')result='0x'+chainId.toString(16);
 else if(q.method==='eth_getBlockByNumber')result={number:'0x'+head.toString(16)};
 else if(q.method==='eth_getLogs'){
 const f=q.params[0];if(!Array.isArray(f.topics?.[2])||!f.topics[2].length)throw Error('Unfiltered scan forbidden');
 result=sql.prepare('SELECT body FROM fixture_rpc_logs WHERE chain_id=?').all(chainId).map(r=>JSON.parse(r.body)).filter(log=>Number(BigInt(log.blockNumber))>=Number(BigInt(f.fromBlock))&&Number(BigInt(log.blockNumber))<=Number(BigInt(f.toBlock))&&log.address.toLowerCase()===f.address.toLowerCase()&&f.topics[2].includes(log.topics[2]));
 }else throw Error('Unexpected RPC method');
 return Response.json({jsonrpc:'2.0',id:q.id,result});
 };
 const scan=()=>scanMembership(env,{fetcher});
 const cookie='__Host-easybook-membership='+token,csrf=await hash(token);
 const inject=(order,{amount=order.amount,tx='0x'+crypto.randomUUID().replaceAll('-','').repeat(2),removed=false}={})=>{
 const head=sql.prepare('UPDATE fixture_rpc_heads SET block=block+1 WHERE chain_id=? RETURNING block').get(order.chain_id).block;
 const log={address:order.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+order.address.slice(2).padStart(64,'0')],data:'0x'+BigInt(amount).toString(16).padStart(64,'0'),transactionHash:tx,logIndex:'0x0',blockNumber:'0x'+head.toString(16),removed};
 sql.prepare('INSERT INTO fixture_rpc_logs VALUES(?,?)').run(order.chain_id,JSON.stringify(log));return log;
 };
 await scan();return {sql,DB,env,origin,account,sessionId,nativeToken,cookie,csrf,scan,inject,fetcher,setFailure(value){failed=value},close(){sql.close()}};
}
