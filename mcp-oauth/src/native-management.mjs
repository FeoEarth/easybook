import {deletionPreview,deleteAccount} from '../../worker/account-deletion.mjs';
import {revokeWorkspaceGrant} from '../../worker/grant-revocation.mjs';
import {nativeBody,nativeSession} from './native-sessions.mjs';
import {json,rateLimit} from './accounts.mjs';
import {identityEnabled,IDENTITY_ORIGIN} from '../../worker/identity-origin.mjs';
import {modernWorkspaces,accountPolicies} from '../../worker/oauth-workspace-policy.mjs';
import {auditHistory} from '../../worker/account-history.mjs';
import {executeAccountOperation} from '../../worker/account-operations.mjs';
import {reserveRevocations,finishRevocations} from '../../worker/security-checkpoint.mjs';
const uuid=/^[a-f0-9-]{36}$/;
export async function nativeManagementRoutes(request,env){
 const url=new URL(request.url);if(url.pathname!=='/account/native/manage')return null;
 if(!identityEnabled(env)||!modernWorkspaces(env)||url.origin!==IDENTITY_ORIGIN)return json({error:'not_available'},404);
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 try{
  const input=await nativeBody(request,65536),s=await nativeSession(request,env);if(!s)return json({error:'unauthorized'},401);
  await rateLimit(request,env,'native-management',60);
  if(input.action==='deletion-preview')return json(await deletionPreview(env,s.account_id));
  if(input.action==='delete-account'){if(input.confirm!=='DELETE')return json({error:'explicit_confirmation_required'},400);return json(await deleteAccount(env,s,input.choices));}
  if(input.action==='history')return json(await auditHistory(env,s.account_id,{workspaceId:input.workspace||null,cursor:input.cursor||null,category:input.category||null}));
  if(input.action==='grants')return json({grants:(await accountPolicies(env,s.account_id)).map(g=>({id:g.id,client_id:g.client_id,workspaces:g.workspaces,globalScopes:g.globalScopes,last_activity:g.last_activity}))});
  if(input.action==='approvals'){
   const {results}=await env.DB.prepare('SELECT id,client_id,workspace_id,tool,payload,status,expires_at,result FROM account_operation_approvals WHERE account_id=? ORDER BY created_at DESC LIMIT 30').bind(s.account_id).all();
   return json({approvals:results.map(r=>({...r,payload:r.status==='pending'?JSON.parse(r.payload):null,result:r.result?JSON.parse(r.result):null}))});
  }
  if(!uuid.test(input.id||''))return json({error:'invalid_id'},400);
  if(input.action==='approve')return json({result:await executeAccountOperation(env,input.id,s)});
  if(input.action==='cancel'){
   const r=await env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=? WHERE id=? AND account_id=? AND status='pending' RETURNING id").bind(Date.now(),input.id,s.account_id).first();return r?json({cancelled:true}):json({error:'operation_unavailable'},409);
  }
  if(input.action==='revoke-workspace')return await revokeWorkspaceGrant(env,s.account_id,input.id,input.workspace)?json({revoked:true}):json({error:'not_found'},404);
  if(input.action==='revoke'){
   if(!await env.DB.prepare('SELECT 1 FROM oauth_grants WHERE id=? AND account_id=? AND revoked_at IS NULL').bind(input.id,s.account_id).first())return json({error:'not_found'},404);
   const intent=await reserveRevocations(env,[['oauth',input.id]]);await env.DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE id=? AND account_id=?').bind(Date.now(),input.id,s.account_id).run();await finishRevocations(env,intent,'committed');return json({revoked:true});
  }
  return json({error:'invalid_action'},400);
 }catch(e){if(e instanceof Response)return e;return json({error:e.code||'management_unavailable'},e.code==='INVALID_ARGUMENT'?400:e.code?409:503)}
}
