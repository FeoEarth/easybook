import {workspaceAccess,WorkspaceError} from './workspace-identity.mjs';
import {checkpointEnabled,requireRestoreAccess,reserveRevocations,finishRevocations,reserveWorkspaceFloor,finishWorkspaceFloor} from './security-checkpoint.mjs';
const deny=(code,status=403)=>{throw new WorkspaceError(code,status)};
export async function deleteWorkspace(env,id,principal,input){
 if(!checkpointEnabled(env))deny('independent_checkpoint_required',409);await requireRestoreAccess(env);
 const w=await workspaceAccess(env,id,principal);if(!w||w.role!=='manager'||principal.kind==='oauth')deny('manager_required');
 if(input.confirm!=='DELETE'||input.version!==w.version)deny('confirmation_or_version_changed',409);
 if(principal.kind==='account'&&Date.now()-principal.authenticatedAt>300000)deny('reauthentication_required');
 const check=crypto.randomUUID(),job=crypto.randomUUID(),now=Date.now();
 const floor=await reserveWorkspaceFloor(env,id,w.version+1),intent=await reserveRevocations(env,[['workspace',id]]);
 const authority=principal.kind==='key'?"mode='personal' AND EXISTS(SELECT 1 FROM workspace_keys k WHERE k.workspace_id=workspaces.id AND k.key_hash=? AND k.revoked_at IS NULL)":"manager_account_id=? AND EXISTS(SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=workspaces.manager_account_id AND s.revoked_at IS NULL AND s.expires_at>? AND s.authenticated_at>? AND a.deleted_at IS NULL)";
 const params=principal.kind==='key'?[principal.keyHash]:[principal.accountId,principal.sessionId,now,now-300000];
 try{await env.DB.batch([
  env.DB.prepare(`INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspaces WHERE id=? AND version=? AND deleted_at IS NULL AND ${authority})`).bind(check,id,w.version,...params),
  env.DB.prepare('UPDATE workspaces SET deleted_at=?,version=version+1 WHERE id=?').bind(now,id),
  env.DB.prepare('UPDATE workspace_keys SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL').bind(now,id),
  env.DB.prepare('UPDATE oauth_grant_workspaces SET revoked_at=COALESCE(revoked_at,?) WHERE workspace_id=?').bind(now,id),
  env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=?,payload='{}' WHERE workspace_id=? AND status='pending'").bind(now,id),
  env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id=?').bind(id),
  env.DB.prepare('INSERT INTO workspace_security_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,principal.accountId||null,'workspace_deleted',now),
  env.DB.prepare("INSERT INTO workspace_deletion_jobs(id,workspace_id,status,created_at,updated_at) VALUES(?,?,'queued',?,?)").bind(job,id,now,now),
  env.DB.prepare('DELETE FROM workspace_tx_assertions WHERE id=?').bind(check)
 ]);}catch(e){if(/workspace_tx_assertions|valid=1|CHECK constraint failed/.test(e.message)){await finishWorkspaceFloor(env,floor,'cancelled');await finishRevocations(env,intent,'cancelled');deny('workspace_changed_retry',409)}throw e;}
 await finishRevocations(env,intent,'committed');await finishWorkspaceFloor(env,floor,'committed');
 return {deleted:true,cleanup_job:job,physical_cleanup:'queued'};
}
