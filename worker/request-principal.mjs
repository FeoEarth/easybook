import {nativeSession} from '../mcp-oauth/src/native-sessions.mjs';
import {webSession} from '../mcp-oauth/src/web-sessions.mjs';
import {session,csrf,readCookie,ACCOUNT_COOKIE} from '../mcp-oauth/src/accounts.mjs';
import {WorkspaceError,resolveWorkspaceKey} from './workspace-identity.mjs';
const problem=(code,status)=>{throw new WorkspaceError(code,status)};
const bearer=request=>request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
export function accountPrincipal(session,extra={}){return {kind:'account',accountId:session.account_id,sessionId:session.id,authenticatedAt:session.authenticated_at,...extra}}
export async function workspacePrincipal(request,env,{mutation=false,allowAnonymous=false}={}){
 if(request.headers.get('Authorization')?.startsWith('Easybook-Web ')){
  const s=await webSession(request,env);if(!s)problem('web_session_expired',401);
  return accountPrincipal(s,{webClientOrigin:s.client_origin});
 }
 if(request.headers.get('Authorization')?.startsWith('Easybook-Session ')){
  if(request.headers.has('Origin'))problem('native_origin_not_allowed',403);
  const s=await nativeSession(request,env);if(!s)problem('account_session_expired',401);
  return accountPrincipal(s);
 }
 const token=bearer(request);
 // Explicit credentials never fall back to an unrelated cookie or anonymous mode.
 if(request.headers.has('Authorization')){
  if(!token)problem('invalid_workspace_key',401);
  const resolved=await resolveWorkspaceKey(env,token,{allowLegacy:env.WORKSPACE_LEGACY_IMPORT==='true'});
  if(!resolved)problem('invalid_workspace_key',401);return {...resolved.principal,workspaceId:resolved.workspace.id};
 }
 const s=await session(request,env);
 if(s){
  if(mutation&&(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Easybook-CSRF')!==await csrf(request,s)))problem('invalid_csrf',403);
  return accountPrincipal(s);
 }
 if(readCookie(request,ACCOUNT_COOKIE))problem('account_session_expired',401);
 if(!allowAnonymous)problem('authentication_required',401);return null;
}
