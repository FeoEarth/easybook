import {hash,fail} from './mcp-common.mjs';
import {checkpointEnabled,requireRestoreAccess,sessionAllowed,reserveRevocations,finishRevocations,reserveWorkspaceFloors,finishWorkspaceFloors} from './security-checkpoint.mjs';
export async function deletionPreview(env,accountId){
 const {results}=await env.DB.prepare('SELECT id,name,mode,version FROM workspaces WHERE manager_account_id=? AND deleted_at IS NULL ORDER BY created_at,id LIMIT 101').bind(accountId).all();
 if(results.length>100)fail('ACCOUNT_TOO_LARGE','Contact recovery support to review more than 100 managed workspaces');
 return {personal:results.filter(w=>w.mode==='personal'),requires_transfer:results.filter(w=>w.mode==='shared')};
}
export async function deleteAccount(env,s,choices){
 if(!checkpointEnabled(env))fail('CHECKPOINT_REQUIRED','Independent revocation protection is required before account deletion');await requireRestoreAccess(env);
 if(!s||Date.now()-s.authenticated_at>300000||!await sessionAllowed(env,s))fail('REAUTHENTICATION_REQUIRED','Reauthenticate within five minutes');
 const preview=await deletionPreview(env,s.account_id);if(preview.requires_transfer.length)fail('MANAGER_TRANSFER_REQUIRED','Transfer all shared workspaces before deleting the account');
 if(!Array.isArray(choices)||choices.length!==preview.personal.length||new Set(choices.map(c=>c.id)).size!==choices.length)fail('EXPLICIT_DISPOSITION_REQUIRED','Choose keep or delete for every personal workspace');
 for(const choice of choices){const current=preview.personal.find(w=>w.id===choice.id);if(!current||current.version!==choice.version||!['keep','delete'].includes(choice.action))fail('CONFLICT','Workspace selection changed');
  if(choice.action==='keep'){
   if(typeof choice.key!=='string'||!/^[a-f0-9]{64}$/.test(choice.key))fail('KEY_PROOF_REQUIRED','Prove possession of the retained workspace key');
   if(!await env.DB.prepare('SELECT 1 FROM workspace_keys WHERE workspace_id=? AND key_hash=? AND revoked_at IS NULL').bind(choice.id,await hash(choice.key)).first())fail('KEY_PROOF_REQUIRED','Retained workspace key is not current');
  }
 }
 const {results:memberships}=await env.DB.prepare('SELECT w.id,w.version FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.account_id=? ORDER BY w.id').bind(s.account_id).all();
 const personal=JSON.stringify(choices.map(({id,version,action})=>({id,version,action}))),memberJson=JSON.stringify(memberships),deleted=JSON.stringify(choices.filter(c=>c.action==='delete').map(c=>c.id)),now=Date.now();
 // No raw key enters an external record, receipt, notification or audit log.
 const floors=await reserveWorkspaceFloors(env,[...preview.personal,...memberships]);
 const revocation=await reserveRevocations(env,[['account',s.account_id],...choices.filter(c=>c.action==='delete').map(c=>['workspace',c.id])]);
 const statements=[],checkId=crypto.randomUUID();
 statements.push(env.DB.prepare("INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM account_sessions WHERE id=? AND account_id=? AND revoked_at IS NULL AND expires_at>? AND authenticated_at>?) AND NOT EXISTS(SELECT 1 FROM workspaces WHERE manager_account_id=? AND mode='shared' AND deleted_at IS NULL) AND (SELECT COUNT(*) FROM workspaces WHERE manager_account_id=? AND mode='personal' AND deleted_at IS NULL)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) c LEFT JOIN workspaces w ON w.id=json_extract(c.value,'$.id') WHERE w.id IS NULL OR w.version<>json_extract(c.value,'$.version') OR w.manager_account_id<>? OR w.mode<>'personal' OR w.deleted_at IS NOT NULL) AND (SELECT COUNT(*) FROM workspace_members WHERE account_id=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) c LEFT JOIN workspaces w ON w.id=json_extract(c.value,'$.id') WHERE w.id IS NULL OR w.version<>json_extract(c.value,'$.version'))").bind(checkId,s.id,s.account_id,now,now-300000,s.account_id,s.account_id,choices.length,personal,s.account_id,s.account_id,memberships.length,memberJson));
 // Keep proofs are checked again in the transaction, closing a key-rotation race.
 const keepProofs=[];for(const c of choices.filter(c=>c.action==='keep'))keepProofs.push({id:c.id,hash:await hash(c.key)});
 statements.push(env.DB.prepare("INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,NOT EXISTS(SELECT 1 FROM json_each(?) p WHERE NOT EXISTS(SELECT 1 FROM workspace_keys k WHERE k.workspace_id=json_extract(p.value,'$.id') AND k.key_hash=json_extract(p.value,'$.hash') AND k.revoked_at IS NULL))").bind(crypto.randomUUID(),JSON.stringify(keepProofs)));
 statements.push(
  env.DB.prepare('UPDATE workspace_keys SET revoked_at=? WHERE revoked_at IS NULL AND workspace_id IN(SELECT value FROM json_each(?))').bind(now,deleted),
  env.DB.prepare("UPDATE workspaces SET manager_account_id=NULL,deleted_at=CASE WHEN id IN(SELECT value FROM json_each(?)) THEN ? ELSE deleted_at END,version=version+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?))").bind(deleted,now,personal),
  env.DB.prepare("UPDATE workspaces SET version=version+1 WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(?))").bind(memberJson),
  env.DB.prepare('DELETE FROM workspace_members WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('UPDATE accounts SET display_name=?,deleted_at=? WHERE id=? AND deleted_at IS NULL').bind('Deleted account',now,s.account_id),
  env.DB.prepare('UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,?),token_hash=\'deleted:\'||id,device=\'Deleted device\' WHERE account_id=?').bind(now,s.account_id),
  env.DB.prepare('UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,?),scopes=\'[]\',provider_grant_id=NULL WHERE account_id=?').bind(now,s.account_id),
  env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=?,payload='{}' WHERE account_id=? AND status='pending'").bind(now,s.account_id),
  env.DB.prepare("UPDATE account_operation_approvals SET payload='{}' WHERE account_id=?").bind(s.account_id),
  env.DB.prepare("UPDATE notes_json SET title='',document=?,icon='📄',pinned=0,favorite=0,deleted=1,purged=1,version=version+1,mutation=?,updated=?,folder_id='' WHERE purged=0 AND workspace IN(SELECT value FROM json_each(?))").bind(JSON.stringify({schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}}),crypto.randomUUID(),now,deleted),
  env.DB.prepare('DELETE FROM note_receipts WHERE workspace IN(SELECT value FROM json_each(?))').bind(deleted),
  env.DB.prepare("UPDATE folders SET name='',deleted=1,updated=? WHERE workspace IN(SELECT value FROM json_each(?))").bind(now,deleted),
  env.DB.prepare("UPDATE management_state SET items='{}',version=version+1 WHERE workspace IN(SELECT value FROM json_each(?))").bind(deleted),
  env.DB.prepare('DELETE FROM management_receipts WHERE workspace IN(SELECT value FROM json_each(?))').bind(deleted),
  env.DB.prepare("INSERT INTO workspace_deletion_jobs(id,workspace_id,status,created_at,updated_at) SELECT lower(hex(randomblob(16))),value,'queued',?,? FROM json_each(?)").bind(now,now,deleted),
  env.DB.prepare('DELETE FROM account_session_passkeys WHERE session_id IN(SELECT id FROM account_sessions WHERE account_id=?)').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_passkey_rps WHERE credential_id IN(SELECT id FROM account_passkeys WHERE account_id=?)').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_passkeys WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_identities WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_native_sessions WHERE session_id IN(SELECT id FROM account_sessions WHERE account_id=?)').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_login_handoffs WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_native_passkey_challenges WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_passkey_challenges WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_identity_link_requests WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_workspace_claims WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM oauth_token_uses WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM oauth_issued_tokens WHERE policy_id IN(SELECT id FROM oauth_grants WHERE account_id=?)').bind(s.account_id),
  env.DB.prepare("UPDATE mcp_audit SET client='deleted-account' WHERE client IN(SELECT 'easybook-account:'||id FROM oauth_grants WHERE account_id=?)").bind(s.account_id),
  env.DB.prepare('DELETE FROM account_audit_events WHERE account_id=? AND workspace_id IS NULL').bind(s.account_id),
  env.DB.prepare('UPDATE account_audit_events SET account_id=NULL WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('UPDATE workspace_security_events SET actor_account_id=NULL WHERE actor_account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_notifications WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM account_notification_preferences WHERE account_id=?').bind(s.account_id),
  env.DB.prepare('DELETE FROM workspace_tx_assertions')
 );
 try{await env.DB.batch(statements)}catch(error){
  if(/CHECK constraint failed|workspace_tx_assertions|valid=1/i.test(error.message)){await finishRevocations(env,revocation,'cancelled');await finishWorkspaceFloors(env,floors,'cancelled');fail('CONFLICT','Account or workspace state changed; no data was deleted')}
  // Unknown commit outcome leaves an external pending fence. Never reopen an
  // account automatically after a network error which might follow a commit.
  throw error;
 }
 await finishRevocations(env,revocation,'committed');await finishWorkspaceFloors(env,floors,'committed');
 return {deleted:true,retained_workspaces:choices.filter(c=>c.action==='keep').map(c=>c.id),deleted_workspaces:choices.filter(c=>c.action==='delete').map(c=>c.id),physical_cleanup:'durable_jobs'};
}
