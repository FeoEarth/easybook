import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { mcp } from '../../worker/mcp.mjs';
import { verifyGithubIdentity } from '../../worker/mcp-github-identity.mjs';
import { verifyWorkspaceAssertion } from './pairing.mjs';

const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlHeaders = {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'"};
const oauthHandler = {
 async fetch(request,env) {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
  if(url.pathname==='/pairing/complete' && request.method==='POST'){
   if(!env.MCP_PAIRING_SIGNING_KEY)return new Response('Pairing unavailable',{status:503});
   let input;
   try{const raw=await request.text();if(raw.length>4096)throw Error();input=JSON.parse(raw)}catch{return new Response('Invalid pairing request',{status:400})}
   const workspace=await verifyWorkspaceAssertion(input?.assertion,env.MCP_PAIRING_SIGNING_KEY,input?.challenge);
   if(!workspace)return new Response('Invalid workspace proof',{status:403});
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.challenge));
   const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const now=Math.floor(Date.now()/1000);
   const challenge=await env.DB.prepare('UPDATE mcp_pairing_challenges SET consumed_at=? WHERE challenge_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING github_user_id,oauth_client_id').bind(now,hash,now).first();
   if(!challenge)return new Response('Pairing challenge expired',{status:409});
   await env.DB.prepare("INSERT INTO mcp_workspace_grants(id,github_user_id,oauth_client_id,workspace_id,scope,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(github_user_id,oauth_client_id,workspace_id) DO UPDATE SET revoked_at=NULL").bind(crypto.randomUUID(),challenge.github_user_id,challenge.oauth_client_id,workspace,'mcp:read',now).run();
   await env.DB.prepare('INSERT INTO mcp_active_workspaces(github_user_id,oauth_client_id,workspace_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(github_user_id,oauth_client_id) DO UPDATE SET workspace_id=excluded.workspace_id,updated_at=excluded.updated_at').bind(challenge.github_user_id,challenge.oauth_client_id,workspace,now).run();
   return Response.json({paired:true},{headers:{'Cache-Control':'no-store'}});
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
   const redirectHeaders = new Headers(upstream.headers);
   redirectHeaders.set('Location',gh.href);
   redirectHeaders.set('Cache-Control','no-store');
   console.info('MCP consent redirect', {stage:'github-upstream',destinationHost:gh.hostname,method:'GET',status:303});
   // 303 explicitly converts the form POST into a GET on GitHub.
   return new Response(null,{status:303,headers:redirectHeaders});
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
  if(ctx?.props?.githubUserId!==236202359 || !ctx?.auth?.scope?.includes('mcp:read'))
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
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const challenge=btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(challenge));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const expires=Math.floor(Date.now()/1000)+300;
    await env.DB.prepare('INSERT INTO mcp_pairing_challenges(challenge_hash,github_user_id,oauth_client_id,expires_at) VALUES(?,?,?,?)').bind(hash,String(ctx.props.githubUserId),clientId,expires).run();
    return reply({content:[{type:'text',text:JSON.stringify({challenge,expiresAt:expires,instructions:'Open Easybook AI & MCP settings to approve this client and enter the challenge. Never share your workspace key.'})}]});
   }
   if(msg.method==='tools/list'){
    const response=await mcp(new Request(request,{body:raw,headers:new Headers([...request.headers].filter(([k])=>k.toLowerCase()!=='origin').concat([['Authorization','Bearer internal-oauth-bridge']]))}),{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},'0'.repeat(64));
    const data=await response.json();
    if(data?.result?.tools)data.result.tools.push({name:'begin_workspace_pairing',description:'Generate a one-time code to pair the current Easybook workspace using the Easybook app',inputSchema:{type:'object',properties:{},additionalProperties:false}});
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
export default new OAuthProvider({
 apiRoute:'/mcp',apiHandler,defaultHandler:oauthHandler,
 resourceMetadata:{resource:'https://easybook-mcp-oauth.1902521952.workers.dev/mcp'},
 authorizeEndpoint:'/authorize',tokenEndpoint:'/token',clientRegistrationEndpoint:'/register',
 allowPlainPKCE:false,scopesSupported:['mcp:read'],requiredScopes:['mcp:read']
});
