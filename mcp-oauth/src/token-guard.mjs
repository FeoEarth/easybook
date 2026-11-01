import {boundedText} from './accounts.mjs';
import {hash} from '../../worker/mcp-common.mjs';
const localAccount=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=()=>Response.json({error:'invalid_grant',error_description:'Credential used or revoked; authorize again'},{status:400,headers:{'Cache-Control':'no-store'}});
// The Provider owns PKCE, client authentication, cryptography and refresh rotation.
// D1 enforces one-use authorization codes. Refresh retries are handled by the OAuth Provider's
// current/previous token rotation window; a canceled request must not poison the grant.
export async function guardTokens(request,env,ctx,provider){
 const url=new URL(request.url);
 const tokenPath=['/token','/oauth/token','/oauth/revoke'].includes(url.pathname);
 if(!tokenPath)return provider.fetch(request,env,ctx);
 if(url.pathname!=='/token'){url.pathname='/token';request=new Request(url,request);}
 if(request.method!=='POST')return provider.fetch(request,env,ctx);
 const contentType=request.headers.get('Content-Type')||'';
 if(contentType.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return provider.fetch(request,env,ctx);
 if(Number(request.headers.get('Content-Length')||0)>16384)return new Response('Too large',{status:413});
 const text=await boundedText(request);if(text.length>16384)return new Response('Too large',{status:413});
 const body=new URLSearchParams(text);request=new Request(request,{body:text});
 if(body.has('token')&&!body.has('grant_type')){
  const response=await provider.fetch(request,env,ctx);
  let client=body.get('client_id');
  const basic=request.headers.get('Authorization');
  if(!client&&basic?.startsWith('Basic ')){try{client=decodeURIComponent(atob(basic.slice(6)).split(':')[0])}catch{}}
  if(response.ok&&client)await env.DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE id IN (SELECT policy_id FROM oauth_issued_tokens WHERE token_hash=? AND client_id=?)').bind(Date.now(),await hash(body.get('token')),client).run();
  return response;
 }
 const kind=body.get('grant_type'),secret=kind==='authorization_code'?body.get('code'):kind==='refresh_token'?body.get('refresh_token'):null;
 if(!secret)return provider.fetch(request,env,ctx);
 const [account,grant]=secret.split(':');
 if(!localAccount.test(account)||!grant)return provider.fetch(request,env,ctx);
 // Do not disclose whether a local account or grant exists.
 if(kind==='refresh_token'){
  // The provider validates the client, token, authorization and revocation itself.
  // Do not reserve the refresh token in D1 before this potentially slow KV exchange:
  // client timeouts would strand an unverified one-use record and block every retry.
  const attempt=provider.fetch(request,env,ctx);
  // Keep the exchange alive when the client drops the HTTP connection. The provider
  // accepts the previous refresh token so a client can safely retry after rotation.
  if(ctx?.waitUntil)ctx.waitUntil(attempt.then(()=>{},()=>{}));
  const response=await attempt;
  if(response.ok){
   // Token indexing supports account-level revocation, but must not delay the
   // refresh response. The provider's own revocation is authoritative.
   const index=async()=>{
    const issued=await response.clone().json();
    for(const value of [issued.access_token,issued.refresh_token].filter(Boolean))
     await env.DB.prepare('INSERT INTO oauth_issued_tokens(token_hash,policy_id,client_id,created_at) SELECT ?,id,client_id,? FROM oauth_grants WHERE account_id=? AND provider_grant_id=? ON CONFLICT(token_hash) DO NOTHING').bind(await hash(value),Date.now(),account,grant).run();
   };
   if(ctx?.waitUntil)ctx.waitUntil(index().catch(error=>console.warn(JSON.stringify({event:'oauth_token_index_failed',name:error?.name}))));
   else await index();
  }
  return response;
 }

 const used=await env.DB.prepare('INSERT INTO oauth_token_uses(token_hash,account_id,provider_grant_id,kind,created_at) VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash').bind(await hash(secret),account,grant,kind,Date.now()).first();
 if(!used){
  const verified=await env.DB.prepare('SELECT verified FROM oauth_token_uses WHERE token_hash=?').bind(await hash(secret)).first();
  if(verified?.verified)await env.DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE account_id=? AND provider_grant_id=?').bind(Date.now(),account,grant).run();
  return fail();
 }
 // Authorization codes are strictly one-use; refresh tokens have a separate retry path.
 const response=await provider.fetch(request,env,ctx);
 if(response.ok){
  await env.DB.prepare('UPDATE oauth_token_uses SET verified=1 WHERE token_hash=?').bind(await hash(secret)).run();
  const issued=await response.clone().json();
  for(const value of [issued.access_token,issued.refresh_token].filter(Boolean))await env.DB.prepare('INSERT INTO oauth_issued_tokens(token_hash,policy_id,client_id,created_at) SELECT ?,id,client_id,? FROM oauth_grants WHERE account_id=? AND provider_grant_id=? ON CONFLICT(token_hash) DO NOTHING').bind(await hash(value),Date.now(),account,grant).run();
 }
 return response;
}
