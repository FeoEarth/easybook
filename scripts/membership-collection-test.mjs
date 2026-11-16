// Offline integration scenario. No mainnet RPC, real keys, or real broadcasts.
import assert from 'node:assert/strict';
import {HDKey} from '@scure/bip32';
import {Transaction} from 'ethers';
import {fixture} from './membership-fixture.mjs';
import {ensureWallet} from '../worker/membership-ledger.mjs';
import {runCollections} from '../collection-worker/index.mjs';
const f=await fixture();
try {
 const root=HDKey.fromMasterSeed(new Uint8Array(32).fill(7)).derive("m/44'/60'/0'/0");
 const owned=await ensureWallet(f.env,f.account),chain=JSON.parse(f.env.MEMBERSHIP_NETWORKS).find(c=>c.chainId===137);
 const target='0x'+'9'.repeat(40),blockHash='0x'+'8'.repeat(64),raws=new Map(),confirmed=new Set();
 const env={...f.env,MEMBERSHIP_NETWORKS:JSON.stringify([chain]),COLLECTION_TREASURY:target,COLLECTION_ENABLED:'false',COLLECTION_XPRV:root.privateExtendedKey};
 const currentNonce=from=>BigInt([...raws.values()].filter(raw=>{const tx=Transaction.from(raw);return tx.from.toLowerCase()===from.toLowerCase()&&confirmed.has(tx.hash)}).length);
 const fetcher=async(url,options={})=>{
  if(String(url).startsWith('https://api.coingecko.com/'))return Response.json({'polygon-ecosystem-token':{usd:1,last_updated_at:Math.floor(Date.now()/1000)}});
  assert.equal(url,chain.rpc);const q=JSON.parse(options.body);let result;
  const swept=[...confirmed].some(hash=>Transaction.from(raws.get(hash)).to.toLowerCase()===chain.token.toLowerCase());
  if(q.method==='eth_chainId')result='0x89';
  else if(q.method==='eth_getBlockByNumber')result={number:'0x64',hash:blockHash};
  else if(q.method==='eth_call')result='0x'+(swept?0n:25000000n).toString(16);
  else if(q.method==='eth_getCode')result='0x';
  else if(q.method==='eth_gasPrice')result='0x3b9aca00';
  else if(q.method==='eth_estimateGas')result=q.params[0].data?'0xea60':'0x5208';
  else if(q.method==='eth_getBalance'){const who=q.params[0].toLowerCase();let balance=10n**18n;if(who===owned.address.toLowerCase()){balance=0n;for(const hash of confirmed){const tx=Transaction.from(raws.get(hash));if(tx.to.toLowerCase()===who)balance+=tx.value}}result='0x'+balance.toString(16)}
  else if(q.method==='eth_getTransactionCount'){const from=q.params[0],base=currentNonce(from),inFlight=[...raws.values()].some(raw=>{const tx=Transaction.from(raw);return tx.from.toLowerCase()===from.toLowerCase()&&!confirmed.has(tx.hash)});result='0x'+(base+(q.params[1]==='pending'&&inFlight?1n:0n)).toString(16)}
  else if(q.method==='eth_sendRawTransaction'){const tx=Transaction.from(q.params[0]);raws.set(tx.hash,q.params[0]);result=tx.hash}
  else if(q.method==='eth_getTransactionReceipt'){const hash=q.params[0];if(!confirmed.has(hash))result=null;else{const tx=Transaction.from(raws.get(hash)),token=tx.to.toLowerCase()===chain.token.toLowerCase();result={status:'0x1',blockNumber:'0x64',blockHash,logs:token?[{address:chain.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+tx.from.slice(2).toLowerCase().padStart(64,'0'),'0x'+target.slice(2).padStart(64,'0')],data:'0x'+tx.data.slice(-64)}]:[]}}}
  else throw Error('Unexpected RPC method '+q.method);
  return Response.json({jsonrpc:'2.0',id:q.id,result});
 };
 const tick=async()=>{f.sql.exec('UPDATE membership_collection_lease SET expires_at=0; UPDATE membership_collection_jobs SET next_attempt_at=0');return runCollections(env,{fetcher,chainId:137})};
 await tick();assert.equal(raws.size,0);assert.equal(f.sql.prepare('SELECT state FROM membership_collection_jobs').get().state,'paused');
 env.COLLECTION_ENABLED='true';await tick();assert.equal(raws.size,1);const gas=f.sql.prepare("SELECT * FROM membership_collection_tx WHERE kind='gas'").get();assert.ok(gas);
 await tick();assert.equal(raws.size,1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_collection_tx WHERE kind='gas'").get().n,1);
 confirmed.add(gas.hash);await tick();await tick();const sweep=f.sql.prepare("SELECT * FROM membership_collection_tx WHERE kind='sweep'").get();assert.ok(sweep);assert.equal(raws.size,2);
 confirmed.add(sweep.hash);await tick();assert.equal(f.sql.prepare('SELECT state FROM membership_collection_jobs').get().state,'completed');
 assert.equal(f.sql.prepare('SELECT units FROM membership_balances WHERE account_id=?').get(f.account).units,'0');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes').get().n,0);
 console.log('PASS disabled guard, fee preflight, persisted nonce/hash, identical rebroadcast, finality, token log and no customer-ledger mutation');
} finally { f.close() }
