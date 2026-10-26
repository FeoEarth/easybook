import {list} from './mcp-notes.mjs';
import {tasks} from './mcp-tasks.mjs';
import {registry} from './mcp-registry.mjs';
import {need,fail} from './mcp-common.mjs';
export async function workspaceTool(ctx,name,a){
 if(name==='workspace_get_info')return {name:'Easybook',workspace_fingerprint:ctx.workspace.slice(0,12),schema_version:1};
 if(name==='workspace_get_capabilities')return {scopes:ctx.scopes,tools:registry.map(t=>({name:t.name,scope:t.scope,authorized:ctx.scopes.includes(t.scope),requires_owner_confirmation:t.risk})),resources:true,prompts:true,subscriptions:false,limits:{page:30,batch:20,task_scan_notes:5,summary_scan_notes:10,request_bytes:230000,response_bytes:220000},permanent_delete:false,attachment_delete:'reversible retirement; bytes preserved',device_sync_status:false};
 if(name==='workspace_get_sync_status'){const r=await ctx.env.DB.prepare('SELECT MAX(cursor) AS cursor FROM note_changes WHERE workspace=?').bind(ctx.workspace).first();return {server_cursor:r.cursor||0,device_status:'unknown',observed_at:Date.now()};}
 if(name==='workspace_get_recent_activity'){
  need(ctx,'notes.read');
  const cursor=a.cursor||String(Number.MAX_SAFE_INTEGER);if(!/^\d{1,16}$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))fail('INVALID_ARGUMENT','Invalid change cursor');
  const rows=(await ctx.env.DB.prepare('SELECT c.cursor,n.id,n.title,n.version,n.updated,n.deleted,n.purged FROM note_changes c JOIN notes_json n ON n.workspace=c.workspace AND n.id=c.note_id WHERE c.workspace=? AND c.cursor<? ORDER BY c.cursor DESC LIMIT ?').bind(ctx.workspace,Number(cursor),a.limit||20).all()).results;
  return {changes:rows,cursor:String(rows.at(-1)?.cursor||cursor),next_cursor:rows.length===(a.limit||20)?String(rows.at(-1).cursor):null,semantics:'change feed with latest note metadata; not a complete historical snapshot'};
 }
 if(name==='workspace_get_summary'){
  need(ctx,'notes.read');need(ctx,'folders.read');need(ctx,'tasks.read');if(a.cursor!==undefined&&a.cursor!=='continue')fail('INVALID_ARGUMENT','Invalid summary cursor');
  const counts=await ctx.env.DB.prepare('SELECT COUNT(*) AS notes,SUM(CASE WHEN updated>? THEN 1 ELSE 0 END) AS updated_last_7_days FROM notes_json WHERE workspace=? AND deleted=0 AND purged=0').bind(Date.now()-7*86400000,ctx.workspace).first();
  const folders=await ctx.env.DB.prepare('SELECT COUNT(*) AS folders FROM folders WHERE workspace=? AND deleted=0').bind(ctx.workspace).first();
  // Backfill no more than ten stale metrics. Triggers maintain subsequent writes atomically.
  const rows=(await ctx.env.DB.prepare('SELECT n.id,n.version,n.document FROM notes_json n LEFT JOIN mcp_note_metrics m ON m.workspace=n.workspace AND m.note_id=n.id WHERE n.workspace=? AND n.deleted=0 AND n.purged=0 AND (m.version IS NULL OR m.version<>n.version) ORDER BY n.id LIMIT 10').bind(ctx.workspace).all()).results;
  for(const n of rows){n.document=JSON.parse(n.document);const ts=tasks(n);await ctx.env.DB.prepare('INSERT INTO mcp_note_metrics(workspace,note_id,version,total,completed) SELECT workspace,id,version,?,? FROM notes_json WHERE workspace=? AND id=? AND version=? ON CONFLICT(workspace,note_id) DO UPDATE SET version=excluded.version,total=excluded.total,completed=excluded.completed').bind(ts.length,ts.filter(t=>t.completed).length,ctx.workspace,n.id,n.version).run();}
  const metrics=await ctx.env.DB.prepare('SELECT COUNT(*) AS indexed_notes,COALESCE(SUM(m.total),0) AS total,COALESCE(SUM(m.completed),0) AS completed FROM mcp_note_metrics m JOIN notes_json n ON n.workspace=m.workspace AND n.id=m.note_id AND n.version=m.version WHERE n.workspace=? AND n.deleted=0 AND n.purged=0').bind(ctx.workspace).first();
  return {...counts,...folders,attachments:null,attachment_count_reliable:false,tasks:{total:metrics.total,completed:metrics.completed,open:metrics.total-metrics.completed,indexed_notes:metrics.indexed_notes,complete:metrics.indexed_notes===counts.notes,backfilled_this_request:rows.length},next_cursor:metrics.indexed_notes<counts.notes?'continue':null};
 }
 if(name==='workspace_search_all'){
  need(ctx,'notes.read');need(ctx,'folders.read');const n=await list(ctx,a,true),q='%'+a.query.replace(/[\\%_]/g,c=>'\\'+c)+'%';
  const folders=(await ctx.env.DB.prepare("SELECT id,name,updated FROM folders WHERE workspace=? AND deleted=0 AND name LIKE ? ESCAPE '\\' ORDER BY name,id LIMIT 30").bind(ctx.workspace,q).all()).results;return {...n,folders,folder_limit:30};
 }
 fail('INVALID_ARGUMENT','Unknown workspace tool');
}

