export const permanentAttachments=env=>env.WORKSPACE_IDENTITY_V2==='true';
export async function attachmentDeleted(env,workspace,id){return permanentAttachments(env)&&!!await env.DB.prepare('SELECT 1 FROM attachment_tombstones WHERE workspace=? AND attachment=?').bind(workspace,id).first()}
// No R2/D1 transaction is assumed. The D1 tombstone is the access fence. Only
// this exact content-addressed namespace may be removed, never an entire bucket.
export async function runAttachmentPurges(env,limit=5){
 if(!permanentAttachments(env)||!env.ATTACHMENTS)return;
 const now=Date.now(),rows=(await env.DB.prepare("SELECT id FROM attachment_purge_jobs WHERE (status IN('queued','running') OR (status='complete' AND updated_at<?)) AND lease_until<? ORDER BY updated_at LIMIT ?").bind(now-86400000,now,limit).all()).results;
 for(const candidate of rows){
  const lease=crypto.randomUUID(),job=await env.DB.prepare("UPDATE attachment_purge_jobs SET status='running',lease=?,lease_until=?,updated_at=? WHERE id=? AND status IN('queued','running','complete') AND lease_until<? RETURNING *").bind(lease,now+120000,now,candidate.id,now).first();if(!job)continue;
  if(!/^[a-f0-9]{64}$/.test(job.workspace)||!/^[a-f0-9]{64}$/.test(job.attachment)||!await attachmentDeleted(env,job.workspace,job.attachment)){await env.DB.prepare("UPDATE attachment_purge_jobs SET status='failed',error='INVALID_FENCE' WHERE id=? AND lease=?").bind(job.id,lease).run();continue}
  try{
   const base=job.workspace+'/'+job.attachment;
   // Delete the old unchunked object too. Repeating either deletion is safe.
   await env.ATTACHMENTS.delete(base);
   const page=await env.ATTACHMENTS.list({prefix:base+'/',limit:100,...(job.cursor?{cursor:job.cursor}:{})});
   const keys=page.objects.map(o=>o.key);if(keys.some(k=>!k.startsWith(base+'/')))throw Error('INVALID_PREFIX');
   if(keys.length)await env.ATTACHMENTS.delete(keys);
   // Cursor is persisted only after successful deletion. Crash/replay can only
   // repeat deletions within the frozen namespace, never expand their scope.
   await env.DB.prepare('UPDATE attachment_purge_jobs SET status=?,cursor=?,lease=NULL,lease_until=0,updated_at=?,error=NULL WHERE id=? AND lease=?').bind(page.truncated?'queued':'complete',page.truncated?page.cursor:null,Date.now(),job.id,lease).run();
  }catch{
   await env.DB.prepare("UPDATE attachment_purge_jobs SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'queued' END,lease=NULL,lease_until=?,updated_at=?,error='R2_CLEANUP_RETRY' WHERE id=? AND lease=?").bind(Date.now()+60000,Date.now(),job.id,lease).run();
  }
 }
}
