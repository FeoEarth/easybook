import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const entry=`
import {aiAPI,aiMcpOAuthPage} from './worker/ai.mjs';
import {enrichWebSearchResults} from './worker/ai-web-sources.mjs';
export default {async fetch(request,env){
 const resource='https://tools.example.net/mcp',issuer='https://login.example.net',origin='https://easybook.test';
 const incoming=new URL(request.url);
 if(incoming.pathname==='/source-fixture'){
  const visits=[];
  const fetchSource=async (input,init)=>{
   const url=new URL(input);
   if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:url.searchParams.get('name')==='private.example.org'?'10.0.0.4':'93.184.216.34'}]});
   visits.push({url:url.href,accept:init.headers.Accept,redirect:init.redirect,headerCount:Object.keys(init.headers).length});
   if(url.hostname==='safe.example.org')return new Response(null,{status:302,headers:{Location:'https://private.example.org/wall'}});
   if(url.hostname==='unavailable.example.org')return new Response('Blocked',{status:403});
   if(url.pathname==='/old')return new Response(null,{status:302,headers:{Location:'/actual'}});
   const text='<html><head><meta property="article:published_time" content="2026-11-21"></head><body>'+
    '<aside><p>Cookie banners, repeated navigation descriptions and unrelated promotional announcements.</p></aside>'+
    '<main><article><p>The release includes a reproducible command and its expected results. These details are on the original page and absent from the search snippet.</p>'+
    '<p>The original documentation reports the date and the measured figures. Title &amp; excerpt should be treated as source material.</p></article></main></body></html>';
   return new Response(text,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  };
  const results=await enrichWebSearchResults([
   {title:'Documentation',url:'https://docs.example.org/old',description:'Index snippet'},
   {title:'Redirect',url:'https://safe.example.org/old'},
   {title:'Unavailable',url:'https://unavailable.example.org/start'}
  ],'original documentation',request.signal,fetchSource);
  return Response.json({results,visits});
 }
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
  // MCP settings now exposes read-only search usage, backed by the same D1
  // membership and quota tables that exist in the production database.
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS account_memberships(account_id TEXT PRIMARY KEY,permanent INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL DEFAULT 0)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS account_rate_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL)').run();
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
 const source=await get('/source-fixture');
 assert.match(source.results[0].pageText,/reproducible command/);
 assert.match(source.results[0].pageText,/Title & excerpt/);
 assert.doesNotMatch(source.results[0].pageText,/Cookie banners/);
 assert.equal(source.results[0].pageUrl,'https://docs.example.org/actual');
 assert.equal(source.results[0].publishedAt,'2026-11-21');
 assert.match(source.results[0].retrievedAtUtc,/Z$/);
 assert.equal(source.results[1].pageText,undefined);
 assert.equal(source.results[2].pageText,undefined);
 assert.ok(!source.visits.some(item=>item.url.includes('private.example.org')));
 assert.ok(source.visits.every(item=>item.headerCount===1&&item.redirect==='manual'));
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
 const usageResponse=await get('/servers');
 assert.deepEqual({tier:usageResponse.usage.webSearch.tier,used:usageResponse.usage.webSearch.used,limit:usageResponse.usage.webSearch.limit},{tier:'free',used:0,limit:15},'MCP GET returns read-only search usage');
 const saved=usageResponse.servers.find(server=>server.label==='needs-refresh');
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
