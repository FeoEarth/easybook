import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {deriveAddress,membershipAPI} from '../worker/membership.mjs';
import {membershipPage} from '../worker/membership-page.mjs';
import {scanMembership} from '../worker/membership-scanner.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'membership-restart-')),filename=join(dir,'test.sqlite');
let f=await fixture({filename});
try{
 const env={...f.env,MEMBERSHIP_NETWORKS:JSON.stringify(JSON.parse(f.env.MEMBERSHIP_NETWORKS).filter(c=>c.chainId===137))};
 const c=JSON.parse(env.MEMBERSHIP_NETWORKS)[0];
 for(let i=1;i<=130;i++){
 const id=crypto.randomUUID();f.sql.prepare('INSERT INTO membership_addresses(order_id) VALUES(?)').run(id);
 f.sql.prepare('INSERT INTO membership_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').run(id,f.account,'month',1,137,c.token.toLowerCase(),'10000',deriveAddress(env.MEMBERSHIP_XPUB,i+2),id,Date.now(),Date.now()+1800000);
 }
 const last=f.sql.prepare('SELECT o.* FROM membership_orders o JOIN membership_addresses a ON a.order_id=o.id ORDER BY a.id DESC LIMIT 1').get();f.inject(last);
 let calls=0;const flaky=async(...args)=>{const q=JSON.parse(args[1].body);if(q.method==='eth_getLogs'&&++calls===2)throw Error('Interrupted after first address batch');return f.fetcher(...args)};
 await scanMembership(env,{fetcher:flaky});
 assert.equal(f.sql.prepare('SELECT last_address_id FROM membership_scan_windows WHERE chain_id=137').get().last_address_id,64);
 assert.equal(f.sql.prepare('SELECT block FROM membership_cursors WHERE chain_id=137').get().block,100);
 f.close();f=await fixture({filename}); // New process-equivalent RPC and DB handles resume the checkpoint.
 assert.ok(f.sql.prepare('SELECT settled_at FROM membership_orders WHERE id=?').get(last.id).settled_at);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_scan_windows WHERE chain_id=137').get().n,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes WHERE order_id=?').get(last.id).n,1);
 // A mismatching wallet cannot reinterpret addresses in an existing fixture.
 const {HDKey}=await import('@scure/bip32');
 await assert.rejects(()=>fixture({filename,wallet:{xpub:HDKey.fromMasterSeed(new Uint8Array(32).fill(9)).publicExtendedKey,minOrderIndex:3}}),/different wallet/);
 const page=await membershipPage(new Request(f.origin+'/membership',{headers:{Cookie:f.cookie}}),{...f.env,MEMBERSHIP_SIMULATION:'false'});const html=await page.text();assert.match(html,/收款地址二维码/);assert.doesNotMatch(html,/模拟支付测试，请勿转账/);
 const qr=await membershipPage(new Request(f.origin+'/membership?qr='+last.id,{headers:{Cookie:f.cookie}}),{...f.env,MEMBERSHIP_SIMULATION:'false'});assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
 console.log('PASS bounded address batches, durable restart, wallet isolation and real QR rendering');
}finally{f.close();rmSync(dir,{recursive:true,force:true})}
const g=await fixture();
try{
 const req=(plan,chainId)=>new Request(g.origin+'/api/membership/orders',{method:'POST',headers:{Cookie:g.cookie,Origin:g.origin,'Content-Type':'application/json','X-Easybook-CSRF':g.csrf},body:JSON.stringify({plan,chainId,idempotency:crypto.randomUUID()})});
 const combos=['month','half-year','year','permanent'].flatMap(p=>[137,43114,9745,42161].map(c=>[p,c]));
 for(const [p,c] of combos.slice(0,10))assert.equal((await membershipAPI(req(p,c),g.env)).status,201);
 assert.equal((await membershipAPI(req(...combos[10]),g.env)).status,429);
 // Changing wallet settings after an order exists fails closed.
 const fake={...g.env,MEMBERSHIP_ADDRESS_OFFSET:'10'};
 // Existing pending orders remain readable; new plan/network allocation must be rejected.
 g.sql.exec('UPDATE membership_orders SET created_at=0');
 assert.equal((await membershipAPI(req(...combos[10]),fake)).status,409);
 console.log('PASS order rate limit and persisted wallet/offset guard');
}finally{g.close()}
