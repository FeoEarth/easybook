import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { mcp } from '../../worker/mcp.mjs';
import { verifyGithubIdentity } from '../../worker/mcp-github-identity.mjs';
import { verifyWorkspaceAssertion } from './pairing.mjs';

const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlHeaders = {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'"};
const pairingWebOrigins = new Set(['https://easybook-sync.1902521952.workers.dev','https://easybook.loonxy.com']);
const oauthHandler = {
 async fetch(request,env) {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
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
   try{const raw=await request.text();if(raw.length>4096)throw Error();input=JSON.parse(raw)}catch{return fail('Invalid pairing request',400)}
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
  if (url.pathname === '/authorize' && request.method === 'GET') {
   const authRequest = await oauth.parseAuthRequest(request);
   const client = await oauth.lookupClient(authRequest.clientId);
   const consent = await oauth.beginConsent(authRequest);
   const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Easybook MCP access</title><body><h1>Easybook MCP access</h1><p><strong>${escape(client?.clientName || client?.client_name || 'MCP client')}</strong> requests read-only access to your Easybook notes and folders.</p><p>Only the authorized GitHub account can proceed.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(consent.handle)}"><button name="decision" value="allow">Allow read access</button><button name="decision" value="deny">Deny</button></form></body></html>`;
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
   const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${destination}"><title>Continue with GitHub</title><body><h1>Continue with GitHub</h1><p>Read-only access approved. Continue to GitHub to verify your account.</p><p><a href="${destination}" rel="noreferrer">Continue with GitHub</a></p><p>If the page does not move automatically, tap the link above.</p></body></html>`;
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
  if(String(ctx?.props?.githubUserId ?? '')!=='236202359' || !ctx?.auth?.scope?.includes('mcp:read'))
   return new Response('Forbidden',{status:403});
  // The OAuth provider validates the client token before this handler runs.
  // Pairing initiation does not grant access to any workspace.
  if(env.MCP_GRANTS_ENABLED==='true' && request.method==='POST'){
   const clientId=ctx?.auth?.clientId;
   if(typeof clientId!=='string'||!clientId)return new Response('Client identity unavailable',{status:403});
   const raw=await request.text();
   if(raw.length>16384)return new Response('Payload too large',{status:413});
   let msg;try{msg=JSON.parse(raw)}catch{return new Response('Invalid JSON',{status:400})}
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
     await env.DB.prepare('UPDATE mcp_workspace_grants SET revoked_at=? WHERE github_user_id=? AND oauth_client_id=? AND workspace_id=? AND revoked_at IS NULL').bind(Math.floor(Date.now()/1000),githubId,clientId,active.workspace_id).run();
     await env.DB.prepare('DELETE FROM mcp_active_workspaces WHERE github_user_id=? AND oauth_client_id=?').bind(githubId,clientId).run();
    }
    return reply({content:[{type:'text',text:JSON.stringify({revoked:true})}]});
   }
   // MCP clients must initialize before invoking pairing tools, even with no workspace grant.
   // Only protocol negotiation is available here; note reads remain grant-gated below.
   if(msg.method==='initialize' || msg.method==='ping' || msg.method==='notifications/initialized'){
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
  if(env.MCP_GRANTS_ENABLED==='true'){
   const githubUserId=String(ctx.props.githubUserId);
   const clientId=ctx?.auth?.clientId;
   if(typeof clientId!=='string'||!clientId)return new Response('Client identity unavailable',{status:403});
   const grant=await env.DB.prepare(
    'SELECT a.workspace_id FROM mcp_active_workspaces a JOIN mcp_workspace_grants g ON g.github_user_id=a.github_user_id AND g.oauth_client_id=a.oauth_client_id AND g.workspace_id=a.workspace_id WHERE a.github_user_id=? AND a.oauth_client_id=? AND g.revoked_at IS NULL AND g.scope=?'
   ).bind(githubUserId,clientId,'mcp:read').first();
   if(!grant)return new Response('Workspace not paired',{status:503});
   workspaceId=grant.workspace_id;
  }else{
   if(!env.MCP_WORKSPACE_KEY || !/^[a-f0-9]{64}$/.test(env.MCP_WORKSPACE_KEY))return new Response('Workspace not paired',{status:503});
  }
  // Reuse the existing read-only MCP handler only after provider validation.
  // Internal bearer is never sent to the client or persisted.
  const headers=new Headers(request.headers);
  headers.delete('Origin');headers.set('Authorization','Bearer internal-oauth-bridge');
  const trusted=new Request(request,{headers});
  return mcp(trusted,{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},workspaceId);
 }
};
export {apiHandler,oauthHandler};
export default new OAuthProvider({
 apiRoute:'/mcp',apiHandler,defaultHandler:oauthHandler,
 resourceMetadata:{resource:'https://easybook-mcp-oauth.1902521952.workers.dev/mcp'},
 authorizeEndpoint:'/authorize',tokenEndpoint:'/token',clientRegistrationEndpoint:'/register',
 allowPlainPKCE:false,scopesSupported:['mcp:read'],requiredScopes:['mcp:read']
});
