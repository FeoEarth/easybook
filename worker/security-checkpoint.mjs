export const checkpointEnabled=env=>env.SECURITY_CHECKPOINT_V2==='true';
export class CheckpointError extends Error {constructor(code='security_checkpoint_unavailable'){super(code);this.code=code;this.status=503}}
function store(env){if(!env.SECURITY_DB)throw new CheckpointError();return env.SECURITY_DB.withSession?env.SECURITY_DB.withSession('first-primary'):env.SECURITY_DB}
export async function checkpointState(env){
 const db=store(env);
 // An accidentally bound business database must never serve as its own guard.
 if(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").first())throw new CheckpointError('security_database_must_be_independent');
 const state=await db.prepare('SELECT * FROM security_state WHERE id=1').first();if(!state)throw new CheckpointError('security_checkpoint_not_initialized');return state;
}
export async function requireRestoreAccess(env){
 if(!checkpointEnabled(env))return null;
 const state=await checkpointState(env),local=await env.DB.prepare('SELECT epoch FROM security_restore_state WHERE id=1').first();
 if(state.mode!=='open'||local?.epoch!==state.epoch)throw new CheckpointError('security_restore_locked');return state;
}
export async function revoked(env,kind,subject){if(!checkpointEnabled(env)||!subject)return false;return !!await store(env).prepare("SELECT 1 FROM security_revocations WHERE kind=? AND subject=? UNION ALL SELECT 1 FROM security_revocation_intents WHERE kind=? AND subject=? AND status<>'cancelled' LIMIT 1").bind(kind,subject,kind,subject).first()}
export async function revokeExternally(env,entries){
 if(!checkpointEnabled(env))return;
 const db=store(env);if(entries.length)await db.batch(entries.map(([kind,id])=>db.prepare('INSERT INTO security_revocations(kind,subject,created_at) VALUES(?,?,?) ON CONFLICT(kind,subject) DO NOTHING').bind(kind,id,Date.now())));
}
export async function accountAllowed(env,id){await requireRestoreAccess(env);return !await revoked(env,'account',id)}
export async function sessionAllowed(env,row){
 const state=await requireRestoreAccess(env);if(!state)return true;
 if(row.created_at<state.not_before||await revoked(env,'account',row.account_id)||await revoked(env,'session',row.id))return false;
 const factor=await env.DB.prepare('SELECT credential_id FROM account_session_passkeys WHERE session_id=?').bind(row.id).first();return !factor||!await revoked(env,'passkey',factor.credential_id);
}
export async function workspaceAllowed(env,id,version){
 await requireRestoreAccess(env);if(!checkpointEnabled(env))return true;
 if(await revoked(env,'workspace',id))return false;
 const row=await store(env).prepare("SELECT MAX(min_version) floor FROM workspace_security_floors WHERE workspace_id=? AND status<>'cancelled'").bind(id).first();return !row?.floor||version>=row.floor;
}
export async function oauthAllowed(env,row){const state=await requireRestoreAccess(env);return !state||row.created_at>=state.not_before&&!await revoked(env,'account',row.account_id)&&!await revoked(env,'oauth',row.id)}
export async function reserveWorkspaceFloor(env,id,version){
 if(!checkpointEnabled(env))return null;await requireRestoreAccess(env);
 const operation=crypto.randomUUID();await store(env).prepare("INSERT INTO workspace_security_floors VALUES(?,?,?,'pending',?)").bind(operation,id,version,Date.now()).run();return operation;
}
export async function finishWorkspaceFloor(env,id,status){if(id)await store(env).prepare("UPDATE workspace_security_floors SET status=? WHERE operation_id=? AND status='pending'").bind(status,id).run()}
// Administrative functions deliberately have no HTTP route. The recovery
// operator calls these with both D1 bindings while all application access stops.
export async function initializeCheckpoint(env){
 const db=store(env);if(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").first())throw new CheckpointError('security_database_must_be_independent');if(await db.prepare('SELECT 1 FROM security_state').first())throw new CheckpointError('checkpoint_already_initialized');
 if(await env.DB.prepare('SELECT 1 FROM security_restore_state WHERE id=1').first())throw new CheckpointError('security_database_recovery_required');
 const epoch=crypto.randomUUID(),now=Date.now();await db.prepare("INSERT INTO security_state VALUES(1,?,'blocked',?,?)").bind(epoch,now,now).run();
 // Initial activation invalidates pre-checkpoint sessions and OAuth grants.
 for(const [table,kind,id]of [['accounts','account','id'],['account_passkeys','passkey','id']]){
  const {results}=await env.DB.prepare('SELECT '+id+' id FROM '+table+' WHERE '+(table==='accounts'?'deleted_at':'revoked_at')+' IS NOT NULL').all();
  for(let i=0;i<results.length;i+=50)await db.batch(results.slice(i,i+50).map(r=>db.prepare('INSERT INTO security_revocations VALUES(?,?,?) ON CONFLICT(kind,subject) DO NOTHING').bind(kind,r.id,now)));
 }
 const {results:workspaces}=await env.DB.prepare('SELECT id,version,deleted_at FROM workspaces').all();
 for(const w of workspaces){if(w.deleted_at)await db.prepare("INSERT INTO security_revocations VALUES('workspace',?,?) ON CONFLICT(kind,subject) DO NOTHING").bind(w.id,now).run();else await db.prepare("INSERT INTO workspace_security_floors VALUES(?,?,?,'committed',?)").bind(crypto.randomUUID(),w.id,w.version,now).run()}
 await env.DB.prepare('INSERT INTO security_restore_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,reconciled_at=excluded.reconciled_at').bind(epoch,now).run();
 await db.prepare("UPDATE security_state SET mode='open' WHERE id=1 AND epoch=?").bind(epoch).run();return {epoch};
}
export async function beginSecurityRestore(env){
 const epoch=crypto.randomUUID();await checkpointState(env);await store(env).prepare("UPDATE security_state SET mode='blocked',epoch=?,not_before=? WHERE id=1").bind(epoch,Date.now()).run();return {epoch};
}
export async function reconcileSecurityRestore(env,epoch){
 const state=await checkpointState(env);if(state.mode!=='blocked'||state.epoch!==epoch)throw new CheckpointError('restore_epoch_mismatch');
 const now=Date.now();await env.DB.batch([
  env.DB.prepare('UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,?)').bind(now),
  env.DB.prepare('UPDATE oauth_grants SET revoked_at=COALESCE(revoked_at,?)').bind(now),
  env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=?,payload=json_remove(payload,'$.document') WHERE status='pending'").bind(now),
  env.DB.prepare('DELETE FROM account_login_handoffs'),env.DB.prepare('DELETE FROM account_passkey_challenges'),env.DB.prepare('DELETE FROM account_native_passkey_challenges'),
  env.DB.prepare('DELETE FROM account_login_states'),env.DB.prepare('DELETE FROM account_identity_link_requests'),env.DB.prepare('DELETE FROM account_workspace_claims'),
  env.DB.prepare('DELETE FROM mcp_downloads'),
  env.DB.prepare('INSERT INTO security_restore_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,reconciled_at=excluded.reconciled_at').bind(epoch,now)
 ]);
 return {epoch,access:'blocked',sessions_revoked:true,oauth_revoked:true};
}
export async function openSecurityRestore(env,epoch){
 const state=await checkpointState(env),local=await env.DB.prepare('SELECT epoch FROM security_restore_state WHERE id=1').first();
 if(state.mode!=='blocked'||state.epoch!==epoch||local?.epoch!==epoch)throw new CheckpointError('restore_not_reconciled');
 if(await env.DB.prepare('SELECT 1 FROM account_sessions WHERE revoked_at IS NULL UNION ALL SELECT 1 FROM oauth_grants WHERE revoked_at IS NULL LIMIT 1').first())throw new CheckpointError('restore_credentials_not_revoked');
 await store(env).prepare("UPDATE security_state SET mode='open' WHERE id=1 AND epoch=? AND mode='blocked'").bind(epoch).run();
 return {epoch,access:'open',warning:'Workspaces older than their external security floor remain quarantined; restore a sufficiently recent verified security state. Never raise versions to bypass the floor.'};
}

export async function reserveRevocations(env,entries){
 if(!checkpointEnabled(env)||!entries.length)return null;await requireRestoreAccess(env);
 const db=store(env),operation=crypto.randomUUID();await db.prepare("INSERT INTO security_revocation_intents SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),'pending',? FROM json_each(?)").bind(operation,Date.now(),JSON.stringify(entries)).run();return operation;
}
export async function finishRevocations(env,id,status){if(id)await store(env).prepare("UPDATE security_revocation_intents SET status=? WHERE operation_id=? AND status='pending'").bind(status,id).run()}
export async function allowedWorkspaces(env,rows,idField='id'){
 await requireRestoreAccess(env);if(!checkpointEnabled(env)||!rows.length)return rows;
 const db=store(env),ids=JSON.stringify([...new Set(rows.map(r=>r[idField]))]);
 const floors=(await db.prepare("SELECT workspace_id,MAX(min_version) floor FROM workspace_security_floors WHERE status<>'cancelled' AND workspace_id IN(SELECT value FROM json_each(?)) GROUP BY workspace_id").bind(ids).all()).results;
 const denied=(await db.prepare("SELECT subject FROM security_revocations WHERE kind='workspace' AND subject IN(SELECT value FROM json_each(?)) UNION SELECT subject FROM security_revocation_intents WHERE kind='workspace' AND status<>'cancelled' AND subject IN(SELECT value FROM json_each(?))").bind(ids,ids).all()).results;
 const minimum=new Map(floors.map(r=>[r.workspace_id,r.floor])),blocked=new Set(denied.map(r=>r.subject));return rows.filter(r=>!blocked.has(r[idField])&&r.version>=(minimum.get(r[idField])||0));
}
export async function allowedPolicies(env,rows){
 const state=await requireRestoreAccess(env);if(!state||!rows.length)return rows;
 const db=store(env),ids=JSON.stringify(rows.flatMap(r=>[r.id,r.account_id]));
 const revokedRows=(await db.prepare("SELECT kind,subject FROM security_revocations WHERE kind IN('account','oauth') AND subject IN(SELECT value FROM json_each(?)) UNION SELECT kind,subject FROM security_revocation_intents WHERE kind IN('account','oauth') AND status<>'cancelled' AND subject IN(SELECT value FROM json_each(?))").bind(ids,ids).all()).results;
 const denied=new Set(revokedRows.map(r=>r.kind+':'+r.subject));return rows.filter(r=>r.created_at>=state.not_before&&!denied.has('account:'+r.account_id)&&!denied.has('oauth:'+r.id));
}

export async function reserveWorkspaceFloors(env,workspaces){
 if(!checkpointEnabled(env)||!workspaces.length)return [];await requireRestoreAccess(env);
 const rows=workspaces.map(w=>({operation:crypto.randomUUID(),id:w.id,version:w.version+1}));
 await store(env).prepare("INSERT INTO workspace_security_floors SELECT json_extract(value,'$.operation'),json_extract(value,'$.id'),json_extract(value,'$.version'),'pending',? FROM json_each(?)").bind(Date.now(),JSON.stringify(rows)).run();return rows.map(w=>w.operation);
}
export async function finishWorkspaceFloors(env,ids,status){if(ids.length)await store(env).prepare("UPDATE workspace_security_floors SET status=? WHERE operation_id IN(SELECT value FROM json_each(?)) AND status='pending'").bind(status,JSON.stringify(ids)).run()}
