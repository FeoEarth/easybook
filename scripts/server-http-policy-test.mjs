import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {serveWithServerPolicy,serverCallback,selectedConnectOrigin,serverDocument,allowConnect} from '../worker/server-client.mjs';
import worker from '../worker/index.mjs';

const server='https://notes.example:9443',client='https://client.example';
const env={PUBLIC_ORIGIN:server,WORKSPACE_IDENTITY_V2:'true',IDENTITY_CANONICAL_V2:'true',WEB_CLIENT_ORIGINS:client,WEB_CLIENT_REDIRECT_URIS:client+'/server-callback',IDENTITY_SERVICE:{fetch(){return Response.json({ok:true})}}};
let handled=0;
const handle=async()=>{handled++;return Response.json({ok:true},{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'X-Unsafe'}})};
const serve=(url,options={},config=env,handler=handle)=>serveWithServerPolicy(new Request(url,options),config,handler);

const discovery=await serve(server+'/.well-known/easybook.json');const data=await discovery.json();
assert.equal(data.protocolVersion,1);assert.equal(data.serverOrigin,server);assert.equal(data.capabilities.accounts,true);assert.equal(data.capabilities.webConnector,true);assert.equal(data.capabilities.httpKeyOnly,false);assert.equal(handled,0);
assert.equal(discovery.headers.get('Access-Control-Allow-Origin'),'*','credential-free discovery remains public');
assert.equal((await (await serve(server+'/.well-known/easybook.json',{}, {...env,IDENTITY_SERVICE:undefined})).json()).capabilities.accounts,false);
assert.equal((await (await serve('https://alias.example/.well-known/easybook.json')).json()).capabilities.accounts,false,'aliases do not advertise another server identity');
const insecure=await (await serve('http://192.168.1.2:8080/.well-known/easybook.json',{}, {...env,PUBLIC_ORIGIN:'http://192.168.1.2:8080'})).json();
assert.equal(insecure.capabilities.sync,true);assert.equal(insecure.capabilities.keySync,true);assert.equal(insecure.capabilities.httpKeyOnly,true);assert.equal(insecure.capabilities.accounts,false);assert.equal(insecure.capabilities.webConnector,false);

for(const path of ['/api/notes','/api/workspaces','/account/web/token','/account/native/start']){
 const preflight=await serve(server+path,{method:'OPTIONS',headers:{Origin:client,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),client);assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
 const denied=await serve(server+path,{method:'OPTIONS',headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
}
assert.equal(handled,0,'preflights do not invoke an account or sync operation');
const allowed=await serve(server+'/api/notes',{headers:{Origin:client}});assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),client);assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'),null);assert.match(allowed.headers.get('Vary'),/Origin/);assert.equal(allowed.headers.get('Access-Control-Allow-Headers').includes('X-Unsafe'),false);
const disallowed=await serve(server+'/api/notes',{headers:{Origin:'https://evil.example'}});assert.equal(disallowed.headers.get('Access-Control-Allow-Origin'),null);assert.equal(disallowed.headers.get('Access-Control-Allow-Credentials'),null,'old wildcard and credential headers are removed');
const nativeRejected=await serve(server+'/account/native/start',{method:'POST',headers:{Origin:client,'Content-Type':'application/json'},body:'{}'},env,()=>Response.json({error:'native_request_required'},{status:403}));
assert.equal(nativeRejected.status,403);assert.equal((await nativeRejected.json()).error,'native_request_required','an allowed preflight does not authorize native operations');

for(const path of ['/account/web/start','/account/native/start','/oauth/authorize','/mcp']){
 const r=await serve('http://192.168.1.2:8080'+path,{}, {...env,PUBLIC_ORIGIN:'http://192.168.1.2:8080'});assert.equal(r.status,403);assert.equal((await r.json()).error,'account_https_required');
}
for(const scheme of ['Easybook-Web','Easybook-Session']){
 const r=await serve('http://192.168.1.2:8080/api/notes',{headers:{Authorization:scheme+' '+'a'.repeat(64)}},{...env,PUBLIC_ORIGIN:'http://192.168.1.2:8080'});assert.equal(r.status,403,scheme+' account token must be rejected before handling HTTP');
}
assert.equal((await serve('http://192.168.1.2:8080/api/notes',{headers:{Authorization:'Bearer '+'a'.repeat(64)}},{...env,PUBLIC_ORIGIN:'http://192.168.1.2:8080'})).status,200,'HTTP key synchronization remains available');

const policy="default-src 'none'; connect-src 'self'; script-src 'self';";
assert.equal(selectedConnectOrigin(new URL(server+'/?server_origin='+encodeURIComponent(client))),client);
for(const value of ['http://192.168.1.2','https://user:pass@notes.example','https://notes.example/path','https://notes.example/#bad','https://notes.example/?bad=1'])assert.equal(selectedConnectOrigin(new URL(server+'/?server_origin='+encodeURIComponent(value))),null);
const html='<meta http-equiv="Content-Security-Policy" content="'+policy+'">';
assert.match(serverDocument(html,new URL(server+'/?server_origin='+encodeURIComponent(client))),/connect-src 'self' https:\/\/client\.example;/);
assert.equal(allowConnect(policy,null),policy);
const actual=await worker.fetch(new Request(server+'/?server_origin='+encodeURIComponent(client)),env);
assert.match(actual.headers.get('Content-Security-Policy'),/connect-src [^;]*https:\/\/client\.example/);assert.match(await actual.text(),/connect-src [^;]*https:\/\/client\.example/,'both HTTP and meta CSP permit only the selected HTTPS origin');

const callback=serverCallback();assert.equal(callback.headers.get('Cache-Control'),'no-store');assert.equal(callback.headers.get('Referrer-Policy'),'no-referrer');assert.match(callback.headers.get('Content-Security-Policy'),/default-src 'none'/);
const source=(await callback.text()).match(/<script>([\s\S]*)<\/script>/)[1],flow='a'.repeat(64),state='b'.repeat(64),code='c'.repeat(64),events=[];
function run(query){const posted=[];runInNewContext(source,{URL,URLSearchParams,location:{search:'?'+new URLSearchParams(query)},history:{replaceState(...args){events.push(['history',...args])}},BroadcastChannel:class{constructor(name){this.name=name}postMessage(value){events.push(['message']);posted.push({channel:this.name,value})}close(){}},document:{getElementById(){return {textContent:''}}},window:{close(){}}});return posted;}
const posted=run({server,flow,state,code});assert.equal(posted.length,1);assert.equal(posted[0].channel,'easybook-server-login:'+flow);assert.deepEqual(JSON.parse(JSON.stringify(posted[0].value)),{type:'easybook-server-login',server,flow,state,code});assert.equal(events[0][0],'history');assert.equal(events[1][0],'message');
assert.equal(run({server:'http://192.168.1.2',flow,state,code}).length,0);assert.equal(run({server,flow:'bad',state,code}).length,0);assert.equal(run({server,flow,state,code:'bad'}).length,0);assert.equal(run({server,flow,state,error:'access_denied'})[0].value.error,'access_denied');
console.log('PASS server HTTP policy: discovery capabilities, exact CORS without credentials, native preflight isolation, HTTP key-only gates, selected-origin CSP, and cleared one-time BroadcastChannel callbacks.');
