// Internal migration runner, deliberately not an HTTP/MCP operation. Production
// invocation requires the release recovery checkpoint and reviewed preflight.
export async function inspectLegacyWorkspaces(env){
 const {results}=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
 const tables=new Set(results.map(r=>r.name));
 const sources=[['notes_json','workspace'],['notes','workspace'],['folders','workspace'],['management_state','workspace'],['mcp_workspace_grants','workspace_id'],['workspace_memberships','workspace_id']].filter(([t])=>tables.has(t));
 const ids=new Set();
 // All identifiers come from the fixed source list, never from a request.
 for(const [table,column] of sources){
  const rows=await env.DB.prepare(`SELECT DISTINCT ${column} id FROM ${table}`).all();
  for(const row of rows.results){if(!/^[a-f0-9]{64}$/.test(row.id))throw new Error('Invalid legacy workspace identity');ids.add(row.id);}
 }
 const membershipIssues=await env.DB.prepare("SELECT workspace_id FROM workspace_memberships WHERE revoked_at IS NULL GROUP BY workspace_id HAVING SUM(role='owner')<>1 OR SUM(role<>'owner')>0").all();
 return {workspaceIds:[...ids].sort(),membershipIssues:membershipIssues.results.map(x=>x.workspace_id),sourceTables:sources.map(([t])=>t)};
}

export async function backfillLegacyWorkspaces(env,{recoveryCheckpointVerified=false}={}){
 if(!recoveryCheckpointVerified)throw new Error('Verified recovery checkpoint required');
 const preflight=await inspectLegacyWorkspaces(env);
 if(preflight.membershipIssues.length)throw new Error('Legacy memberships require explicit resolution; no automatic shared conversion');
 // Bound each atomic metadata import; content rows and R2 are never rewritten.
 for(const id of preflight.workspaceIds){
  const check=crypto.randomUUID(),now=Date.now();
  await env.DB.batch([
   env.DB.prepare("INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,NOT EXISTS(SELECT 1 FROM workspace_memberships WHERE workspace_id=? AND revoked_at IS NULL AND role<>'owner') AND NOT EXISTS(SELECT 1 FROM workspace_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=? AND m.revoked_at IS NULL AND a.deleted_at IS NOT NULL)").bind(check,id,id),
   env.DB.prepare("INSERT INTO workspaces(id,name,mode,manager_account_id,created_at) SELECT ?,'我的工作区','personal',(SELECT account_id FROM workspace_memberships WHERE workspace_id=? AND role='owner' AND revoked_at IS NULL),? ON CONFLICT(id) DO NOTHING").bind(id,id,now),
   env.DB.prepare("INSERT INTO workspace_keys(key_hash,workspace_id,created_at) SELECT id,id,? FROM workspaces WHERE id=? AND mode='personal' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM workspace_keys WHERE workspace_id=?) ON CONFLICT(key_hash) DO NOTHING").bind(now,id,id),
   env.DB.prepare('DELETE FROM workspace_tx_assertions WHERE id=?').bind(check)
  ]);
 }
 return {inspected:preflight.workspaceIds.length,contentRewritten:0,r2ObjectsMoved:0};
}
