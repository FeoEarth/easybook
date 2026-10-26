import assert from 'node:assert/strict';
import {chromium,devices} from 'playwright';
import {registerHooks} from 'node:module';
import {env,sql,a,id} from './core-workspace-release-test.mjs';
import main from '../worker/index.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {oauthConsentHeaders} from '../mcp-oauth/src/appearance.mjs';
import {csrf,requireForm,page,redirect} from '../mcp-oauth/src/accounts.mjs';
const hooks=registerHooks({resolve(name,context,next){if(name==='cloudflare:workers')return {url:'data:text/javascript,export class WorkerEntrypoint {}',shortCircuit:true};return next(name,context)}});
globalThis.Cloudflare={compatibilityFlags:{global_fetch_strictly_public:true}};
const {default:oauth}=await import('../mcp-oauth/src/index.mjs');hooks.deregister();
const kv=new Map();env.OAUTH_KV={async get(k,o){const v=kv.get(k);return v===undefined?null:o==='json'||o?.type==='json'?JSON.parse(v):v},async put(k,v){kv.set(k,v)},async delete(k){kv.delete(k)},async list({prefix=''}){return {keys:[...kv.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true,cursor:''}}};
const ctx={waitUntil(p){p.catch(()=>{})}};env.IDENTITY_SERVICE={fetch:r=>oauth.fetch(r,env,ctx)};
const origin='https://easybook.loonxy.com',token='c'.repeat(64),sid=crypto.randomUUID(),now=Date.now();sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(sid,await hash(token),a.id,now,now+3600000,now,'Mobile browser form fixture');
assert.equal(page('test','').headers.get('Referrer-Policy'),'same-origin');assert.equal(redirect('/account').headers.get('Referrer-Policy'),'no-referrer');
const cookie='__Host-easybook-session='+token,s={id:sid},csrfValue=await csrf(new Request(origin,{headers:{Cookie:cookie}}),s);
for(const value of [undefined,'null','https://evil.example']){const h={Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'};if(value!==undefined)h.Origin=value;await assert.rejects(()=>requireForm(new Request(origin+'/oauth/authorize',{method:'POST',headers:h,body:new URLSearchParams({csrf:csrfValue})}),s),e=>e instanceof Response&&e.status===403)}
await assert.rejects(()=>requireForm(new Request(origin+'/oauth/authorize',{method:'POST',headers:{Cookie:cookie,Origin:origin},body:'csrf=wrong'}),s),e=>e instanceof Response&&e.status===403);
assert.match(oauthConsentHeaders('https://client.example/callback')['Content-Security-Policy'],/form-action 'self' https:\/\/client.example;/);for(const url of ['javascript:alert(1)','data:text/html,test','https://evil.example;bad/callback'])assert.throws(()=>oauthConsentHeaders(url));
const browser=await chromium.launch({headless:true});
try{for(const legacy of [true,false]){
 const registration=await main.fetch(new Request(origin+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Mobile origin regression',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']})}),env);assert.equal(registration.status,201);const client=await registration.json(),verifier='V'.repeat(64),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const authorize=origin+'/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'https://client.example/callback',scope:'workspace.read notes.read',state:crypto.randomUUID(),code_challenge:challenge,code_challenge_method:'S256',resource:origin+'/mcp'});
 const context=await browser.newContext({...devices['Pixel 7'],serviceWorkers:'block'});await context.addCookies([{name:'__Host-easybook-session',value:token,domain:'easybook.loonxy.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);let submittedOrigin,submitStatus,callbackReferer;
 await context.route('**/*',async route=>{const q=route.request(),headers=await q.allHeaders();if(q.url().startsWith('https://client.example/')){callbackReferer=headers.referer;await route.fulfill({status:200,body:'OAuth callback received'});return}assert.ok(q.url().startsWith(origin));if(q.method()==='POST'&&new URL(q.url()).pathname==='/oauth/authorize')submittedOrigin=headers.origin;
 const response=await main.fetch(new Request(q.url(),{method:q.method(),headers,body:['GET','HEAD'].includes(q.method())?undefined:q.postDataBuffer()}),env);const out=Object.fromEntries(response.headers);if(legacy&&q.method()==='GET'&&new URL(q.url()).pathname==='/oauth/authorize')out['referrer-policy']='no-referrer';if(q.method()==='POST'&&new URL(q.url()).pathname==='/oauth/authorize')submitStatus=response.status;await route.fulfill({status:response.status,headers:out,body:Buffer.from(await response.arrayBuffer())});});
 const p=await context.newPage();await p.goto(authorize);await p.locator('input[name=workspace][value="'+id+'"]').check();await p.getByRole('button',{name:'允许所选范围',exact:true}).click();
 if(legacy){await p.getByText('Origin not allowed',{exact:true}).waitFor();assert.equal(submittedOrigin,'null');assert.equal(submitStatus,403);console.log('PASS reproduced original bug: real Android Chromium form sends Origin:null with no-referrer');}
 else{assert.equal(submittedOrigin,origin);assert.equal(submitStatus,303);await p.waitForURL('https://client.example/callback?**');assert.equal(submittedOrigin,origin);assert.equal(submitStatus,303);assert.equal(callbackReferer,undefined);const code=new URL(p.url()).searchParams.get('code');assert.ok(code);const exchanged=await main.fetch(new Request(origin+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'https://client.example/callback',resource:origin+'/mcp'})}),env);assert.equal(exchanged.status,200,await exchanged.clone().text());assert.ok((await exchanged.json()).access_token);console.log('PASS real mobile consent click, exact Origin, CSRF, cookie-bound consent, PKCE exchange and no callback Referer leak');}
 await context.close();
}}finally{await browser.close()}
console.log('PASS foreign/null/missing Origin and invalid CSRF remain denied');
