import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const entry=`
import {aiAPI,aiMcpOAuthPage} from './worker/ai.mjs';
export default {async fetch(request,env){
 const resource='https://tools.example.net/mcp',issuer='https://login.example.net',origin='https://easybook.test';
 const malformed=new URL(request.url).searchParams.has('malformed');
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
  if(p.method==='tools/list')return Response.json({jsonrpc:'2.0',id:p.id,result:{tools:[{name:'read',inputSchema:{type:'object'}}]}});
  return new Response(null,{status:202});
 };
 const req=(path,body)=>new Request(origin+path,{method:body?'PUT':'GET',body:body&&JSON.stringify(body)});
 const principal={kind:'account',accountId:'synthetic'};
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)').run();
 await env.DB.prepare("INSERT OR IGNORE INTO accounts VALUES ('synthetic')").run();
 const begin=await aiAPI(req('/api/ai/mcp',{oauth:true,label:'test',url:resource}),env,principal,{fetcher:fixture});
 const setup=await begin.json();
 if(!begin.ok)return Response.json({begin:setup,steps});
 const callback=await aiMcpOAuthPage(req('/api/ai/mcp/oauth/callback?state='+setup.state+'&code=synthetic-code'),env,{fetcher:fixture});
 const status=await aiAPI(req('/api/ai/mcp',{oauthState:setup.state}),env,principal,{fetcher:fixture});
 return Response.json({callback:callback.status,body:await status.json(),steps});
}};
`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',external:['node:*'],target:'es2022'});
const runtime=new Miniflare(convertV4MiniflareOptions({
 name:"oauth-test",modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-23',
 compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],
 bindings:{AI_CREDENTIAL_KEY:'a'.repeat(64)},d1Databases:['DB']
}));
try{
 const result=await (await runtime.dispatchFetch('https://dev.test/')).json();
 assert.equal(result.callback,200,JSON.stringify(result));
 assert.deepEqual(result.body,{status:'connected'});
 assert.ok(result.steps.some(([name,type,hasCode])=>name==='token-form'&&type.startsWith('application/x-www-form-urlencoded')&&hasCode));
 const malformed=await (await runtime.dispatchFetch('https://dev.test/?malformed')).json();
 assert.equal(malformed.callback,400);
 assert.deepEqual(malformed.body,{status:'mcp_oauth_token_format'});
 assert.equal(malformed.steps.filter(([step,method])=>step==='/mcp'&&method==='POST').length,1,'an invalid token never reaches the MCP resource');
 console.log('PASS OAuth callback, token exchange and MCP catalog save inside the Workers runtime');
}finally{await runtime.dispose()}
