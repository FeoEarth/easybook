import {deleteWorkspace} from './workspace-delete.mjs';
import {nativeSession} from '../mcp-oauth/src/native-sessions.mjs';
import {session,csrf,rateLimit,readCookie,ACCOUNT_COOKIE} from '../mcp-oauth/src/accounts.mjs';
import {boundedJSON,object} from './mcp-common.mjs';
import {
 WorkspaceError,workspaceAccess,createWorkspace,resolveWorkspaceKey,listWorkspaces,
 rotateWorkspaceKey,associateWorkspace,renameWorkspace,convertToShared,
 convertToPersonal,setWorkspaceMember,transferWorkspaceManager,listWorkspaceMembers,leaveWorkspace
} from './workspace-identity.mjs';

const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const problem=(code,status)=>{throw new WorkspaceError(code,status)};
const bearer=request=>request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
async function inputBody(request){const value=await boundedJSON(request,4096);if(!object(value))problem('invalid_request',400);return value;}

export async function workspacePrincipal(request,env,{mutation=false,allowAnonymous=false}={}){
 if(request.headers.get('Authorization')?.startsWith('Easybook-Session ')){
  if(request.headers.has('Origin'))problem('native_origin_not_allowed',403);
  const s=await nativeSession(request,env);if(!s)problem('account_session_expired',401);
  return {kind:'account',accountId:s.account_id,sessionId:s.id,authenticatedAt:s.authenticated_at};
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
  return {kind:'account',accountId:s.account_id,sessionId:s.id,authenticatedAt:s.authenticated_at};
 }
 if(readCookie(request,ACCOUNT_COOKIE))problem('account_session_expired',401);
 if(!allowAnonymous)problem('authentication_required',401);return null;
}

// Returns null for unrelated paths. Activation is a coordinated release decision
// in index.mjs, after stable-ID clients and external revocation recovery exist.
export async function workspaceAPI(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/api/workspaces'&&!path.startsWith('/api/workspaces/'))return null;
 try{
  if(path==='/api/workspaces/session'&&request.method==='GET'){
   const current=await session(request,env);return reply({signedIn:!!current,...(current?{name:current.display_name,csrf:await csrf(request,current)}:{})});
  }
  const mutation=!['GET','HEAD'].includes(request.method);
  if(mutation&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)problem('origin_not_allowed',403);
  if(mutation&&!['POST','PATCH','DELETE'].includes(request.method))problem('method_not_allowed',405);
  const principal=await workspacePrincipal(request,env,{mutation,allowAnonymous:path==='/api/workspaces'&&request.method==='POST'});
  if(path==='/api/workspaces'){
   if(request.method==='GET'){
    if(principal.kind==='key')return reply({workspaces:[await workspaceAccess(env,principal.workspaceId,principal)]});
    return reply({workspaces:await listWorkspaces(env,principal)});
   }
   if(request.method==='POST'){
    await rateLimit(request,env,'workspace-create',5);
    const input=await inputBody(request);
    if(principal?.kind==='key')problem('use_account_or_anonymous_creation',400);
    if(input.bootstrapKey!==undefined&&(!/^[a-f0-9]{64}$/.test(input.bootstrapKey)||principal))problem('invalid_bootstrap',400);
    return reply(await createWorkspace(env,input.name,principal,input.bootstrapKey),201);
   }
   problem('method_not_allowed',405);
  }
  const match=path.match(/^\/api\/workspaces\/([a-f0-9]{64})(?:\/(key|associate|mode|members|manager|leave|delete))?$/);
  if(!match)problem('not_found',404);
  const [,id,action]=match;
  if(action==='associate'&&request.method==='POST'){
   if(principal.kind!=='account')problem('account_required',403);
   if(Date.now()-principal.authenticatedAt>300000)problem('reauthentication_required',403);
   const input=await inputBody(request),proof=await resolveWorkspaceKey(env,input.key);
   if(proof?.workspace.id!==id)problem('invalid_workspace_proof',403);
   return reply({workspace:await associateWorkspace(env,id,proof.principal,principal)});
  }
  const access=await workspaceAccess(env,id,principal);if(!access)problem('workspace_access_denied',403);
  if(request.method==='GET'&&action==='members')return reply(await listWorkspaceMembers(env,id,principal));
  if(request.method==='GET'&&!action)return reply({workspace:access});
  if(request.method!=='POST')problem('method_not_allowed',405);
  const input=await inputBody(request);
  if(!action)return reply({workspace:await renameWorkspace(env,id,principal,input.name)});
  // Native/app UI must present these actions explicitly. Recent authentication
  // is checked here rather than trusting a frontend confirmation flag alone.
  if(principal.kind==='account'&&Date.now()-principal.authenticatedAt>300000)problem('reauthentication_required',403);
  if(action==='delete')return reply(await deleteWorkspace(env,id,principal,input));
  if(action==='leave'){if(input.confirm!==true)problem('confirmation_required',409);return reply(await leaveWorkspace(env,id,principal));}
  if(action==='key'){
   if(input.confirm!==true)problem('confirmation_required',409);
   return reply(await rotateWorkspaceKey(env,id,principal));
  }
  if(action==='mode'){
   const options={confirm:input.confirm===true,firstAccountId:input.firstAccountId,role:input.role};
   if(input.mode==='shared')return reply({workspace:await convertToShared(env,id,principal,options)});
   if(input.mode==='personal')return reply(await convertToPersonal(env,id,principal,options));
   problem('invalid_mode',400);
  }
  if(action==='members')return reply({workspace:await setWorkspaceMember(env,id,principal,input.accountId,input.role)});
  if(action==='manager')return reply({workspace:await transferWorkspaceManager(env,id,principal,input.accountId,{confirm:input.confirm===true})});
  problem('not_found',404);
 }catch(e){
  if(e instanceof WorkspaceError)return reply({error:e.code},e.status);
  if(e instanceof Response)return e;
  if(e?.code==='PAYLOAD_TOO_LARGE')return reply({error:'payload_too_large'},413);
  if(['INVALID_ARGUMENT','PARSE_ERROR'].includes(e?.code))return reply({error:'invalid_request'},400);
  console.error(JSON.stringify({event:'workspace_request_failed',name:e?.name}));
  return reply({error:'workspace_service_unavailable'},503);
 }
}


