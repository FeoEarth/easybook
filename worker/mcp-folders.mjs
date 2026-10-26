import {applyPlacement} from './management.mjs';
import {fail} from './mcp-common.mjs';
import {folderExists,list} from './mcp-notes.mjs';
export async function state(ctx){const r=await ctx.env.DB.prepare('SELECT version,items FROM management_state WHERE workspace=?').bind(ctx.workspace).first();return r?{version:r.version,items:JSON.parse(r.items)}:{version:0,items:{}};}
export async function folderGet(ctx,id){const f=await ctx.env.DB.prepare('SELECT id,name,updated,deleted FROM folders WHERE workspace=? AND id=? AND deleted=0').bind(ctx.workspace,id).first();if(!f)fail('NOT_FOUND','Folder not found');return f;}
export async function folderTool(ctx,name,a){
 const s=await state(ctx);
 if(name==='folders_list'){
  const after=a.cursor||'';if(after&&!/^[a-f0-9-]{36}$/.test(after))fail('INVALID_ARGUMENT','Invalid folder cursor');
  const limit=a.limit||30,rows=(await ctx.env.DB.prepare('SELECT id,name,updated FROM folders WHERE workspace=? AND deleted=0 AND id>? ORDER BY id LIMIT ?').bind(ctx.workspace,after,limit+1).all()).results;
  const more=rows.length>limit;rows.length=Math.min(rows.length,limit);
  return {folders:rows.map(f=>({...f,parent_id:s.items['f:'+f.id]?.parent||'',rank:s.items['f:'+f.id]?.rank||0})),management_version:s.version,next_cursor:more?rows.at(-1).id:null};
 }
 if(name==='folders_get'){const f=await folderGet(ctx,a.id);return {...f,parent_id:s.items['f:'+a.id]?.parent||'',rank:s.items['f:'+a.id]?.rank||0,management_version:s.version};}
 if(name==='folders_get_contents'){await folderGet(ctx,a.id);return list(ctx,{folder_id:a.id,limit:a.limit,cursor:a.cursor});}
 if(name==='folders_rename'){
  if(!a.name.trim())fail('INVALID_ARGUMENT','Empty name');await folderGet(ctx,a.id);const r=await ctx.env.DB.prepare('UPDATE folders SET name=?,updated=? WHERE workspace=? AND id=? AND updated=? AND deleted=0').bind(a.name.trim(),Math.max(Date.now(),a.updated+1),ctx.workspace,a.id,a.updated).run();if(r.meta.changes!==1)fail('CONFLICT','Folder changed');return folderGet(ctx,a.id);
 }
 if(a.management_version!==s.version)fail('CONFLICT','Folder hierarchy changed',{management_version:s.version});
 if(name==='folders_create'||name==='folders_move'){
  if(name==='folders_create'&&!a.name.trim())fail('INVALID_ARGUMENT','Empty name');
  const id=name==='folders_create'?crypto.randomUUID():a.id;
  if(name==='folders_move')await folderGet(ctx,id);
  await folderExists(ctx,a.parent_id||'');
  const op={id:crypto.randomUUID(),key:'f:'+id,parent:a.parent_id||'',rank:a.rank??Math.floor(Date.now()/1000)};let items;try{items=applyPlacement(s.items,op)}catch{fail('CONFLICT','Folder cycle or hierarchy limit')}
  await ctx.env.DB.prepare('INSERT OR IGNORE INTO management_state(workspace,version,items) VALUES(?,0,?)').bind(ctx.workspace,'{}').run();
  const update=ctx.env.DB.prepare("UPDATE management_state SET items=?,version=version+1 WHERE workspace=? AND version=? AND (?='' OR EXISTS(SELECT 1 FROM folders WHERE workspace=? AND id=? AND deleted=0))").bind(JSON.stringify(items),ctx.workspace,s.version,op.parent,ctx.workspace,op.parent);
  const statements=[update];
  if(name==='folders_create')statements.push(ctx.env.DB.prepare('INSERT INTO folders(workspace,id,name,updated,deleted) SELECT ?,?,?,?,0 WHERE changes()=1').bind(ctx.workspace,id,a.name.trim(),Date.now()));
  const r=await ctx.env.DB.batch(statements);if(r[0].meta.changes!==1)fail('CONFLICT','Folder hierarchy or parent changed');
  return {...await folderGet(ctx,id),parent_id:op.parent,management_version:s.version+1};
 }
 if(name==='folders_delete'){
  await folderGet(ctx,a.id);
  const children=Object.entries(s.items).filter(([k,v])=>k.startsWith('f:')&&v.parent===a.id).map(([k])=>k.slice(2));
  for(const id of children)if(await ctx.env.DB.prepare('SELECT id FROM folders WHERE workspace=? AND id=? AND deleted=0').bind(ctx.workspace,id).first())fail('FOLDER_NOT_EMPTY','Move child folders first');
  const r=await ctx.env.DB.prepare('UPDATE folders SET deleted=1,updated=? WHERE workspace=? AND id=? AND updated=? AND deleted=0 AND NOT EXISTS(SELECT 1 FROM notes_json WHERE workspace=? AND folder_id=? AND purged=0) AND COALESCE((SELECT version FROM management_state WHERE workspace=?),0)=?').bind(Math.max(Date.now(),a.updated+1),ctx.workspace,a.id,a.updated,ctx.workspace,a.id,ctx.workspace,s.version).run();
  if(r.meta.changes!==1)fail('CONFLICT','Folder changed or still contains notes');return {id:a.id,deleted:true};
 }
 fail('INVALID_ARGUMENT','Unknown folder tool');
}
