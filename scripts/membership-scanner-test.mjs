import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {deriveAddress,membershipAPI} from '../worker/membership.mjs';
import {planCatalog} from '../worker/membership-pricing.mjs';
import {scanMembership} from '../worker/membership-scanner.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'membership-restart-')),filename=join(dir,'test.sqlite');
let f=await fixture({filename});
try{
 const env={...f.env,MEMBERSHIP_NETWORKS:JSON.stringify(JSON.parse(f.env.MEMBERSHIP_NETWORKS).filter(c=>c.chainId===137))};
 const c=JSON.parse(env.MEMBERSHIP_NETWORKS)[0];
 // The scanner consumes the current account-address ownership ledger, not retired orders.
 for(let i=1;i<=130;i++)f.sql.prepare('INSERT INTO membership_address_owners VALUES(?,?,?,?)').run(i,deriveAddress(env.MEMBERSHIP_XPUB,i+2),f.account,Date.now());
 const last={chain_id:137,token:c.token.toLowerCase(),amount:'10000',address:deriveAddress(env.MEMBERSHIP_XPUB,132)};
 const log=f.inject(last);
 let calls=0;const flaky=async(...args)=>{const q=JSON.parse(args[1].body);if(q.method==='eth_getLogs'&&++calls===2)throw Error('Interrupted after first address batch');return f.fetcher(...args)};
 await scanMembership(env,{fetcher:flaky});
 assert.equal(f.sql.prepare('SELECT last_address_id FROM membership_scan_windows WHERE chain_id=137').get().last_address_id,64);
 assert.equal(f.sql.prepare('SELECT block FROM membership_cursors WHERE chain_id=137').get().block,100);
 f.close();f=await fixture({filename});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_scan_windows WHERE chain_id=137').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_receipts WHERE tx=?').get(log.transactionHash).n,1);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_balance_events WHERE tx=? AND kind='credit'").get(log.transactionHash).n,1);
 f.sql.prepare('UPDATE membership_cursors SET block=100 WHERE chain_id=137').run();await f.scan();
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_receipts WHERE tx=?').get(log.transactionHash).n,1);
 const {HDKey}=await import('@scure/bip32');
 await assert.rejects(()=>fixture({filename,wallet:{xpub:HDKey.fromMasterSeed(new Uint8Array(32).fill(9)).publicExtendedKey,minOrderIndex:3}}),/different wallet/);
 console.log('PASS bounded address batches, durable restart, ledger credit replay and wallet isolation');
}finally{f.close();rmSync(dir,{recursive:true,force:true})}
const g=await fixture();
try{
 const priceVersion=(await planCatalog(g.env)).priceVersion;
 const call=(path,body,env=g.env)=>membershipAPI(new Request(g.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:g.cookie,Origin:g.origin,'Content-Type':'application/json','X-Easybook-CSRF':g.csrf},...(body?{body:JSON.stringify(body)}:{})}),env);
 const body=()=>({plan:'month',chainId:137,priceVersion,idempotency:crypto.randomUUID()});
 for(let i=0;i<10;i++){const response=await call('/orders',body());assert.equal(response.status,201,await response.clone().text());const order=await response.json();const cancelled=await call('/orders/'+order.id+'/cancel',{});assert.ok(cancelled.ok,await cancelled.clone().text())}
 assert.equal((await call('/orders',body())).status,429);
 assert.equal((await call('',undefined,{...g.env,MEMBERSHIP_ADDRESS_OFFSET:'10'})).status,409);
 console.log('PASS current checkout rate limit and persisted wallet/offset guard');
}finally{g.close()}
