import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
// Only the platform base class is substituted. The actual pinned OAuth Provider runs unchanged.
const hook=registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};return next(specifier,context)}});
globalThis.Cloudflare={compatibilityFlags:{global_fetch_strictly_public:true}};
const {default:worker,provider}=await import('../mcp-oauth/src/index.mjs');hook.deregister();
import {accountRoutes,finishLogin,session,csrf,policyFor} from '../mcp-oauth/src/accounts.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {attestMcpWorkspace} from '../worker/mcp-pairing.mjs';
const sqlite=new DatabaseSync(':memory:');
for(const p of ['worker/schema.sql','mcp-oauth/migrations/0001_workspace_grants.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','worker/migrations/0008-mcp-capabilities.sql','worker/migrations/0009-mcp-uploads.sql'])sqlite.exec(readFileSync(p,'utf8'));
sqlite.exec(readFileSync('mcp-oauth/migrations/0002_accounts.sql','utf8')); // Retryable.
const DB={prepare(sql){const q=sqlite.prepare(sql);let params=[];return {bind(...p){params=p;return this},async first(){return q.get(...params)||null},async all(){return {results:q.all(...params)}},async run(){return q.run(...params)}}},async batch(stmts){sqlite.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.all());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const kv=new Map();
const OAUTH_KV={async get(k,options){const v=kv.get(k);return v===undefined?null:options==='json'||options?.type==='json'?JSON.parse(v):v},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)},async list({prefix='',limit=1000}={}){return {keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(name=>({name})),list_complete:true,cursor:''}}};
const env={DB,OAUTH_KV,MCP_PAIRING_SIGNING_KEY:'synthetic-test-only-signing-key-123456789',GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret'},ctx={waitUntil(p){p.catch(()=>{})}};
const origin='https://easybook-mcp-oauth.1902521952.workers.dev',resource=origin+'/mcp';
const cookies=new Map();
function save(response){for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}}
const cookieHeader=()=>[...cookies].map(([k,v])=>k+'='+v).join('; ');
async function request(path,options={}){const r=new Request(origin+path,{...options,headers:{Cookie:cookieHeader(),...(options.headers||{})}});const response=await worker.fetch(r,env,ctx);save(response);return response;}
async function form(path,data={},headers={}){const req=new Request(origin+path,{headers:{Cookie:cookieHeader()}});const s=await session(req,env);return request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({csrf:await csrf(req,s),...data})});}
assert.equal((await request('/account')).status,200);
const start=await request('/account/login');assert.equal(start.status,303);const state=new URL(start.headers.get('Location')).searchParams.get('state');
const callback=new Request(origin+'/callback?state='+state+'&code=synthetic-code',{headers:{Cookie:cookieHeader(),'User-Agent':'Synthetic test browser'}});
const fetchIdentity=async url=>Response.json(String(url).includes('access_token')?{access_token:'never-persist-this-upstream-token'}:{id:123456789,type:'User',login:'Synthetic'});
const login=await finishLogin(callback,env,fetchIdentity);assert.equal(login.status,303);save(login);assert.match(login.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
assert.equal((await finishLogin(callback,env,fetchIdentity)).status,400,'login state single use');
const s=await session(new Request(origin,{headers:{Cookie:cookieHeader()}}),env);assert.ok(s.account_id!==String(123456789));
assert.equal((await form('/account/profile',{name:'CSRF fail'},{Origin:'https://evil.example'})).status,403);
const page=await (await request('/account')).text();const challenge=page.match(/name="challenge" value="([a-f0-9]{64})"/)[1];
const workspace='a'.repeat(64),other='b'.repeat(64);
const proof=await (await attestMcpWorkspace(new Request(origin+'/attest',{method:'POST',body:JSON.stringify({challenge})}),env,workspace)).json();
assert.equal((await form('/account/workspaces/claim',{challenge,assertion:proof.assertion+'x'})).status,403);
assert.equal((await form('/account/workspaces/claim',{challenge,assertion:proof.assertion})).status,303);
assert.equal((await form('/account/workspaces/claim',{challenge,assertion:proof.assertion})).status,409);
const register=await request('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Synthetic MCP',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(register.status,201);const client=await register.json();
const verifier='V'.repeat(64);const challengeS256=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
const authURL=()=>'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'https://client.example/callback',scope:'workspace.read notes.read',state:'synthetic-state',code_challenge:challengeS256,code_challenge_method:'S256',resource});
async function authorize(workspaceId=workspace){const consent=await request(authURL());assert.equal(consent.status,200);const html=await consent.text();const handle=html.match(/name="handle" value="([^"]+)"/)[1];return form('/oauth/authorize',{handle,workspace:workspaceId,scope:'notes.read',decision:'allow'});}
assert.equal((await authorize(other)).status,403,'cannot authorize unowned workspace');
const completed=await authorize();assert.equal(completed.status,303);const code=new URL(completed.headers.get('Location')).searchParams.get('code');
async function token(data){return request('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,resource,...data})});}
const exchange=await token({grant_type:'authorization_code',code,redirect_uri:'https://client.example/callback',code_verifier:verifier});assert.equal(exchange.status,200,await exchange.clone().text());let tokens=await exchange.json();assert.equal(tokens.scope,'notes.read');assert.equal(tokens.expires_in,300);
async function rpc(access,method,params={}){return request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
assert.equal((await rpc(tokens.access_token,'initialize')).status,200);
const denied=await (await rpc(tokens.access_token,'tools/call',{name:'notes_create',arguments:{title:'Must not write',text:'x'}})).json();assert.ok(denied.result.isError,'read token cannot write');
const resourceDenied=await (await rpc(tokens.access_token,'resources/read',{uri:'easybook://folders'})).json();assert.ok(resourceDenied.error,'resource scopes enforced');
// Simulate a client disconnect/provider interruption before rotation: same refresh token
// must remain usable when the client retries instead of being consumed by D1.
const {guardTokens}=await import('../mcp-oauth/src/token-guard.mjs');
const refreshRequest=()=>new Request(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id,resource})});
await assert.rejects(guardTokens(refreshRequest(),env,ctx,{fetch:async()=>{throw Error('simulated refresh interruption')}}),/simulated refresh interruption/);
const newTokensResponse=await token({grant_type:'refresh_token',refresh_token:tokens.refresh_token});assert.equal(newTokensResponse.status,200,await newTokensResponse.clone().text());const rotated=await newTokensResponse.json();assert.notEqual(rotated.refresh_token,tokens.refresh_token);
// The pinned Provider intentionally allows one previous token for lost-response retries.
const retriedResponse=await token({grant_type:'refresh_token',refresh_token:tokens.refresh_token});assert.equal(retriedResponse.status,200,await retriedResponse.clone().text());const retried=await retriedResponse.json();assert.notEqual(retried.refresh_token,rotated.refresh_token);
assert.equal((await rpc(retried.access_token,'initialize')).status,200,'retry must preserve authorized access');
const staleResponse=await token({grant_type:'refresh_token',refresh_token:rotated.refresh_token});assert.equal(staleResponse.status,400,'tokens outside current/previous rotation window must be denied');
assert.equal((await rpc(retried.access_token,'initialize')).status,200,'refresh retry must not revoke the grant');
const second=await authorize(),code2=new URL(second.headers.get('Location')).searchParams.get('code');
const bad=await token({grant_type:'authorization_code',code:code2,redirect_uri:'https://client.example/callback',code_verifier:'X'.repeat(64)});assert.equal(bad.status,400,'PKCE mismatch denied');
const third=await authorize(),code3=new URL(third.headers.get('Location')).searchParams.get('code');
const fresh=await token({grant_type:'authorization_code',code:code3,redirect_uri:'https://client.example/callback',code_verifier:verifier});tokens=await fresh.json();assert.ok(tokens.access_token);
assert.equal((await token({grant_type:'authorization_code',code:code3,redirect_uri:'https://client.example/callback',code_verifier:verifier})).status,400,'code cannot be exchanged twice');
assert.equal((await rpc(tokens.access_token,'initialize')).status,403);
const fourth=await authorize(),code4=new URL(fourth.headers.get('Location')).searchParams.get('code');tokens=await (await token({grant_type:'authorization_code',code:code4,redirect_uri:'https://client.example/callback',code_verifier:verifier})).json();
const revoke=await request('/oauth/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token,client_id:client.client_id})});assert.equal(revoke.status,200);assert.ok([401,403].includes((await rpc(tokens.access_token,'initialize')).status),'RFC revocation immediately denies access');
assert.equal((await rpc('foreign-service-token','initialize')).status,401);
const metadata=await (await request('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.authorization_endpoint,origin+'/authorize');assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
assert.equal((await request('/.well-known/oauth-protected-resource')).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM notes_json').get().n,0,'no real or synthetic private note read or written');
if(process.env.EASYBOOK_ACCOUNT_UI==='1'){
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});
 try{for(const [name,path]of [['account','/account'],['consent',authURL()]]){
  const content=await (await request(path)).text();const context=await browser.newContext({viewport:{width:360,height:740}});const page=await context.newPage();
  for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});await page.setContent(content);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Account UI must fit 360px');await page.screenshot({path:'account-ui-'+name+'-'+theme+'.png',fullPage:true});}
  await context.close();
 }}finally{await browser.close()}
}
assert.equal((await form('/account/sessions/revoke',{id:s.id})).status,303);assert.equal(await session(new Request(origin,{headers:{Cookie:cookieHeader()}}),env),null);
console.log('PASS: real pinned OAuth Provider; account login/state/cookies/CSRF, migration retry, signed claim/replay, workspace isolation, PKCE/code replay, refresh rotation/cancel retry, scopes/resources, immediate revocation, foreign token, metadata, device revoke. No private notes.');
