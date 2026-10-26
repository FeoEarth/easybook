const DAY=86400000;
// Recovery jobs, tombstones and revocation state are deliberately not log data.
const retention=[
 ['mcp_audit','created<?',90],
 ['workspace_security_events','created_at<?',180],
 ['account_audit_events',"category='activity' AND created_at<?",90],
 ['account_audit_events',"category='security' AND created_at<?",180],
 ['account_audit_events',"category='execution' AND created_at<?",14],
 ['account_notifications',"severity='critical' AND created_at<?",180],
 ['account_notifications',"severity<>'critical' AND created_at<?",90],
 ['account_operation_budget','created_at<?',1],
 ['account_rate_limits','expires_at<?',0],
 ['account_operation_approvals',"status<>'pending' AND completed_at<? AND NOT EXISTS(SELECT 1 FROM attachment_purge_jobs j WHERE j.approval_id=account_operation_approvals.id AND j.status<>'complete')",14]
];
export async function maintainIdentity(env,now=Date.now()){
 if(env.WORKSPACE_IDENTITY_V2!=='true')return;
 const name='identity-daily',lease=crypto.randomUUID(),start=Math.floor(now/DAY)*DAY;
 const claimed=await env.DB.prepare('INSERT INTO identity_maintenance_runs(name,lease,lease_until) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET lease=excluded.lease,lease_until=excluded.lease_until WHERE identity_maintenance_runs.completed_at<? AND identity_maintenance_runs.lease_until<? RETURNING name').bind(name,lease,now+120000,start,now).first();if(!claimed)return;
 try{
  const statements=retention.map(([table,where,days])=>env.DB.prepare('DELETE FROM '+table+' WHERE rowid IN(SELECT rowid FROM '+table+' WHERE '+where+' LIMIT 500)').bind(now-days*DAY));
  statements.push(env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=? WHERE status='pending' AND expires_at<=?").bind(now,now));
  // Frozen document bodies are needed only while pending. Completion receipts
  // preserve idempotency without retaining note contents in an execution record.
  statements.push(env.DB.prepare("UPDATE account_operation_approvals SET payload=json_remove(payload,'$.document','$.metadata.title','$.metadata.icon','$.title') WHERE status<>'pending'"));
  await env.DB.batch(statements);
  let remaining=false;for(const [table,where,days]of retention)if(await env.DB.prepare('SELECT 1 FROM '+table+' WHERE '+where+' LIMIT 1').bind(now-days*DAY).first()){remaining=true;break}
  await env.DB.prepare('UPDATE identity_maintenance_runs SET completed_at=?,lease=NULL,lease_until=0,error=NULL WHERE name=? AND lease=?').bind(remaining?0:now,name,lease).run();
 }catch{
  await env.DB.prepare("UPDATE identity_maintenance_runs SET lease=NULL,lease_until=0,error='CLEANUP_RETRY' WHERE name=? AND lease=?").bind(name,lease).run();
 }
}
