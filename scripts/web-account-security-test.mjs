import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webAccountRoutes,webSession} from '../mcp-oauth/src/web-sessions.mjs';
import {nativeAccountRoutes,nativeSession,s256} from '../mcp-oauth/src/native-sessions.mjs';
import {session,csrf,ACCOUNT_COOKIE} from '../mcp-oauth/src/accounts.mjs';
import {workspacePrincipal,workspaceAPI} from '../worker/workspace-api.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {publicOrigin,validateServerConfig,webCorsHeaders} from '../worker/server-config.mjs';

const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','mcp-oauth/migrations/0004_native_identity.sql','worker/migrations/0010-workspace-identity.sql','worker/migrations/0022-web-accounts.sql','mcp-oauth/migrations/0011_web_identity.sql'])sql.exec(readFileSync(file,'utf8'));
let beforeBatch=null;
const DB={prepare(query){const statement=sql.prepare(query);let params=[];return {bind(...p){params=p;return this},first(){return statement.get(...params)||null},all(){return {results:statement.all(...params)}},run(){return statement.run(...params)}}},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=null;hook()}sql.exec('BEGIN');try{const out=statements.map(s=>s.all());sql.exec('COMMIT');return out}catch(error){sql.exec('ROLLBACK');throw error}}};
const server='https://notes.example:9443',client='https://client.example',otherClient='https://other-client.example';
const env={DB,PUBLIC_ORIGIN:server,IDENTITY_CANONICAL_V2:'true',WORKSPACE_IDENTITY_V2:'true',WEB_CLIENT_ORIGINS:client+','+otherClient,WEB_CLIENT_REDIRECT_URIS:client+'/server-callback,'+otherClient+'/server-callback'};
const account=crypto.randomUUID(),browserId=crypto.randomUUID(),browserToken='b'.repeat(64),verifiedAt=Date.now()-60000;
sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(account,'Self-hosted account',Date.now());
sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(browserId,await hash(browserToken),account,Date.now(),Date.now()+86400000,verifiedAt,'Browser');
const cookie=ACCOUNT_COOKIE+'='+browserToken;
let ip=0;
async function call(path,{body,headers={},origin=client,requestOrigin=server,method=body?'POST':'GET'}={}){return webAccountRoutes(new Request(requestOrigin+path,{method,headers:{...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{}),'CF-Connecting-IP':'web-test-'+(++ip),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);}
async function start(overrides={},options={}){const verifier='V'.repeat(64),state='a'.repeat(64),input={challenge:await s256(verifier),state,redirect_uri:client+'/server-callback',...overrides};const r=await call('/account/web/start',{body:input,...options});assert.equal(r.status,200,await r.clone().text());return {...await r.json(),input,verifier};}
async function consent(flow,{decision='allow',csrfValue,origin=server,token=browserToken}={}){
 const request=new Request(server+'/account/web/authorize',{headers:{Cookie:ACCOUNT_COOKIE+'='+token}}),browser=await session(request,env);
 return webAccountRoutes(new Request(server+'/account/web/authorize',{method:'POST',headers:{Origin:origin,Cookie:ACCOUNT_COOKIE+'='+token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({flow:flow.flow,state:flow.input.state,csrf:csrfValue??await csrf(request,browser),decision})}),env);
}
async function approve(flow){const r=await consent(flow);assert.equal(r.status,303);const callback=new URL(r.headers.get('Location'));assert.equal(callback.origin,new URL(flow.input.redirect_uri).origin);assert.equal(callback.pathname,'/server-callback');assert.equal(callback.searchParams.get('server'),server);assert.equal(callback.searchParams.get('state'),flow.input.state);assert.match(callback.searchParams.get('code'),/^[a-f0-9]{64}$/);return {flow:flow.flow,code:callback.searchParams.get('code'),state:flow.input.state,verifier:flow.verifier,redirect_uri:flow.input.redirect_uri};}

try{
 assert.equal(publicOrigin({}),'https://easybook.loonxy.com');assert.equal(publicOrigin({PUBLIC_ORIGIN:'http://192.168.1.2:8080/'}),'http://192.168.1.2:8080');
 assert.throws(()=>publicOrigin({PUBLIC_ORIGIN:'https://notes.example/path'}));assert.throws(()=>validateServerConfig({PUBLIC_ORIGIN:server,WEB_CLIENT_REDIRECT_URIS:'https://evil.example/server-callback'}));
 assert.equal(webCorsHeaders(new Request(server,{headers:{Origin:client}}),env)['Access-Control-Allow-Origin'],client);
 assert.equal(webCorsHeaders(new Request(server,{headers:{Origin:'https://evil.example'}}),env)['Access-Control-Allow-Origin'],undefined);
 assert.equal((await call('/account/web/start',{body:{},origin:'https://evil.example'})).status,403);
 assert.equal((await call('/account/web/start',{body:{},origin:null})).status,403);
 assert.equal((await call('/account/web/start',{body:{challenge:'x',state:'a'.repeat(64),redirect_uri:client+'/server-callback'}})).status,400);
 assert.equal((await call('/account/web/start',{body:{challenge:await s256('V'.repeat(64)),state:'a'.repeat(64),redirect_uri:'https://evil.example/server-callback'}})).status,400);
 assert.equal((await call('/account/web/start',{body:{challenge:await s256('V'.repeat(64)),state:'a'.repeat(64),redirect_uri:client+'/server-callback?steal=1'}})).status,400);
 assert.equal((await call('/account/web/start',{method:'OPTIONS'})).status,204);
 assert.equal((await call('/account/web/start',{method:'OPTIONS',origin:'https://evil.example'})).status,403);
 const same=await start({redirect_uri:server+'/server-callback'},{origin:server});assert.equal(new URL(same.authorization_url).origin,server,'same-server callback is allowed by default');

 const pending=await start();assert.equal(pending.expires_in,300);assert.equal(new URL(pending.authorization_url).origin,server);
 const loginPage=await call('/account/web/authorize?flow='+pending.flow+'&state='+pending.input.state,{origin:null});assert.equal(loginPage.status,303);assert.match(loginPage.headers.get('Location'),/^\/account\/passkeys\?return=/);
 const page=await call('/account/web/authorize?flow='+pending.flow+'&state='+pending.input.state,{origin:null,headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/client\.example/);
 assert.equal((await consent(pending,{csrfValue:'bad'})).status,403);
 assert.equal((await consent(pending,{origin:client})).status,403);
 const proof=await approve(pending);
 const record=sql.prepare('SELECT * FROM account_web_logins WHERE id=?').get(pending.flow);assert.notEqual(record.code_hash,proof.code);assert.equal(record.challenge,await s256(proof.verifier));assert.ok(!JSON.stringify(record).includes(proof.verifier));
 for(const input of [{...proof,verifier:'X'.repeat(64)},{...proof,state:'c'.repeat(64)},{...proof,code:'d'.repeat(64)},{...proof,redirect_uri:otherClient+'/server-callback'}])assert.equal((await call('/account/web/token',{body:input})).status,400);
 assert.equal((await call('/account/web/token',{body:proof,origin:otherClient})).status,400);
 const exchange=await call('/account/web/token',{body:proof});assert.equal(exchange.status,200,await exchange.clone().text());assert.equal(exchange.headers.get('Set-Cookie'),null);
 const credentials=await exchange.json();assert.match(credentials.token,/^[a-f0-9]{64}$/);assert.equal(credentials.expires_in,604800);
 assert.equal(sql.prepare('SELECT authenticated_at FROM account_sessions WHERE id=?').get(credentials.session_id).authenticated_at,verifiedAt,'Web exchange inherits recent-auth timestamp');
 assert.equal((await call('/account/web/token',{body:proof})).status,400,'code is one-use');
 const auth={Authorization:'Easybook-Web '+credentials.token};
 const status=await call('/account/web/session',{headers:auth});assert.equal(status.status,200);assert.equal((await status.json()).account.id,account);
 assert.equal((await call('/account/web/session',{headers:auth,origin:otherClient})).status,401,'token is bound to client Origin');
 assert.equal((await call('/account/web/session',{headers:auth,origin:null})).status,401,'cross-origin Web session requires Origin');
 assert.equal(await webSession(new Request('https://other-server.example/account/web/session',{headers:{...auth,Origin:client}}),env),null,'wrong server origin rejected');
 assert.equal(await webSession(new Request('https://other-server.example/account/web/session',{headers:{...auth,Origin:client}}),{...env,PUBLIC_ORIGIN:'https://other-server.example'}),null,'copied session DB does not authorize another server');
 assert.equal(await session(new Request(server,{headers:{Cookie:ACCOUNT_COOKIE+'='+credentials.token}}),env),null,'Web token cannot be used as Cookie');
 assert.equal(await nativeSession(new Request(server,{headers:{Authorization:'Easybook-Session '+credentials.token}}),env),null,'Web token cannot become a native token');
 const principal=await workspacePrincipal(new Request(server+'/api/workspaces',{headers:{...auth,Origin:client}}),env);assert.equal(principal.accountId,account);
 const workspaceStatus=await workspaceAPI(new Request(server+'/api/workspaces/session',{headers:{...auth,Origin:client}}),env);assert.equal((await workspaceStatus.json()).signedIn,true);
 await assert.rejects(()=>workspacePrincipal(new Request(server+'/api/workspaces',{headers:{Origin:client,Authorization:'Easybook-Web '+'f'.repeat(64),Cookie:cookie}}),env),e=>e.code==='web_session_expired');
 try{await nativeAccountRoutes(new Request(server+'/account/native/start',{method:'POST',headers:{Origin:client,'X-Easybook-Native':'1','Content-Type':'application/json'},body:JSON.stringify({challenge:await s256(proof.verifier),state:proof.state})}),env);assert.fail('native Origin accepted')}catch(e){assert.equal(e.status,403)}
 const nativeId=crypto.randomUUID(),nativeToken='e'.repeat(64);sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(nativeId,await hash(nativeToken),account,Date.now(),Date.now()+86400000,verifiedAt,'Native');sql.prepare('INSERT INTO account_native_sessions VALUES(?,?)').run(nativeId,Date.now());
 assert.equal(await nativeSession(new Request(server+'/account/native/session',{headers:{Origin:client,Authorization:'Easybook-Session '+nativeToken}}),env),null,'CORS never turns native GET credentials into browser sessions');assert.ok(await nativeSession(new Request(server+'/account/native/session',{headers:{Authorization:'Easybook-Session '+nativeToken}}),env));

 const cancelled=await start(),denied=await consent(cancelled,{decision:'deny'}),deniedURL=new URL(denied.headers.get('Location'));assert.equal(deniedURL.searchParams.get('error'),'access_denied');assert.equal(deniedURL.searchParams.has('code'),false);
 const expired=await start(),expiredProof=await approve(expired);sql.prepare('UPDATE account_web_logins SET expires_at=0 WHERE id=?').run(expired.flow);assert.equal((await call('/account/web/token',{body:expiredProof})).status,400);
 const stale=await start();sql.prepare('UPDATE account_sessions SET authenticated_at=0 WHERE id=?').run(browserId);const reauth=await consent(stale);assert.equal(reauth.status,200);assert.equal(sql.prepare('SELECT approved_at FROM account_web_logins WHERE id=?').get(stale.flow).approved_at,null);sql.prepare('UPDATE account_sessions SET authenticated_at=? WHERE id=?').run(verifiedAt,browserId);
 const racing=await start(),racingProof=await approve(racing),count=sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n;
 beforeBatch=()=>sql.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').run(Date.now(),browserId);
 assert.equal((await call('/account/web/token',{body:racingProof})).status,400,'source revoked immediately before transaction cannot mint a session');assert.equal(sql.prepare('SELECT COUNT(*) n FROM account_sessions').get().n,count);
 sql.prepare('UPDATE account_sessions SET revoked_at=NULL WHERE id=?').run(browserId);
 const parallel=await start(),parallelProof=await approve(parallel);const answers=await Promise.all([call('/account/web/token',{body:parallelProof}),call('/account/web/token',{body:parallelProof})]);assert.deepEqual(answers.map(r=>r.status).sort(),[200,400],'simultaneous exchange mints exactly one token');
 const ready=await start(),revokedProof=await approve(ready);sql.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').run(Date.now(),browserId);assert.equal((await call('/account/web/token',{body:revokedProof})).status,400);sql.prepare('UPDATE account_sessions SET revoked_at=NULL WHERE id=?').run(browserId);
 // The same independent revocation and recovery checkpoint fences Web sessions.
 const security=new DatabaseSync(':memory:');security.exec(readFileSync('worker/security-migrations/0001-checkpoint.sql','utf8'));
 security.prepare("INSERT INTO security_state VALUES(1,'web-test','open',0,?)").run(Date.now());security.prepare('INSERT INTO security_installation VALUES(1,?)').run(Date.now());
 sql.exec(readFileSync('worker/migrations/0015-restore-state.sql','utf8'));sql.prepare("INSERT INTO security_restore_state VALUES(1,'web-test',?)").run(Date.now());
 const SECURITY_DB={prepare(query){const q=security.prepare(query);let p=[];return {bind(...args){p=args;return this},first(){return q.get(...p)||null}}}};
 const checkpointEnv={...env,SECURITY_CHECKPOINT_V2:'true',SECURITY_DB},sessionRequest=new Request(server+'/account/web/session',{headers:{...auth,Origin:client}});
 assert.ok(await webSession(sessionRequest,checkpointEnv));
 security.prepare("INSERT INTO security_revocations VALUES('session',?,?)").run(credentials.session_id,Date.now());assert.equal(await webSession(sessionRequest,checkpointEnv),null,'permanent external revocation applies to Web tokens');
 security.exec("UPDATE security_state SET mode='blocked' WHERE id=1");await assert.rejects(()=>webSession(sessionRequest,checkpointEnv),e=>e.status===503);security.close();
 assert.equal((await call('/account/web/logout',{body:{},headers:auth})).status,200);assert.equal((await call('/account/web/session',{headers:auth})).status,401);
 const insecure=await webAccountRoutes(new Request('http://192.168.1.2/account/web/start',{method:'POST',headers:{Origin:client,'Content-Type':'application/json'},body:'{}'}),{...env,PUBLIC_ORIGIN:'http://192.168.1.2'});assert.equal(insecure.status,403);assert.equal((await insecure.json()).error,'account_https_required');
 console.log('PASS Web account PKCE: real SQLite consent/CSRF/state/expiry, exact redirect and Origin binding, no Cookie/native/other-server credential reuse, one-use and parallel exchange, revoked-source race, inherited recent auth, logout, CORS, and HTTP account denial.');
}finally{sql.close();}
