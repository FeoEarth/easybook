import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { mcp } from '../../worker/mcp.mjs';
import { verifyGithubIdentity } from '../../worker/mcp-github-identity.mjs';

const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlHeaders = {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"};
const oauthHandler = {
 async fetch(request,env) {
  const url = new URL(request.url);
  const oauth = env.OAUTH_PROVIDER;
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
    const denied=await oauth.denyConsent(request,handle);
    return denied;
   }
   const approved=await oauth.approveConsent(request,handle);
   const upstream=await oauth.beginUpstream(approved.request,{headers:approved.headers});
   const gh = new URL('https://github.com/login/oauth/authorize');
   gh.searchParams.set('client_id',env.GITHUB_CLIENT_ID);
   gh.searchParams.set('redirect_uri',new URL('/callback',request.url).href);
   gh.searchParams.set('state',upstream.state);
   // No GitHub scopes: only /user identity is needed; never request repo access.
   upstream.headers.set('Location',gh.href);
   return new Response(null,{status:302,headers:upstream.headers});
  }
  if(url.pathname==='/callback' && request.method==='GET'){
   const upstream=await oauth.finishUpstream(request);
   if(url.searchParams.has('error'))return new Response('GitHub authorization denied',{status:403});
   const code=url.searchParams.get('code');
   if(!code)return new Response('Missing authorization code',{status:400});
   const exchange=await fetch('https://github.com/login/oauth/access_token',{
    method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},
    body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:new URL('/callback',request.url).href})
   });
   if(!exchange.ok)return new Response('GitHub authorization failed',{status:502});
   const token=await exchange.json();
   if(!token.access_token)return new Response('GitHub authorization failed',{status:403});
   let user;try{user=await verifyGithubIdentity(token.access_token)}catch{return new Response('Account not permitted',{status:403})}
   const completed=await oauth.completeAuthorization({
    request:upstream.request,userId:String(user.githubUserId),scope:['mcp:read'],
    metadata:{label:user.login},props:{githubUserId:user.githubUserId}
   });
   upstream.headers.set('Location',completed.redirectTo);
   return new Response(null,{status:302,headers:upstream.headers});
  }
  return new Response('Not found',{status:404});
 }
};
const apiHandler={
 async fetch(request,env,ctx){
  if(ctx?.props?.githubUserId!==236202359 || !ctx?.auth?.scope?.includes('mcp:read'))
   return new Response('Forbidden',{status:403});
  if(!env.MCP_WORKSPACE_KEY)return new Response('Workspace not paired',{status:503});
  // Reuse the existing read-only MCP handler only after provider validation.
  // Internal bearer is never sent to the client or persisted.
  const headers=new Headers(request.headers);
  headers.delete('Origin');headers.set('Authorization','Bearer internal-oauth-bridge');
  const trusted=new Request(request,{headers});
  return mcp(trusted,{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'});
 }
};
export default new OAuthProvider({
 apiRoute:'/mcp',apiHandler,defaultHandler:oauthHandler,
 authorizeEndpoint:'/authorize',tokenEndpoint:'/token',clientRegistrationEndpoint:'/register',
 allowPlainPKCE:false,scopesSupported:['mcp:read'],requiredScopes:['mcp:read']
});
