import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const entry=`
import {aiAPI,aiMcpOAuthPage} from './worker/ai.mjs';
export default {async fetch(request,env){
 const resource='https://tools.example.net/mcp',issuer='https://login.example.net',origin='https://easybook.test';
 const incoming=new URL(request.url);
 const malformed=incoming.searchParams.has('malformed'),failCatalog=incoming.searchParams.has('failCatalog');
 const catalogFormat=incoming.searchParams.get('catalog');
 const steps=[],accessToken='notion-user:oauth-grant:opaque-access-token';
 const returnedToken=malformed?accessToken+String.fromCharCode(13,10)+'X-Injected: yes':accessToken;
 const fixture=async(input,init)=>{
  const u=new URL(input);
  steps.push([u.pathname,init.method,init.signal instanceof AbortSignal]);
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
  if(u.pathname.includes('oauth-protected-resource'))return Response.json({resource,authorization_servers:[issuer]});
  if(u.pathname.includes('oauth-authorization-server'))return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',code_challenge_methods_supported:['S256']});
  if(u.pathname==='/register')return Response.json({client_id:'fixture'});
  if(u.pathname==='/token'){
   const tokenRequest=new Request(u,init);
   steps.push(['token-form',tokenRequest.headers.get('Content-Type'),(await tokenRequest.formData()).has('code')]);
   return Response.json({access_token:returnedToken,token_type:'bearer',refresh_token:'refresh-token'});
  }
  const p=JSON.parse(init.body),auth=new Headers(init.headers).get('Authorization');
  if(!auth)return new Response(null,{status:401});
  if(auth!=='Bearer '+accessToken)return new Response(null,{status:403});
  if(p.method==='initialize')return Response.json({jsonrpc:'2.0',id:p.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
  if(p.method==='tools/list'&&failCatalog)return new Response(null,{status:503});
  if(p.method==='tools/list'){
   const inputSchema={type:'object'};
   if(catalogFormat)inputSchema.properties={query:{type:'string',description:'a'.repeat(20000)}};
   const description=catalogFormat==='oversize'?'d'.repeat(4*1024*1024):catalogFormat?'d'.repeat(200000):'';
   const payload={jsonrpc:'2.0',id:p.id,result:{tools:[{name:'read',description,inputSchema}]}};
   if(catalogFormat==='event-stream')return new Response('data: '+JSON.stringify(payload)+String.fromCharCode(10,10),{headers:{'Content-Type':'text/event-stream'}});
   return Response.json(payload);
  }
  return new Response(null,{status:202});
 };
 const req=(path,body)=>new Request(origin+path,{method:body?'PUT':'GET',body:body&&JSON.stringify(body)});
 const principal={kind:'account',accountId:'synthetic'};
 if(incoming.pathname==='/setup'){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)').run();
  await env.DB.prepare("INSERT OR IGNORE INTO accounts VALUES ('synthetic')").run();
  return aiAPI(req('/api/ai/mcp',{oauth:true,label:incoming.searchParams.get('label')||'test',url:resource}),env,principal,{fetcher:fixture});
 }
 const state=incoming.searchParams.get('state');
 if(incoming.pathname==='/callback'){
  const result=await aiMcpOAuthPage(req('/api/ai/mcp/oauth/callback?state='+state+'&code=synthetic-code'),env,{fetcher:fixture});
  return Response.json({status:result.status,message:await result.text(),steps});
 }
 if(incoming.pathname==='/status')return aiAPI(req('/api/ai/mcp',{oauthState:state}),env,principal,{fetcher:fixture});
 const id=incoming.searchParams.get('id');
 return aiAPI(req('/api/ai/mcp',id?{id,refresh:true}:undefined),env,principal,{fetcher:fixture});
}};
`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*'],target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({
 name:"oauth-test",modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-23',
 compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],
 bindings:{AI_CREDENTIAL_KEY:'a'.repeat(64)},d1Databases:['DB']
}));
try{
 const get=async path=>(await runtime.dispatchFetch('https://dev.test'+path)).json();
 const begin=async label=>(await get('/setup?label='+label)).state;
 const state=await begin('ordinary');
 const result=await get('/callback?state='+state);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.deepEqual(await get('/status?state='+state),{status:'connected'});
 assert.ok(result.steps.some(([name,type,hasCode])=>name==='token-form'&&type.startsWith('application/x-www-form-urlencoded')&&hasCode));

 const malformedState=await begin('malformed');
 const malformed=await get('/callback?state='+malformedState+'&malformed');
 assert.equal(malformed.status,400);
 assert.deepEqual(await get('/status?state='+malformedState),{status:'mcp_oauth_token_format'});
 assert.equal(malformed.steps.filter(([step,method])=>step==='/mcp'&&method==='POST').length,0,'an invalid token never reaches the MCP resource');

 const pendingState=await begin('needs-refresh');
 const pending=await get('/callback?state='+pendingState+'&failCatalog');
 assert.equal(pending.status,200);
 assert.match(pending.message,/授权已保存/);
 assert.deepEqual(await get('/status?state='+pendingState),{status:'tools_pending'});
 const saved=(await get('/servers')).servers.find(server=>server.label==='needs-refresh');
 assert.ok(saved.authenticated);
 assert.deepEqual(saved.tools,[]);
 for(const format of ['json','event-stream']){
  assert.deepEqual(await get('/servers?id='+saved.id+'&catalog='+format),{ok:true},
   'refresh accepts large '+format+' tool lists using the grant already saved');
 }
 const oversized=await get('/servers?id='+saved.id+'&catalog=oversize');
 assert.equal(oversized.error,'mcp_response_too_large');
 assert.deepEqual((await get('/servers')).servers.find(server=>server.id===saved.id).tools,['read']);
 console.log('PASS Workers OAuth requests, token validation and tool refresh after the OAuth grant is saved');
}finally{await runtime.dispose()}
