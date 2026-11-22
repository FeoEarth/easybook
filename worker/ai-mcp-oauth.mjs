import {boundedJSON,hash} from './mcp-common.mjs';

const callbackPath='/api/ai/mcp/oauth/callback';
const authorizePath='/api/ai/mcp/oauth/authorize';
const ttl=10*60*1000;
const statePattern=/^[a-f0-9]{64}$/;
const identityStatePrefix='ea1db00c';
export const isIdentityMcpOAuthState=state=>statePattern.test(state||'')&&state.startsWith(identityStatePrefix);
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const invalid=(code='mcp_oauth_failed',status=400)=>Object.assign(Error(code),{code,status});
// Notion and other Workers OAuth Provider servers use three colon-delimited token segments.
const bearerToken=/^[a-zA-Z0-9._~+/=-]+(?::[a-zA-Z0-9._~+/=-]+){0,2}$/;

async function json(url,options,{fetcher,safeUrl,checkHost},errorCode='mcp_oauth_failed'){
 url=safeUrl(url);
 const signal=AbortSignal.timeout(10000);
 await checkHost(url,fetcher,signal);
 let response;
 try{response=await fetcher(url,{...options,redirect:'manual',signal})}
 catch{throw invalid(errorCode,502)}
 if(!response.ok){
  void response.body?.cancel().catch(()=>{});
  throw Object.assign(invalid(errorCode),{upstreamStatus:response.status});
 }
 try{return await boundedJSON(response,32000)}
 catch{throw invalid(errorCode==='mcp_oauth_token_failed'?'mcp_oauth_token_format':errorCode,502)}
}

async function discover(resource,context){
 const {safeUrl,checkHost,fetcher}=context;
 const signal=AbortSignal.timeout(10000);
 await checkHost(resource,fetcher,signal);
 // Explicit Parallel login is a protected connection even if the endpoint also
 // answers anonymous MCP probes. Never infer OAuth support from a normal MCP
 // response for other servers; the resource metadata must still validate.
 const parallelLogin=resource.href==='https://mcp.parallel.ai/mcp?login';
 let probe;
 try{probe=await fetcher(resource,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Easybook',version:'1.0'}}})})}
 catch{if(!parallelLogin)throw invalid('mcp_unreachable',502)}
 const challenge=probe?.headers.get('WWW-Authenticate')||'';
 if(probe)void probe.body?.cancel().catch(()=>{});
 if(!parallelLogin&&probe?.status!==401&&probe?.status!==403)throw invalid('mcp_oauth_unavailable');
 const advertised=challenge.match(/\bresource_metadata\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s,]+))/i);
 const metadataHint=advertised?.[1]||advertised?.[2]||advertised?.[3];
 const resourceMetadata=[
  ...(metadataHint?[metadataHint]:[]),
  // Parallel's ?login resource is distinct from its anonymous MCP endpoint.
  // Preserve the exact query when discovering its metadata without a challenge.
  ...(parallelLogin?[resource.origin+'/.well-known/oauth-protected-resource'+resource.pathname.replace(/\/$/,'')+resource.search]:[]),
  resource.origin+'/.well-known/oauth-protected-resource'+resource.pathname.replace(/\/$/,''),
  resource.origin+'/.well-known/oauth-protected-resource'
 ];
 let protectedResource;
 for(const url of resourceMetadata){
  try{protectedResource=await json(url,{},context);break}catch{}
 }
 if(!protectedResource)throw invalid('mcp_oauth_unavailable');
 const audience=safeUrl(protectedResource.resource);
 const unqualifiedResource=new URL(resource.href);unqualifiedResource.search='';
  if(audience.href!==resource.href&&audience.href!==unqualifiedResource.href&&audience.href!==resource.origin+'/')throw invalid('mcp_oauth_unavailable');
 const issuer=safeUrl(protectedResource.authorization_servers?.[0]);
 const suffix=issuer.pathname.replace(/\/$/,'');
 let as;
 for(const url of [issuer.origin+'/.well-known/oauth-authorization-server'+suffix,issuer.origin+suffix+'/.well-known/openid-configuration']){
  try{as=await json(url,{},context);break}catch{}
 }
 if(!as||as.issuer!==protectedResource.authorization_servers[0]||!as.code_challenge_methods_supported?.includes('S256'))throw invalid('mcp_oauth_unavailable');
 const advertisedScopes=challenge.match(/\bscope="([^"]+)"/i)?.[1]?.split(/\s+/).filter(Boolean)||[];
 const resourceScopes=Array.isArray(protectedResource.scopes_supported)?protectedResource.scopes_supported.filter(scope=>typeof scope==='string'&&/^[!-~]{1,160}$/.test(scope)):[];
 const scopes=advertisedScopes.length?(resourceScopes.length?advertisedScopes.filter(scope=>resourceScopes.includes(scope)):advertisedScopes):resourceScopes;
 if(advertisedScopes.length&&resourceScopes.length&&!scopes.length)throw invalid('mcp_oauth_scope_mismatch');
 const scope=[...new Set(scopes)].join(' ');
 const authorizationEndpoint=safeUrl(as.authorization_endpoint);
 await checkHost(authorizationEndpoint,fetcher,signal);
 return {resource:protectedResource.resource,authorizationEndpoint:authorizationEndpoint.href,issuer:as.issuer,
  requireIssuer:as.authorization_response_iss_parameter_supported===true,
  tokenEndpoint:safeUrl(as.token_endpoint).href,registrationEndpoint:as.registration_endpoint||'',scope,
  clientAuthMethods:Array.isArray(as.token_endpoint_auth_methods_supported)?as.token_endpoint_auth_methods_supported:['none'],
  // Missing grant_types_supported does not advertise refresh-token support.
  // Register an authorization-code web client; refresh only when advertised.
  refresh:Array.isArray(as.grant_types_supported)&&as.grant_types_supported.includes('refresh_token')};
}

const setup=new WeakMap();
function schema(db){
 let ready=setup.get(db);
 if(!ready){
  ready=db.prepare(`CREATE TABLE IF NOT EXISTS account_ai_mcp_oauth_flows(
   state_hash TEXT PRIMARY KEY,id TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
   key_ciphertext TEXT,key_iv TEXT,expires_at INTEGER NOT NULL,status TEXT NOT NULL,origin TEXT NOT NULL
  )`).run().catch(error=>{setup.delete(db);throw error});
  setup.set(db,ready);
 }
 return ready;
}
async function flow(env,request){
 const url=new URL(request.url),state=url.searchParams.get('state')||'';
 if(!statePattern.test(state))throw invalid();
 await schema(env.DB);
 const stateHash=await hash(state);
 const row=await env.DB.prepare('SELECT * FROM account_ai_mcp_oauth_flows WHERE state_hash=? AND expires_at>? AND origin=?').bind(stateHash,Date.now(),url.origin).first();
 if(!row)throw invalid();
 return {url,row,stateHash};
}

export async function beginMcpOAuth(env,request,account,input,context){
 const {safeUrl,seal}=context;
 if(typeof input.label!=='string'||!input.label.trim()||input.label.trim().length>60||
    typeof (input.clientId??'')!=='string'||(input.clientId||'').length>512)throw invalid('mcp_invalid_config');
 const origin=new URL(request.url).origin;
 if(!origin.startsWith('https://'))throw invalid('mcp_oauth_https');
 const resource=safeUrl(input.url),metadata=await discover(resource,context);
 const redirectUri=origin+callbackPath;
 let clientId=input.clientId?.trim(),clientSecret='',clientAuth='none';
 if(!clientId){
  if(!metadata.registrationEndpoint)throw invalid('mcp_oauth_client_required');
  clientAuth=['none','client_secret_post','client_secret_basic'].find(method=>metadata.clientAuthMethods.includes(method));
  if(!clientAuth)throw invalid('mcp_oauth_client_required');
  const client=await json(metadata.registrationEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   client_name:'Easybook',application_type:'web',redirect_uris:[redirectUri],token_endpoint_auth_method:clientAuth,
   grant_types:metadata.refresh?['authorization_code','refresh_token']:['authorization_code'],response_types:['code']
  })},context,'mcp_oauth_registration_failed');
  if(typeof client.client_id!=='string'||!client.client_id||client.client_id.length>512||
     (client.token_endpoint_auth_method&&client.token_endpoint_auth_method!==clientAuth))throw invalid('mcp_oauth_registration_failed');
  clientId=client.client_id;
  // Some registrars include a secret even when reporting a public client.
  if(clientAuth!=='none'){
   if(typeof client.client_secret!=='string'||!client.client_secret||client.client_secret.length>4096)throw invalid('mcp_oauth_registration_failed');
   clientSecret=client.client_secret;
  }
 }else if(!metadata.clientAuthMethods.includes('none'))throw invalid('mcp_oauth_client_required');
 const verifier=encode(crypto.getRandomValues(new Uint8Array(48)));
 const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 const randomState=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const state=context.identityWorker?identityStatePrefix+randomState.slice(identityStatePrefix.length):randomState;
 const id=crypto.randomUUID();
 const authorization=new URL(metadata.authorizationEndpoint);
 for(const [key,value] of Object.entries({response_type:'code',client_id:clientId,redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:'S256',state,resource:metadata.resource,scope:metadata.scope})){
  if(value)authorization.searchParams.set(key,value);
 }
 const config={label:input.label.trim(),url:resource.href,resource:metadata.resource,tokenEndpoint:metadata.tokenEndpoint,issuer:metadata.issuer,requireIssuer:metadata.requireIssuer,clientId,clientAuth,clientSecret,redirectUri,verifier,authorization:authorization.href,reconnectId:input.id||'',reconnectRevision:input.reconnectRevision||'',builtin:input.builtin==='parallel'?'parallel':''};
 const wrapped=await seal(env,account,id,JSON.stringify(config));
 await schema(env.DB);
 await env.DB.prepare('DELETE FROM account_ai_mcp_oauth_flows WHERE expires_at<=?').bind(Date.now()).run();
 const created=await env.DB.prepare(`INSERT INTO account_ai_mcp_oauth_flows(state_hash,id,account_id,key_ciphertext,key_iv,expires_at,status,origin)
  SELECT ?,?,?,?,?,?,'pending',? WHERE (SELECT COUNT(*) FROM account_ai_mcp_oauth_flows WHERE account_id=? AND status IN ('pending','processing'))<5 RETURNING id`)
  .bind(await hash(state),id,account,wrapped.ciphertext,wrapped.iv,Date.now()+ttl,origin,account).first();
 if(!created)throw invalid('mcp_oauth_pending_limit',429);
 return {state,authorizationUrl:origin+authorizePath+'?state='+state,expiresIn:ttl/1000};
}

export async function mcpOAuthStatus(env,request,account){
 const {row}=await flow(env,request);
 if(row.account_id!==account)throw invalid();
 return {status:row.status};
}

function completion(message,status){
 return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});
}

async function exchange(config,params,context){
 const body=new URLSearchParams({...params,resource:config.resource}),headers={};
 if(config.clientAuth==='client_secret_basic'){
  const formEncode=value=>new URLSearchParams({value}).toString().slice(6);
  headers.Authorization='Basic '+btoa(formEncode(config.clientId)+':'+formEncode(config.clientSecret));
 }else{
  body.set('client_id',config.clientId);
  if(config.clientAuth==='client_secret_post')body.set('client_secret',config.clientSecret);
 }
 const result=await json(config.tokenEndpoint,{method:'POST',headers,body},context,'mcp_oauth_token_failed');
 if(typeof result?.access_token!=='string'||result.access_token.length>16000||!bearerToken.test(result.access_token)||
    typeof result.token_type!=='string'||result.token_type.toLowerCase()!=='bearer'||
    (result.refresh_token!=null&&(typeof result.refresh_token!=='string'||result.refresh_token.length>16000)))throw invalid('mcp_oauth_token_format');
 return {accessToken:result.access_token,refreshToken:result.refresh_token||config.refreshToken||'',
  expiresAt:Number.isFinite(result.expires_in)&&result.expires_in>=0?Date.now()+result.expires_in*1000:0};
}

function logCallbackIssue(stage,error){
 const code=typeof error?.code==='string'&&/^mcp_[a-z_]{1,64}$/.test(error.code)?error.code:'unclassified';
 const phase=['resolve','initialize','notifications/initialized','tools/list'].includes(error?.phase)?error.phase:undefined;
 const upstreamStatus=Number.isSafeInteger(error?.upstreamStatus)?error.upstreamStatus:undefined;
 const rpcCode=Number.isSafeInteger(error?.rpcCode)?error.rpcCode:undefined;
 console.warn(JSON.stringify({event:'mcp_oauth_callback_issue',stage,code,phase,upstreamStatus,rpcCode}));
}

export async function handleMcpOAuth(request,env,context){
 try{
  const {url,row,stateHash}=await flow(env,request);
  if(row.status!=='pending')throw invalid();
  const config=JSON.parse(await context.open(env,row));
  if(url.pathname===authorizePath)return new Response(null,{status:303,headers:{Location:config.authorization,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  const changed=await env.DB.prepare("UPDATE account_ai_mcp_oauth_flows SET status='processing',key_ciphertext=NULL,key_iv=NULL WHERE state_hash=? AND status='pending' RETURNING id").bind(stateHash).first();
  if(!changed)throw invalid();
  let status='failed',stage='callback';
  try{
   const code=url.searchParams.get('code'),issuer=url.searchParams.get('iss');
   if(issuer&&issuer!==config.issuer)throw invalid('mcp_oauth_issuer_mismatch');
   if(url.searchParams.get('error'))status='denied';
   else if(code&&code.length<=4000){
    if(config.requireIssuer&&!issuer)throw invalid('mcp_oauth_issuer_mismatch');
    stage='token';
    const tokens=await exchange(config,{grant_type:'authorization_code',code,code_verifier:config.verifier,redirect_uri:config.redirectUri},context);
    const secret=JSON.stringify({kind:'oauth',tokenEndpoint:config.tokenEndpoint,clientId:config.clientId,clientAuth:config.clientAuth,clientSecret:config.clientSecret,url:config.url,resource:config.resource,...tokens});
    stage='save';
    const result=await context.save(env,row.account_id,config,tokens.accessToken,secret,request.signal);
    status=result.status;
    if(result.error)logCallbackIssue('tools',result.error);
   }
  }catch(error){
   const code=error?.code;
   status=['mcp_oauth_issuer_mismatch','mcp_oauth_token_failed','mcp_oauth_token_format','mcp_changed','mcp_server_limit'].includes(code)?code:
    stage==='token'?'mcp_oauth_token_failed':stage==='save'?'mcp_oauth_save_failed':'failed';
   logCallbackIssue(stage,error);
  }
  await env.DB.prepare('UPDATE account_ai_mcp_oauth_flows SET status=? WHERE state_hash=?').bind(status,stateHash).run();
  const message={
   connected:'授权完成，请返回 Easybook。',
   tools_pending:'授权已保存，暂时未能读取工具。请返回 Easybook，在对应服务器旁点击「刷新」。',
   mcp_oauth_save_failed:'服务方授权成功，但 Easybook 未能保存连接。请返回 Easybook 重试。',
   denied:'已取消授权，请返回 Easybook。',
   mcp_oauth_token_format:'服务方返回的令牌格式无效。请返回 Easybook 查看授权结果。',
   mcp_oauth_token_failed:'服务方未接受授权码。请返回 Easybook 重新授权。',
   mcp_auth_failed:'服务方已授权，但 MCP 服务器拒绝了令牌。请返回 Easybook 查看授权结果。'
  }[status]||'授权未完成。请返回 Easybook 查看授权结果。';
  return completion(message,status==='connected'||status==='tools_pending'?200:400);
 }catch{return completion('授权请求已失效，请返回 Easybook 重新连接。',400)}
}

const refreshes=new Map();
export async function mcpAccessToken(env,row,context){
 if(!row.key_ciphertext)return '';
 const value=await context.open(env,row);
 if(!value.startsWith('{'))return value;
 const config=JSON.parse(value);
 if(config.kind!=='oauth')throw invalid();
 if(!config.expiresAt||config.expiresAt>Date.now()+30000)return config.accessToken;
 if(!config.refreshToken)throw invalid('mcp_oauth_reconnect',401);
 const key=row.account_id+':'+row.id;
 if(!refreshes.has(key))refreshes.set(key,(async()=>{
  const tokens=await exchange(config,{grant_type:'refresh_token',refresh_token:config.refreshToken},context);
  const wrapped=await context.seal(env,row.account_id,row.id,JSON.stringify({...config,...tokens}));
  const change=await env.DB.prepare('UPDATE account_ai_mcp_servers SET key_ciphertext=?,key_iv=? WHERE id=? AND account_id=? AND key_ciphertext=? RETURNING id')
   .bind(wrapped.ciphertext,wrapped.iv,row.id,row.account_id,row.key_ciphertext).first();
  if(!change)throw invalid('mcp_changed',409);
  return tokens.accessToken;
 })().finally(()=>refreshes.delete(key)));
 return refreshes.get(key);
}
