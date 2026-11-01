import {requireRestoreAccess} from '../../worker/security-checkpoint.mjs';
import {modernWorkspaces,V2_SCOPES} from '../../worker/oauth-workspace-policy.mjs';
import {IDENTITY_ORIGIN,LEGACY_IDENTITY_ORIGIN,identityEnabled} from '../../worker/identity-origin.mjs';
import {nativeAccountRoutes} from './native-sessions.mjs';
import {grantClient} from '../../worker/account-grants.mjs';
import OAuthProvider, {OAuthError} from '@cloudflare/workers-oauth-provider';
import {accountRoutes,accountAuthorize,policyFor,rateLimit,SCOPES} from './accounts.mjs';
import {guardTokens} from './token-guard.mjs';
import {uploadHTTP} from '../../worker/mcp-uploads.mjs';
import { mcp } from '../../worker/mcp.mjs';
import {mcpHealth} from '../../worker/mcp-health.mjs';
import {boundedJSON,object,validate,schema,str} from '../../worker/mcp-common.mjs';
import {permissions} from '../../worker/mcp-access.mjs';
import { verifyGithubIdentity } from '../../worker/mcp-github-identity.mjs';
import { verifyWorkspaceAssertion } from './pairing.mjs';
import {aiAPI} from '../../worker/ai.mjs';

import {escape,oauthAppearance,htmlHeaders} from './appearance.mjs';
const pairingWebOrigins = new Set(['https://easybook-sync.1902521952.workers.dev','https://easybook.loonxy.com']);
const oauthHandler = {
 async fetch(request,env) {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
  if(url.pathname==='/account/native/ai'&&request.method==='POST'){
   const {nativeSession}=await import('./native-sessions.mjs');const current=await nativeSession(request,env);if(!current)return Response.json({error:'unauthorized'},{status:401});
   let input;try{input=await boundedJSON(request,65536)}catch{return Response.json({error:'invalid_request'},{status:400})}if(!object(input))return Response.json({error:'invalid_request'},{status:400});
   const principal={kind:'account',accountId:current.account_id,sessionId:current.id,authenticatedAt:current.authenticated_at};let target,method='GET',body;
   if(input.action==='config')target='/api/ai/config';
   else if(input.action==='credential'&&['PUT','DELETE'].includes(input.method)){target='/api/ai/config';method=input.method;if(method==='PUT')body=JSON.stringify({provider:input.provider,providerName:input.providerName,baseUrl:input.baseUrl,model:input.model,apiKey:input.apiKey})}
   else if(input.action==='chat'){target='/api/ai/chat';method='POST';body=JSON.stringify({messages:input.messages})}
   else return Response.json({error:'invalid_request'},{status:400});
   const headers={'Content-Type':'application/json'};return aiAPI(new Request(new URL(target,request.url),{method,headers,body}),env,principal,{workspaceId:input.workspace||''});
  }
  if(identityEnabled(env)&&url.origin===LEGACY_IDENTITY_ORIGIN&&((url.pathname==='/callback'&&url.searchParams.get('state')?.startsWith('account_'))||url.pathname==='/account/login'))return new Response(null,{status:303,headers:{Location:IDENTITY_ORIGIN+url.pathname+url.search,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  if(modernWorkspaces(env)&&(url.pathname==='/pairing/complete'||url.pathname==='/callback'&&!url.searchParams.get('state')?.startsWith('account_')))return new Response('Legacy authorization retired; authorize your Easybook account',{status:410});
  if(url.pathname.startsWith('/account/native/passkeys/')){const {nativePasskeyRoutes}=await import('./native-passkeys.mjs');return nativePasskeyRoutes(request,env);}
  if(url.pathname==='/oauth/workspace-grants'){const {session,requireForm,redirect,json}=await import('./accounts.mjs');const s=await session(request,env);if(!s)return json({error:'unauthorized'},401);if(request.method!=='POST')return json({error:'method_not_allowed'},405);const form=await requireForm(request,s);const {revokeWorkspaceGrant}=await import('../../worker/grant-revocation.mjs');if(!await revokeWorkspaceGrant(env,s.account_id,form.get('id'),form.get('workspace')))return json({error:'not_found'},404);return redirect('/account');}
  if(url.pathname==='/account/native/manage'){const {nativeManagementRoutes}=await import('./native-management.mjs');return nativeManagementRoutes(request,env);}
  if(url.pathname==='/account/qr'||url.pathname.startsWith('/account/qr/')||url.pathname.startsWith('/account/native/qr/')){const {qrLoginRoutes}=await import('./qr-login.mjs');return qrLoginRoutes(request,env);}
  const native=await nativeAccountRoutes(request,env);if(native)return native;
  if(url.pathname.startsWith('/account/passkeys')){const {passkeyRoutes}=await import('./passkeys.mjs');return passkeyRoutes(request,env);}
  if(modernWorkspaces(env)&&url.pathname.startsWith('/account/operations/')){const {operationApprovalRoutes}=await import('./operation-approvals.mjs');const approval=await operationApprovalRoutes(request,env);if(approval)return approval;}
  if(modernWorkspaces(env)&&url.pathname==='/account/backup-status'){const {backupDiagnosticsRoute}=await import('./backup-diagnostics.mjs');return backupDiagnosticsRoute(request,env);}
  if(modernWorkspaces(env)&&['/account/notifications','/account/activity','/account/notification-preferences'].includes(url.pathname)){const {accountHistoryRoutes}=await import('./account-history.mjs');return accountHistoryRoutes(request,env);}
  if(modernWorkspaces(env)&&url.pathname==='/account/delete'){const {accountDeletionRoutes}=await import('./account-deletion.mjs');return accountDeletionRoutes(request,env);}
  const account=await accountRoutes(request,env);if(account)return account;
  if(url.pathname==='/oauth/authorize')return accountAuthorize(request,env);
  if(url.pathname.startsWith('/uploads/'))return uploadHTTP(request,env);
  if(url.pathname==='/health/mcp'&&request.method==='GET')return mcpHealth(env);
  if(url.pathname==='/pairing/complete' && request.method==='OPTIONS'){
   const origin=request.headers.get('Origin');
   if(!pairingWebOrigins.has(origin))return new Response(null,{status:403});
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
  }
  if(url.pathname==='/pairing/complete' && request.method==='POST'){
   const origin=request.headers.get('Origin');
   if(origin&&!pairingWebOrigins.has(origin))return new Response('Origin not allowed',{status:403});
   const cors=origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
   const fail=(error,status)=>Response.json({error},{status,headers:{...cors,'Cache-Control':'no-store'}});
   if(!env.MCP_PAIRING_SIGNING_KEY)return fail('Pairing unavailable',503);
   try {
   let input;
   try{input=await boundedJSON(request,4096)}catch{return fail('Invalid pairing request',400)}
   const workspace=await verifyWorkspaceAssertion(input?.assertion,env.MCP_PAIRING_SIGNING_KEY,input?.challenge);
   if(!workspace)return fail('Invalid workspace proof',403);
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.challenge));
   const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const now=Math.floor(Date.now()/1000);
   // All grant writes and one-time consumption commit together; a DB failure leaves the challenge retryable.
   const results=await env.DB.batch([
    env.DB.prepare("INSERT INTO mcp_workspace_grants(id,github_user_id,oauth_client_id,workspace_id,scope,created_at) SELECT ?,github_user_id,oauth_client_id,?,'mcp:read',? FROM mcp_pairing_challenges WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>? ON CONFLICT(github_user_id,oauth_client_id,workspace_id) DO UPDATE SET revoked_at=NULL").bind(crypto.randomUUID(),workspace,now,hash,now),
    env.DB.prepare('INSERT INTO mcp_active_workspaces(github_user_id,oauth_client_id,workspace_id,updated_at) SELECT github_user_id,oauth_client_id,?,? FROM mcp_pairing_challenges WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>? ON CONFLICT(github_user_id,oauth_client_id) DO UPDATE SET workspace_id=excluded.workspace_id,updated_at=excluded.updated_at').bind(workspace,now,hash,now),
    env.DB.prepare('UPDATE mcp_pairing_challenges SET consumed_at=? WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING github_user_id,oauth_client_id').bind(now,hash,now)
   ]);
   if(!results[2].results?.length)return fail('Pairing challenge expired',409);
   return Response.json({paired:true},{headers:{'Cache-Control':'no-store',...(pairingWebOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
   } catch(error) {console.error(JSON.stringify({event:'mcp_pairing_failed',name:error?.name}));return fail('Pairing temporarily unavailable',503)}
  }
  if(modernWorkspaces(env)&&url.pathname==='/authorize')return request.method==='GET'?new Response(null,{status:303,headers:{Location:'/oauth/authorize'+url.search,'Cache-Control':'no-store'}}):new Response('Reauthorize with an Easybook account',{status:410});
  if (url.pathname === '/authorize' && request.method === 'GET') {
   const authRequest = await oauth.parseAuthRequest(request);
   const client = await oauth.lookupClient(authRequest.clientId);
   const consent = await oauth.beginConsent(authRequest);
   const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>AI 与 MCP 授权</title>${oauthAppearance}<body><h1>AI 与 MCP 授权</h1><p><strong>${escape(client?.clientName || client?.client_name || 'MCP client')}</strong> 请求只读访问你的 Easybook 笔记和文件夹。</p><p>仅已获准的 GitHub 账户可以继续。</p><p><a href="/oauth/authorize${escape(url.search)}">改用 Easybook 账户授权</a></p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}"><button name="decision" value="allow">允许只读访问</button><button name="decision" value="deny">取消授权</button></form></body></html>`;
   const headers = new Headers(consent.headers);for(const [k,v] of Object.entries(htmlHeaders))headers.set(k,v);
   return new Response(page,{headers});
  }
  if (url.pathname === '/authorize' && request.method === 'POST') {
   const form = await request.formData();
   const handle = form.get('handle');
   if(typeof handle!=='string')return new Response('Invalid consent',{status:400});
   if(form.get('decision')!=='allow'){
    try { return await oauth.denyConsent(request,handle); }
    catch (error) {
     if (error?.message?.includes('This authorization was not started in this browser')) return new Response('This authorization request has expired or was already submitted. Return to your MCP client and start a new connection.',{status:409,headers:htmlHeaders});
     throw error;
    }
   }
   let approved;
   try { approved=await oauth.approveConsent(request,handle); }
   catch (error) {
    if (error?.message?.includes('This authorization was not started in this browser')) return new Response('This authorization request has expired or was already submitted. Return to your MCP client and start a new connection.',{status:409,headers:htmlHeaders});
    throw error;
   }
   const upstream=await oauth.beginUpstream(approved.request,{headers:approved.headers});
   const gh = new URL('https://github.com/login/oauth/authorize');
   gh.searchParams.set('client_id',env.GITHUB_CLIENT_ID);
   gh.searchParams.set('redirect_uri',new URL('/callback',request.url).href);
   gh.searchParams.set('state',upstream.state);
   // No GitHub scopes: only /user identity is needed; never request repo access.
   // Embedded OAuth browsers may suppress cross-origin redirects after a form POST.
   // Render a real navigation target so the user can proceed even if automatic navigation is blocked.
   const redirectHeaders = new Headers(upstream.headers);
   for (const [k,v] of Object.entries(htmlHeaders)) redirectHeaders.set(k,v);
   redirectHeaders.set('Referrer-Policy','no-referrer');
   const destination = escape(gh.href);
   const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${destination}"><title>继续使用 GitHub</title>${oauthAppearance}<body><h1>继续使用 GitHub</h1><p>已同意只读访问，请继续前往 GitHub 验证账户。</p><p><a href="${destination}" rel="noreferrer">继续使用 GitHub</a></p><p>如果页面未自动跳转，请点击上方按钮。</p></body></html>`;
   console.info('MCP consent approved', {stage:'github-upstream',destinationHost:gh.hostname,status:200});
   return new Response(page,{status:200,headers:redirectHeaders});
  }
  if(url.pathname==='/callback' && request.method==='GET'){
   const upstream=await oauth.finishUpstream(request);
   if(url.searchParams.has('error'))return new Response('GitHub authorization denied',{status:403,headers:{'Cache-Control':'no-store'}});
   const code=url.searchParams.get('code');
   if(!code)return new Response('Missing authorization code',{status:400});
   const exchange=await fetch('https://github.com/login/oauth/access_token',{
    method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:new URL('/callback',request.url).href})
   });
   if(!exchange.ok)return new Response('GitHub authorization failed',{status:502});
   const token=await exchange.json();
   if(!token.access_token || typeof token.access_token !== 'string')return new Response('GitHub authorization failed',{status:403});
   let user;
   try { user=await verifyGithubIdentity(token.access_token); }
   catch (error) {
    const denied=error?.message==='GitHub account is not authorized for Easybook';
    console.error('GitHub OAuth identity verification failed', {reason:denied?'account-mismatch':'upstream-verification-error'});
    return new Response(denied?'Account not permitted':'GitHub identity verification unavailable. Please retry later.',{status:denied?403:502,headers:{'Cache-Control':'no-store'}});
   }
   const completed=await oauth.completeAuthorization({
    request:upstream.request,userId:String(user.githubUserId),scope:['mcp:read'],
    metadata:{label:user.login},props:{githubUserId:user.githubUserId}
   });
   const destination=new URL(completed.redirectTo);
   // Never log OAuth authorization codes, state, or full callback URLs.
   console.info('MCP client authorization redirect', {destinationHost:destination.hostname,scheme:destination.protocol,status:303});
   const callbackHeaders=new Headers(upstream.headers);
   callbackHeaders.set('Location',completed.redirectTo);
   callbackHeaders.set('Cache-Control','no-store');
   // The browser should navigate with GET after the upstream GitHub callback.
   return new Response(null,{status:303,headers:callbackHeaders});
  }
  return new Response('Not found',{status:404});
 }
};
const apiHandler={
 async fetch(request,env,ctx){
  if(modernWorkspaces(env)){const {workspaceMcp}=await import('./workspace-mcp.mjs');return workspaceMcp(request,env,ctx);}
  if(ctx?.props?.accountId){
   const policy=await policyFor(env,ctx.props,ctx?.auth?.clientId,ctx?.auth?.scope||[]);
   if(!policy)return new Response('Authorization revoked',{status:403});
   const headers=new Headers(request.headers);headers.delete('Origin');headers.set('Authorization','Bearer internal-oauth-bridge');
   return mcp(new Request(request,{headers}),{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},policy.workspace_id,{client:grantClient(policy.id),scopes:policy.scopes});
  }
  if(String(ctx?.props?.githubUserId ?? '')!=='236202359' || !ctx?.auth?.scope?.includes('mcp:read'))
   return new Response('Forbidden',{status:403});
  // The OAuth provider validates the client token before this handler runs.
  // Pairing initiation does not grant access to any workspace.
  if(env.MCP_GRANTS_ENABLED==='true' && request.method==='POST'){
   const clientId=ctx?.auth?.clientId;
   if(typeof clientId!=='string'||!clientId)return new Response('Client identity unavailable',{status:403});
   let msg;try{msg=await boundedJSON(request)}catch{return new Response('Invalid or oversized JSON',{status:400})}
   if(!object(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});
   if(msg.id===undefined)return new Response(null,{status:202});
   const pairingNames=['begin_workspace_pairing','list_authorized_workspaces','select_authorized_workspace','workspace_access_status','revoke_workspace_access'];
   if(msg.method==='tools/call'&&pairingNames.includes(msg.params?.name)){try{validate(msg.params.name==='select_authorized_workspace'?schema({workspaceId:{...str(64),pattern:'^[a-f0-9]{64}$'}},['workspaceId']):schema(),msg.params.arguments||{})}catch{return Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'Invalid tool arguments'}})}}
   const raw=JSON.stringify(msg);
   const reply=(value)=>Response.json({jsonrpc:'2.0',id:msg.id??null,result:value},{headers:{'Cache-Control':'no-store'}});
   if(msg.method==='tools/call' && msg.params?.name==='begin_workspace_pairing'){
    const githubId=String(ctx.props.githubUserId);
    const now=Math.floor(Date.now()/1000);
    const pending=await env.DB.prepare('SELECT COUNT(*) AS total FROM mcp_pairing_challenges WHERE github_user_id=? AND oauth_client_id=? AND consumed_at IS NULL AND expires_at>?').bind(githubId,clientId,now).first();
    if(Number(pending?.total||0)>=5)return new Response('Too many active pairing challenges',{status:429,headers:{'Retry-After':'300'}});
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const challenge=btoa(String.fromCharCode(...bytes)).split('+').join('-').split('/').join('_').replace(/=+$/,'');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(challenge));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const expires=now+300;
    await env.DB.prepare('INSERT INTO mcp_pairing_challenges(challenge_hash,github_user_id,oauth_client_id,expires_at) VALUES(?,?,?,?)').bind(hash,String(ctx.props.githubUserId),clientId,expires).run();
    return reply({content:[{type:'text',text:JSON.stringify({challenge,expiresAt:expires,instructions:'Open Easybook AI & MCP settings to approve this client and enter the challenge. Never share your workspace key.'})}]});
   }
   if(msg.method==='tools/call' && msg.params?.name==='list_authorized_workspaces'){
    const {results}=await env.DB.prepare('SELECT g.workspace_id,a.workspace_id AS active FROM mcp_workspace_grants g LEFT JOIN mcp_active_workspaces a ON a.github_user_id=g.github_user_id AND a.oauth_client_id=g.oauth_client_id WHERE g.github_user_id=? AND g.oauth_client_id=? AND g.revoked_at IS NULL ORDER BY g.created_at DESC LIMIT 100').bind(String(ctx.props.githubUserId),clientId).all();
    return reply({content:[{type:'text',text:JSON.stringify({workspaces:results.map(r=>({id:r.workspace_id,active:r.workspace_id===r.active}))})}]});
   }
   if(msg.method==='tools/call' && msg.params?.name==='select_authorized_workspace'){
    const workspaceId=msg.params?.arguments?.workspaceId;
    if(typeof workspaceId!=='string'||!/^[a-f0-9]{64}$/.test(workspaceId))return new Response('Invalid workspace id',{status:400});
    const githubId=String(ctx.props.githubUserId);
    const active=await env.DB.prepare('SELECT workspace_id FROM mcp_workspace_grants WHERE github_user_id=? AND oauth_client_id=? AND workspace_id=? AND revoked_at IS NULL').bind(githubId,clientId,workspaceId).first();
    if(!active)return new Response('Workspace not authorized',{status:403});
    await env.DB.prepare('INSERT INTO mcp_active_workspaces(github_user_id,oauth_client_id,workspace_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(github_user_id,oauth_client_id) DO UPDATE SET workspace_id=excluded.workspace_id,updated_at=excluded.updated_at').bind(githubId,clientId,workspaceId,Math.floor(Date.now()/1000)).run();
    return reply({content:[{type:'text',text:JSON.stringify({selected:true,workspaceFingerprint:workspaceId.slice(0,12)})}]});
   }
   if(msg.method==='tools/call' && msg.params?.name==='workspace_access_status'){
    const row=await env.DB.prepare('SELECT a.workspace_id FROM mcp_active_workspaces a JOIN mcp_workspace_grants g ON g.github_user_id=a.github_user_id AND g.oauth_client_id=a.oauth_client_id AND g.workspace_id=a.workspace_id WHERE a.github_user_id=? AND a.oauth_client_id=? AND g.revoked_at IS NULL').bind(String(ctx.props.githubUserId),clientId).first();
    return reply({content:[{type:'text',text:JSON.stringify({paired:!!row,workspaceFingerprint:row?.workspace_id?.slice(0,12)||null})}]});
   }
   if(msg.method==='tools/call' && msg.params?.name==='revoke_workspace_access'){
    const githubId=String(ctx.props.githubUserId);
    const active=await env.DB.prepare('SELECT workspace_id FROM mcp_active_workspaces WHERE github_user_id=? AND oauth_client_id=?').bind(githubId,clientId).first();
    if(active){
     await env.DB.batch([env.DB.prepare('DELETE FROM mcp_client_permissions WHERE workspace=? AND client=?').bind(active.workspace_id,clientId),env.DB.prepare('DELETE FROM mcp_downloads WHERE workspace=? AND client=?').bind(active.workspace_id,clientId),env.DB.prepare('DELETE FROM mcp_approvals WHERE workspace=? AND client=?').bind(active.workspace_id,clientId)]);
     await env.DB.prepare('UPDATE mcp_workspace_grants SET revoked_at=? WHERE github_user_id=? AND oauth_client_id=? AND workspace_id=? AND revoked_at IS NULL').bind(Math.floor(Date.now()/1000),githubId,clientId,active.workspace_id).run();
     await env.DB.prepare('DELETE FROM mcp_active_workspaces WHERE github_user_id=? AND oauth_client_id=?').bind(githubId,clientId).run();
    }
    return reply({content:[{type:'text',text:JSON.stringify({revoked:true})}]});
   }
   // MCP clients must initialize before invoking pairing tools, even with no workspace grant.
   // Only protocol negotiation is available here; note reads remain grant-gated below.
   if(['initialize','ping','notifications/initialized','resources/list','resources/templates/list','prompts/list','prompts/get'].includes(msg.method)){
    const headers=new Headers(request.headers);
    headers.delete('Origin');
    headers.set('Authorization','Bearer internal-oauth-bridge');
    return mcp(new Request(request,{body:raw,headers}),{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},'0'.repeat(64));
   }
   if(msg.method==='tools/list'){
    const headers=new Headers(request.headers);
    headers.delete('Origin');
    headers.set('Authorization','Bearer internal-oauth-bridge');
    const response=await mcp(new Request(request,{body:raw,headers}),{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},'0'.repeat(64));
    const data=await response.json();
    if(data?.result?.tools){
     data.result.tools.push(
      {name:'list_authorized_workspaces',description:'List workspaces granted to this OAuth client',inputSchema:{type:'object',properties:{},additionalProperties:false}},
      {name:'select_authorized_workspace',description:'Switch to a previously authorized workspace',inputSchema:{type:'object',properties:{workspaceId:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['workspaceId'],additionalProperties:false}},
      {name:'workspace_access_status',description:'Check active workspace access',inputSchema:{type:'object',properties:{},additionalProperties:false}},
      {name:'revoke_workspace_access',description:'Revoke current workspace access',inputSchema:{type:'object',properties:{},additionalProperties:false}},
      {name:'begin_workspace_pairing',description:'Create a one-time workspace pairing code',inputSchema:{type:'object',properties:{},additionalProperties:false}}
     );
    }
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
   }
   request=new Request(request,{body:raw});
  }
  // Grant-based mode is opt-in until the authenticated pairing flow is deployed.
  // No workspace is ever selected from untrusted MCP request parameters.
  let workspaceId=null;
  let client=null;
  if(env.MCP_GRANTS_ENABLED==='true'){
   const githubUserId=String(ctx.props.githubUserId);
   const clientId=ctx?.auth?.clientId;
   if(typeof clientId!=='string'||!clientId)return new Response('Client identity unavailable',{status:403});
   const grant=await env.DB.prepare(
    'SELECT a.workspace_id FROM mcp_active_workspaces a JOIN mcp_workspace_grants g ON g.github_user_id=a.github_user_id AND g.oauth_client_id=a.oauth_client_id AND g.workspace_id=a.workspace_id WHERE a.github_user_id=? AND a.oauth_client_id=? AND g.revoked_at IS NULL AND g.scope=?'
   ).bind(githubUserId,clientId,'mcp:read').first();
   if(!grant)return new Response('Workspace not paired',{status:503});
   workspaceId=grant.workspace_id;client=clientId;
  }else{
   if(!env.MCP_WORKSPACE_KEY || !/^[a-f0-9]{64}$/.test(env.MCP_WORKSPACE_KEY))return new Response('Workspace not paired',{status:503});
  }
  // Reuse the existing read-only MCP handler only after provider validation.
  // Internal bearer is never sent to the client or persisted.
  const headers=new Headers(request.headers);
  headers.delete('Origin');headers.set('Authorization','Bearer internal-oauth-bridge');
  const trusted=new Request(request,{headers});
  return mcp(trusted,{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},workspaceId,{client,scopes:await permissions(env,workspaceId,client)});
 }
};
export {apiHandler,oauthHandler};
const providerOptions={
 apiRoute:'/mcp',apiHandler,defaultHandler:oauthHandler,
 resourceMetadata:{resource:'https://easybook-mcp-oauth.1902521952.workers.dev/mcp'},
 authorizeEndpoint:'/authorize',tokenEndpoint:'/token',clientRegistrationEndpoint:'/register',
 // Give third-party MCP clients a practical session window even when refresh scheduling is delayed.
 // Refresh-token rotation remains enabled; this does not bypass revocation or scope checks.
 accessTokenTTL:3600,refreshTokenTTL:2592000,
 onError:({code,internal})=>{console.warn(JSON.stringify({event:'oauth_denied',code,category:internal?.category,reason:internal?.reason}))},
 tokenExchangeCallback:async options=>{
  if(modernWorkspaces(options.env)&&!options.props?.accountId)throw new OAuthError('invalid_grant',{description:'Authorize with your Easybook account at the canonical domain'});
  if(options.props?.accountId){
   const policy=await policyFor(options.env,options.props,options.clientId,options.requestedScope);
   if(!policy||!policy.scopes.length)throw new OAuthError('invalid_grant',{description:'Authorization revoked'});
   await options.env.DB.prepare('UPDATE oauth_grants SET provider_grant_id=? WHERE id=? AND account_id=? AND revoked_at IS NULL').bind(options.grantId,policy.id,options.userId).run();
   return {accessTokenScope:policy.scopes};
  }
 },
 clientIdMetadataDocumentEnabled:true,
 allowPlainPKCE:false,scopesSupported:['mcp:read',...SCOPES],requiredScopes:[]
};
export const provider=new OAuthProvider(providerOptions);
export const canonicalProvider=new OAuthProvider({...providerOptions,resourceMetadata:{resource:IDENTITY_ORIGIN+'/mcp'},authorizeEndpoint:'/oauth/authorize',scopesSupported:['mcp:read',...V2_SCOPES]});




// Legacy endpoints and grants remain available alongside the new account flow.
export default {async fetch(request,env,ctx){
 try {
  await requireRestoreAccess(env);
  let requestUrl=new URL(request.url);
  if(requestUrl.pathname==='/.well-known/oauth-protected-resource'){requestUrl.pathname+='\/mcp';request=new Request(requestUrl,request);}
  const path=requestUrl.pathname;
  // Fixed first-party native API transport. Do not redirect POSTs or proxy OAuth
  // endpoints: browser login/consent and the WebAuthn RP remain canonical.
  if(identityEnabled(env)&&(requestUrl.origin===LEGACY_IDENTITY_ORIGIN||/^https:\/\/[a-f0-9]{8}-easybook-mcp-oauth\.1902521952\.workers\.dev$/.test(requestUrl.origin))&&path.startsWith('/account/native/')){
   if(request.headers.has('Origin')||request.headers.get('X-Easybook-Native')!=='1')return Response.json({error:'native_request_required'},{status:403,headers:{'Cache-Control':'no-store'}});
   return await oauthHandler.fetch(new Request(IDENTITY_ORIGIN+path+requestUrl.search,request),env);
  }

  if(modernWorkspaces(env)&&requestUrl.origin===LEGACY_IDENTITY_ORIGIN){if(path.startsWith('/.well-known/oauth-')||path==='/oauth/authorize'||path==='/authorize')return new Response(null,{status:303,headers:{Location:IDENTITY_ORIGIN+path+requestUrl.search,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});if(['/register','/token','/oauth/token'].includes(path))return Response.json({error:'legacy_issuer_retired',authorization_server:IDENTITY_ORIGIN},{status:410,headers:{'Cache-Control':'no-store'}});}
  if(['/token','/oauth/token','/oauth/revoke','/register'].includes(path))await rateLimit(request,env,'oauth',60);
  return await guardTokens(request,env,ctx,identityEnabled(env)&&new URL(request.url).origin===IDENTITY_ORIGIN?canonicalProvider:provider);
 }catch(error){if(error instanceof Response)return error;console.error(JSON.stringify({event:'account_oauth_failed',name:error?.name}));return new Response('Authorization temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
}};



