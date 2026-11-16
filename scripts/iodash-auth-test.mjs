// Offline auth boundary checks. Does not enroll a production Passkey or use production bootstrap credentials.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {authRoutes,adminSession,requireAdmin,ORIGIN,RP_ID} from '../admin-worker/auth.mjs';
import {hash} from '../worker/mcp-common.mjs';
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync('admin-worker/migrations/0001-iodash-auth.sql','utf8'));
const AUTH_DB={prepare(query){const q=sql.prepare(query);let params=[];return {bind(...args){params=args;return this},first(){return q.get(...params)||null},all(){return {results:q.all(...params)}},run(){return q.run(...params)}}},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>s.all());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={AUTH_DB},password='isolated-bootstrap-fixture',pepper='isolated-test-pepper',salt=crypto.getRandomValues(new Uint8Array(32));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper+':'+password),{name:'PBKDF2'},false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);env.IODASH_BOOTSTRAP_CONFIG=JSON.stringify({salt:Buffer.from(salt).toString('base64url'),hash:Buffer.from(bits).toString('base64url'),pepper});
const request=(path,body,cookie='',csrf='',origin=ORIGIN)=>new Request(ORIGIN+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Iodash-Request':'1',Cookie:cookie,'X-Iodash-CSRF':csrf,'CF-Connecting-IP':'192.0.2.15'},...(body?{body:JSON.stringify(body)}:{})});
const call=async(...args)=>{try{return await authRoutes(request(...args),env)}catch(e){return Response.json({error:e.message},{status:e.status||503})}};
try{
 let state=await (await call('/auth/state')).json();assert.equal(state.initialized,false);assert.equal(state.authenticated,false);
 assert.equal((await call('/auth/bootstrap/options',{password:'incorrect'})).status,403);
 const p=await call('/auth/bootstrap/options',{password});assert.equal(p.status,200);const options=(await p.json()).options;assert.equal(options.rp.id,RP_ID);assert.equal(options.authenticatorSelection.userVerification,'required');assert.equal(options.authenticatorSelection.residentKey,'required');
 const challengeCookie=p.headers.get('Set-Cookie').split(';')[0];assert.match(p.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
 assert.equal((await call('/auth/bootstrap/verify',{response:{}},challengeCookie)).status,400);assert.equal(sql.prepare('SELECT claimed_at FROM iodash_bootstrap WHERE id=1').get().claimed_at,null);
 assert.equal((await (await call('/auth/bootstrap/verify',{response:{}},challengeCookie)).json()).error,'challenge_expired');
 assert.equal((await call('/auth/bootstrap/options',{password},'','', 'https://easybook.loonxy.com')).status,403);
 const admin='isolated-admin',credential='isolated-key-a',now=Date.now(),token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),digest=await hash(token),cookie='__Host-iodash-session='+token;
 sql.prepare('INSERT INTO iodash_admins(id,display_name,created_at) VALUES(?,?,?)').run(admin,'Fixture Admin',now);sql.prepare('UPDATE iodash_bootstrap SET claimed_at=?,admin_id=? WHERE id=1').run(now,admin);
 sql.prepare("INSERT INTO iodash_passkeys(id,admin_id,public_key,counter,transports,label,backed_up,created_at) VALUES(?,?,'AA',0,'[]','Fixture',0,?)").run(credential,admin,now);sql.prepare('INSERT INTO iodash_sessions VALUES(?,?,?,?,?,?)').run(digest,admin,credential,now,now,now+28800000);
 assert.equal((await call('/auth/bootstrap/options',{password})).status,409);
 assert.equal(await adminSession(request('/auth/state',undefined,'__Host-easybook-membership='+token),env),null);
 await assert.rejects(()=>requireAdmin(request('/api/coupons',{},cookie,'incorrect'),env,{mutation:true}),e=>e.status===403);
 await assert.rejects(()=>requireAdmin(request('/api/coupons',{},cookie,digest,'https://easybook.loonxy.com'),env,{mutation:true}),e=>e.status===403);
 assert.equal((await requireAdmin(request('/api/coupons',{},cookie,digest),env,{mutation:true})).admin_id,admin);
 assert.equal((await (await call('/auth/passkeys/revoke',{id:credential},cookie,digest)).json()).error,'last_passkey');assert.equal(sql.prepare('SELECT revoked_at FROM iodash_passkeys WHERE id=?').get(credential).revoked_at,null);
 sql.prepare("INSERT INTO iodash_passkeys(id,admin_id,public_key,counter,transports,label,backed_up,created_at) VALUES('isolated-key-b',?,'AA',0,'[]','Backup',0,?)").run(admin,now);
 assert.equal((await call('/auth/passkeys/revoke',{id:'isolated-key-b'},cookie,digest)).status,200);assert.ok(sql.prepare("SELECT revoked_at FROM iodash_passkeys WHERE id='isolated-key-b'").get().revoked_at);
 sql.prepare('UPDATE iodash_sessions SET authenticated_at=? WHERE token_hash=?').run(now-300001,digest);await assert.rejects(()=>requireAdmin(request('/api/passkeys',{},cookie,digest),env,{mutation:true,fresh:true}),e=>e.message==='reauth_required');
 sql.prepare('UPDATE iodash_sessions SET last_seen_at=? WHERE token_hash=?').run(now-1800001,digest);assert.equal(await adminSession(request('/auth/state',undefined,cookie),env),null);
 console.log('PASS independent cookies/origin/CSRF, failed bootstrap does not claim, challenge consumption, initialization closure, last-key protection and session freshness');
}finally{sql.close()}
