import {requireRestoreAccess,revoked,checkpointEnabled} from './security-checkpoint.mjs';
export async function runWorkspacePurges(env,limit=2){
 if(!checkpointEnabled(env)||!env.ATTACHMENTS)return;await requireRestoreAccess(env);
 const now=Date.now(),rows=(await env.DB.prepare("SELECT id FROM workspace_deletion_jobs WHERE (status IN('queued','running') OR (status='complete' AND updated_at<?)) AND lease_until<? ORDER BY updated_at LIMIT ?").bind(now-86400000,now,limit).all()).results;
 for(const row of rows){const lease=crypto.randomUUID(),job=await env.DB.prepare("UPDATE workspace_deletion_jobs SET status='running',lease=?,lease_until=?,updated_at=? WHERE id=? AND status IN('queued','running','complete') AND lease_until<? RETURNING *").bind(lease,now+120000,now,row.id,now).first();if(!job)continue;
  if(!/^[a-f0-9]{64}$/.test(job.workspace_id)||!await revoked(env,'workspace',job.workspace_id)||!await env.DB.prepare('SELECT 1 FROM workspaces WHERE id=? AND deleted_at IS NOT NULL').bind(job.workspace_id).first()){
   await env.DB.prepare("UPDATE workspace_deletion_jobs SET status='failed',error='INVALID_FENCE' WHERE id=? AND lease=?").bind(job.id,lease).run();continue;
  }
  try{const prefix=job.workspace_id+'/',page=await env.ATTACHMENTS.list({prefix,limit:100,...(job.cursor?{cursor:job.cursor}:{})}),keys=page.objects.map(o=>o.key);if(keys.some(k=>!k.startsWith(prefix)))throw Error('Invalid cleanup namespace');if(keys.length)await env.ATTACHMENTS.delete(keys);
   await env.DB.prepare('UPDATE workspace_deletion_jobs SET status=?,cursor=?,lease=NULL,lease_until=0,updated_at=?,error=NULL WHERE id=? AND lease=?').bind(page.truncated?'queued':'complete',page.truncated?page.cursor:null,Date.now(),job.id,lease).run();
  }catch{await env.DB.prepare("UPDATE workspace_deletion_jobs SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'queued' END,lease=NULL,lease_until=?,updated_at=?,error='R2_CLEANUP_RETRY' WHERE id=? AND lease=?").bind(Date.now()+60000,Date.now(),job.id,lease).run()}
 }
}
