import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI,deriveAddress} from '../worker/membership.mjs';
import {membershipPage} from '../worker/membership-page.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {scanMembership} from '../worker/membership-scanner.mjs';
const f=await fixture();
const request=(path,body,headers={})=>new Request(f.origin+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf,...headers},...(body?{body:JSON.stringify(body)}:{})});
const api=(path,body,headers)=>membershipAPI(request('/api/membership'+path,body,headers),f.env);
async function order(chainId=137,plan='month',key=crypto.randomUUID()){const response=await api('/orders',{chainId,plan,idempotency:key});assert.ok([200,201].includes(response.status),await response.clone().text());return response.json()}
try{
 assert.equal((await api('/plans')).status,200);
 assert.equal((await membershipAPI(new Request(f.origin+'/api/membership'),f.env)).status,401);
 assert.equal((await api('/orders',{chainId:137,plan:'month',idempotency:crypto.randomUUID()},{'X-Easybook-CSRF':'bad'})).status,403);
 assert.equal((await api('/orders',{chainId:137,plan:'month',idempotency:crypto.randomUUID()},{Origin:'https://evil.test'})).status,403);
 assert.equal((await membershipAPI(new Request('https://public.example/api/membership/plans'),f.env)).status,403);
 await assert.rejects(()=>scanMembership(f.env),/injected local RPC/);
 const key=crypto.randomUUID();const [a,b]=await Promise.all([order(137,'month',key),order(137,'month',key)]);assert.equal(a.id,b.id,'concurrent idempotency');
 assert.equal((await api('/orders',{chainId:137,plan:'year',idempotency:key})).status,409);
 assert.equal(a.address,deriveAddress(f.env.MEMBERSHIP_XPUB,3),'first order must skip account 1–3');
 assert.equal((await order()).id,a.id,'reuse pending plan/network');
 const page=await membershipPage(request('/membership'),f.env);const html=await page.text();assert.match(html,/模拟支付测试，请勿转账/);
 const qr=await membershipPage(request('/membership?qr='+a.id),f.env);assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
 const otherToken=crypto.randomUUID();f.sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run('other','Other',Date.now());f.sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run('other-session',await hash('other-native'),'other',Date.now(),Date.now()+100000,Date.now(),'Other');f.sql.prepare('INSERT INTO membership_web_sessions VALUES(?,?,?)').run(await hash(otherToken),'other-session',Date.now()+100000);
 assert.equal((await api('/orders/'+a.id,undefined,{Cookie:'__Host-easybook-membership='+otherToken})).status,404);
 const log=f.inject(a);await f.scan();assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes').get().n,1);
 await f.scan();assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes').get().n,1);
 // Real log repeated in another scanner run remains one receipt and one entitlement.
 f.sql.prepare('UPDATE membership_cursors SET block=? WHERE chain_id=137').run(Number(BigInt(log.blockNumber))-1);await f.scan();assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes').get().n,1);
 for(const chainId of [43114,9745,42161]){const o=await order(chainId);f.inject(o);await f.scan();}
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_changes').get().n,4);
 const late=await order(137,'half-year');f.sql.prepare('UPDATE membership_orders SET expires_at=0 WHERE id=?').run(late.id);f.inject(late,{amount:'9999'});await f.scan();assert.equal(f.sql.prepare('SELECT settled_at FROM membership_orders WHERE id=?').get(late.id).settled_at,null);
 f.inject(late);await f.scan();assert.ok(f.sql.prepare('SELECT settled_at FROM membership_orders WHERE id=?').get(late.id).settled_at);
 const outage=await order(137,'year');const before=f.sql.prepare('SELECT block FROM membership_cursors WHERE chain_id=137').get().block;f.inject(outage);f.setFailure(true);await f.scan();assert.equal(f.sql.prepare('SELECT block FROM membership_cursors WHERE chain_id=137').get().block,before);f.setFailure(false);await f.scan();assert.ok(f.sql.prepare('SELECT settled_at FROM membership_orders WHERE id=?').get(outage.id).settled_at);
 const permanent=await order(137,'permanent');f.inject(permanent);await f.scan();assert.equal((await (await api('')).json()).permanent,true);assert.equal((await api('/orders',{chainId:137,plan:'month',idempotency:crypto.randomUUID()})).status,409);
 f.sql.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').run(Date.now(),f.sessionId);assert.equal((await api('')).status,401);
 f.sql.prepare('UPDATE account_sessions SET revoked_at=NULL WHERE id=?').run(f.sessionId);f.sql.prepare('UPDATE membership_web_sessions SET expires_at=0 WHERE session_id=?').run(f.sessionId);assert.equal((await api('')).status,401);
 // Android's initial native-only request yields a scoped, HttpOnly browser session.
 const native=await membershipPage(new Request(f.origin+'/membership',{headers:{Authorization:'Easybook-Session '+f.nativeToken}}),f.env);assert.equal(native.status,200);assert.match(native.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);const scoped=native.headers.get('Set-Cookie').split(';')[0];assert.equal((await api('',undefined,{Cookie:scoped})).status,200);
 f.sql.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').run(Date.now(),f.account);assert.equal((await api('',undefined,{Cookie:scoped})).status,401);
 console.log('PASS membership API, scoped native session, four-chain mocked scanner, replay, outage and account isolation');
}finally{f.close()}
