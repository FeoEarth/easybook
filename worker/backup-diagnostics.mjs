import {listWorkspaces,workspaceAccess,WorkspaceError} from './workspace-identity.mjs';
import {Buffer} from 'node:buffer';
const LIMIT=10,HEX=/^[a-f0-9]{64}$/;
export async function backupDiagnostics(env,accountId,{workspaceId=null,cursor=null}={}){
 const principal={kind:'account',accountId},managed=(await listWorkspaces(env,principal)).filter(w=>w.role==='manager');
 if(!managed.length || workspaceId && !managed.some(w=>w.id===workspaceId))throw new WorkspaceError('manager_required',403);
 const allowed=workspaceId?managed.filter(w=>w.id===workspaceId):managed;
 let after=['','',''];if(cursor){if(cursor.length>4096)throw new WorkspaceError('invalid_cursor',400);try{after=JSON.parse(Buffer.from(cursor,'base64url').toString())}catch{throw new WorkspaceError('invalid_cursor',400)}if(!Array.isArray(after)||after.length!==3||!HEX.test(after[0])||!/^[a-f0-9-]{36}$/.test(after[1])||typeof after[2]!=='string'||after[2].length>2000)throw new WorkspaceError('invalid_cursor',400);}
 const node="CASE WHEN j.type='object' THEN j.value ELSE '{}' END",asset="COALESCE(substr(json_extract("+node+",'$.attrs.assetId'),8),'')";
 const query="SELECT n.workspace,n.id AS note_id,n.title,n.version,n.deleted,"+asset+" AS attachment_id,COALESCE(json_extract("+node+",'$.attrs.name'),json_extract("+node+",'$.attrs.alt'),'') AS attachment_name FROM notes_json n JOIN json_tree(n.document) j WHERE n.purged=0 AND n.workspace IN(SELECT value FROM json_each(?)) AND json_extract("+node+",'$.type') IN('image','attachment') AND (n.workspace,n.id,"+asset+")>(?,?,?) AND NOT EXISTS(SELECT 1 FROM attachment_tombstones t WHERE t.workspace=n.workspace AND t.attachment="+asset+") GROUP BY n.workspace,n.id,"+asset+" ORDER BY n.workspace,n.id,"+asset+" LIMIT ?";
 const rows=(await env.DB.prepare(query).bind(JSON.stringify(allowed.map(w=>w.id)),...after,LIMIT+1).all()).results;
 const more=rows.length>LIMIT;rows.length=Math.min(rows.length,LIMIT);const missing=[];
 if(!env.ATTACHMENTS)throw new WorkspaceError('attachment_check_unavailable',503);
 for(const row of rows){
  if(!HEX.test(row.attachment_id||'')){missing.push({...row,reason:'invalid_reference'});continue;}
  const base=row.workspace+'/'+row.attachment_id;
  const [manifest,legacy]=await Promise.all([env.ATTACHMENTS.head(base+'/manifest-v2'),env.ATTACHMENTS.head(base)]);
  if(!manifest&&!legacy)missing.push({...row,reason:'missing_object',placeholder:/^([a-f0-9])\1{63}$/.test(row.attachment_id)});
 }
 // Recheck authority after storage reads. Role/key/security state may change
 // while the diagnostics are running; stale access must not expose note titles.
 for(const id of new Set(rows.map(r=>r.workspace)))if((await workspaceAccess(env,id,principal))?.role!=='manager')throw new WorkspaceError('manager_required',403);
 const status=await env.DB.prepare("SELECT completed_at,lease_until,error FROM identity_maintenance_runs WHERE name='business-backup'").first(),last=rows.at(-1);
 return {workspaces:allowed.map(w=>({id:w.id,name:w.name})),checked:rows.length,missing:missing.map(row=>({...row,workspace_name:allowed.find(w=>w.id===row.workspace)?.name||'',attachment_name:typeof row.attachment_name==='string'?row.attachment_name:''})),next_cursor:more?Buffer.from(JSON.stringify([last.workspace,last.note_id,last.attachment_id])).toString('base64url'):null,backup:{state:status?.lease_until>Date.now()?'running':status?.error?'failed':status?.completed_at?'complete':'not_completed',last_success:status?.completed_at||null,error:status?.error?.includes('attachment_missing')?'missing_attachments':status?.error?'unavailable':null},read_only:true};
}
