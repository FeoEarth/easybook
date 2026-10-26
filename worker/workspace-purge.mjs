import {requireRestoreAccess,revoked,checkpointEnabled} from './security-checkpoint.mjs';
export async function runWorkspacePurges(env,limit=2){
 if(!checkpointEnabled(env)||!env.ATTACHMENTS)return;await requireRestoreAccess(env);
 const now=Date.now(),rows=(await env.DB.prepare("SELECT id FROM workspace_deletion_jobs WHERE (status IN('queued','running') OR (status='complete' AND updated_at<?)) AND lease_until<? ORDER BY updated_at LIMIT ?").bind(now-86400000,now,limit).all()).results;
 for(const row of rows){const lease=crypto.randomUUID(),job=await env.DB.prepare("UPDATE workspace_deletion_jobs SET status='running',lease=?,lease_until=?,updated_at=? WHERE id=? AND status IN('queued','running','complete') AND lease_until<? RETURNING *").bind(lease,now+120000,now,row.id,now).first();if(!job)continue;
  if(!/^[a-f0-9]{64}$/.test(job.workspace_id)||!await revoked(env,'workspace',job.workspace_id)||!await env.DB.prepare('SELECT 1 FROM workspaces WHERE id=? AND deleted_at IS NOT NULL').bind(job.workspace_id).first()){
   await env.DB.prepare("UPDATE workspace_deletion_jobs SET status='failed',error='INVALID_FENCE' WHERE id=? AND lease=?").bind(job.id,lease).run();continue;
  }
  try{
   // Bounded, repeatable content cleanup; retain workspace/key/security tombstones.
   const tables=['folders','note_receipts','note_changes','management_state','management_receipts','mcp_uploads','mcp_upload_budgets','mcp_downloads'];
   await env.DB.prepare("UPDATE notes_json SET title='',document=?,icon='📄',pinned=0,favorite=0,deleted=1,purged=1,version=version+1,mutation=?,updated=?,folder_id='' WHERE rowid IN(SELECT rowid FROM notes_json WHERE workspace=? AND purged=0 LIMIT 100)").bind(JSON.stringify({schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}}),crypto.randomUUID(),Date.now(),job.workspace_id).run();
   await env.DB.batch(tables.map(table=>env.DB.prepare('DELETE FROM '+table+' WHERE rowid IN(SELECT rowid FROM '+table+' WHERE workspace=? LIMIT 100)').bind(job.workspace_id)));
   let contentRemaining=!!await env.DB.prepare('SELECT 1 FROM notes_json WHERE workspace=? AND purged=0 LIMIT 1').bind(job.workspace_id).first();for(const table of tables)if(await env.DB.prepare('SELECT 1 FROM '+table+' WHERE workspace=? LIMIT 1').bind(job.workspace_id).first()){contentRemaining=true;break}
   const prefix=job.workspace_id+'/',page=await env.ATTACHMENTS.list({prefix,limit:100,...(job.cursor?{cursor:job.cursor}:{})}),keys=page.objects.map(o=>o.key);if(keys.some(k=>!k.startsWith(prefix)))throw Error('Invalid cleanup namespace');if(keys.length)await env.ATTACHMENTS.delete(keys);
   await env.DB.prepare('UPDATE workspace_deletion_jobs SET status=?,cursor=?,lease=NULL,lease_until=0,updated_at=?,error=NULL WHERE id=? AND lease=?').bind(page.truncated||contentRemaining?'queued':'complete',page.truncated?page.cursor:null,Date.now(),job.id,lease).run();
  }catch{await env.DB.prepare("UPDATE workspace_deletion_jobs SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'queued' END,lease=NULL,lease_until=?,updated_at=?,error='R2_CLEANUP_RETRY' WHERE id=? AND lease=?").bind(Date.now()+60000,Date.now(),job.id,lease).run()}
 }
}

