import {deleteWorkspace} from './workspace-delete.mjs';
import {workspacePrincipal} from './request-principal.mjs';
export {workspacePrincipal} from './request-principal.mjs';
import {webSession} from '../mcp-oauth/src/web-sessions.mjs';
import {isWebClientOriginAllowed} from './server-config.mjs';
import {session,csrf,rateLimit} from '../mcp-oauth/src/accounts.mjs';
import {boundedJSON,object} from './mcp-common.mjs';
import {verifyWorkspaceCreation} from './turnstile.mjs';
import {createInvitation,managedInvitations,inboxInvitations,previewInvitation,revokeInvitation,respondInvitation} from './workspace-invitations.mjs';
import {
 WorkspaceError,workspaceAccess,createWorkspace,resolveWorkspaceKey,listWorkspaces,
 rotateWorkspaceKey,associateWorkspace,renameWorkspace,convertToShared,
 convertToPersonal,setWorkspaceMember,transferWorkspaceManager,listWorkspaceMembers,leaveWorkspace
} from './workspace-identity.mjs';

const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const problem=(code,status)=>{throw new WorkspaceError(code,status)};
async function inputBody(request){const value=await boundedJSON(request,4096);if(!object(value))problem('invalid_request',400);return value;}


// Returns null for unrelated paths. Activation is a coordinated release decision
// in index.mjs, after stable-ID clients and external revocation recovery exist.
export async function workspaceAPI(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/api/workspaces'&&!path.startsWith('/api/workspaces/'))return null;
 try{
  if(path==='/api/workspaces/session'&&request.method==='GET'){
   if(request.headers.has('Authorization')){
    const current=await webSession(request,env);if(!current)problem('web_session_expired',401);
    return reply({signedIn:true,name:current.display_name,account:{id:current.account_id,name:current.display_name},recently_authenticated:Date.now()-current.authenticated_at<=300000});
   }
   const current=await session(request,env);return reply({signedIn:!!current,...(current?{name:current.display_name,csrf:await csrf(request,current)}:{})});
  }
  const mutation=!['GET','HEAD'].includes(request.method);
  if(mutation&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin&&!isWebClientOriginAllowed(env,request.headers.get('Origin')))problem('origin_not_allowed',403);
  if(mutation&&!['POST','PATCH','DELETE'].includes(request.method))problem('method_not_allowed',405);
  const principal=await workspacePrincipal(request,env,{mutation,allowAnonymous:path==='/api/workspaces'&&request.method==='POST'});
  if(path==='/api/workspaces/invitations'&&request.method==='GET')return reply(await inboxInvitations(env,principal));
  if(path==='/api/workspaces/invitations/preview'&&request.method==='GET')return reply(await previewInvitation(env,principal,url.searchParams.get('token')));
  if(path==='/api/workspaces/invitations/respond'&&request.method==='POST'){
   await rateLimit(request,env,'workspace-invitation-respond',30);
   return reply(await respondInvitation(env,principal,await inputBody(request)));
  }
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
    if(input.workspaceId!==undefined&&(!/^[a-f0-9]{64}$/.test(input.workspaceId)||principal||!input.bootstrapKey))problem('invalid_workspace_id',400);
    if(!principal)await verifyWorkspaceCreation(request,env,input.turnstileToken);
    return reply(await createWorkspace(env,input.name,principal,input.bootstrapKey,input.workspaceId),201);
   }
   problem('method_not_allowed',405);
  }
  const invitePath=path.match(/^\/api\/workspaces\/([a-f0-9]{64})\/invitations(?:\/(revoke))?$/);
  if(invitePath){
   const [,id,operation]=invitePath;
   if(request.method==='GET'&&!operation)return reply(await managedInvitations(env,id,principal));
   if(request.method==='POST'){
    await rateLimit(request,env,'workspace-invitation-create',15);
    const input=await inputBody(request);
    return reply(operation==='revoke'?await revokeInvitation(env,id,principal,input.id):await createInvitation(env,id,principal,input),operation?200:201);
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
   // First conversion no longer grants membership. Members accept invitations.
   const options={confirm:input.confirm===true};
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


