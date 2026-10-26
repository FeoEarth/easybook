import {validateDocument} from '../shared/document.mjs';
import {fail} from './mcp-common.mjs';
// D1.batch is transactional. Assertions live inside that transaction, so a
// concurrent device write cannot turn a validated preview into a partial batch.
export async function atomicNoteBatch(env,workspace,tool,args,{guards=[]}={}){
 if(!['notes_batch_move','notes_batch_delete','notes_batch_update','notes_permanent_delete','notes_overwrite','folders_clear'].includes(tool))fail('INVALID_ARGUMENT','Unsupported atomic note operation');
 const items=args.items;
 if(!Array.isArray(items)||!items.length||items.length>100||new Set(items.map(i=>i.id)).size!==items.length)fail('INVALID_ARGUMENT','Expected 1–100 unique notes');
 const tx=crypto.randomUUID(),now=Date.now(),statements=[...guards];
 const assert=(query,params)=>env.DB.prepare('INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,CASE WHEN '+query+' THEN 1 ELSE 0 END').bind(crypto.randomUUID(),...params);
 if(tool==='notes_batch_move'&&args.folder_id)statements.push(assert('EXISTS(SELECT 1 FROM folders WHERE workspace=? AND id=? AND deleted=0)',[workspace,args.folder_id]));
 for(const item of items)if(typeof item.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id)||!Number.isSafeInteger(item.version)||item.version<1)fail('INVALID_ARGUMENT','Invalid note version');
 const targets=JSON.stringify(items);
 const purge=tool==='notes_permanent_delete';
 if(tool==='folders_clear'){
  statements.push(assert('EXISTS(SELECT 1 FROM folders WHERE workspace=? AND id=? AND deleted=0 AND updated=?)',[workspace,args.folder_id,args.folder_updated]));
  statements.push(assert('(SELECT COUNT(*) FROM notes_json WHERE workspace=? AND folder_id=? AND purged=0 AND deleted=0)=?',[workspace,args.folder_id,items.length]));
  statements.push(assert("NOT EXISTS(SELECT 1 FROM notes_json n JOIN json_each(?) t ON n.id=json_extract(t.value,'$.id') WHERE n.workspace=? AND n.folder_id<>?)",[targets,workspace,args.folder_id]));
 }

 statements.push(assert("(SELECT COUNT(*) FROM notes_json n JOIN json_each(?) t ON n.id=json_extract(t.value,'$.id') AND n.version=json_extract(t.value,'$.version') WHERE n.workspace=? AND n.purged=0 AND (n.deleted=0 OR ?=1))=?",[targets,workspace,purge?1:0,items.length]));
 const changes=purge?{title:'',document:JSON.stringify({schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}}),icon:'📄',folder_id:'',pinned:0,favorite:0,deleted:1,purged:1}:tool==='notes_overwrite'?{document:JSON.stringify(validateDocument(args.document)),...(args.title!==undefined?{title:args.title}:{})}:['notes_batch_delete','folders_clear'].includes(tool)?{deleted:1}:tool==='notes_batch_move'?{folder_id:args.folder_id}:args.metadata;
 const allowed=new Set(purge?Object.keys(changes):tool==='notes_overwrite'?['document','title']:tool==='folders_clear'?['deleted']:tool==='notes_batch_delete'?['deleted']:tool==='notes_batch_move'?['folder_id']:['title','icon','pinned','favorite']);
 if(!changes||!Object.keys(changes).length||Object.keys(changes).some(k=>!allowed.has(k)))fail('INVALID_ARGUMENT','Invalid batch metadata');
 for(const [k,v]of Object.entries(changes)){
  if(k==='title'&&(typeof v!=='string'||v.length>200)||k==='icon'&&(typeof v!=='string'||v.length>16)||!purge&&['pinned','favorite'].includes(k)&&typeof v!=='boolean'||k==='folder_id'&&(typeof v!=='string'||v!==''&&!/^[a-f0-9-]{36}$/.test(v)))fail('INVALID_ARGUMENT','Invalid batch metadata');
 }
 const keys=Object.keys(changes),values=Object.values(changes).map(v=>typeof v==='boolean'?+v:v);
 statements.push(env.DB.prepare('UPDATE notes_json SET '+keys.map(k=>k+'=?').join(',')+",version=version+1,mutation=?,updated=? WHERE workspace=? AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?)) AND purged=0 AND (deleted=0 OR ?=1)").bind(...values,tx,now,workspace,targets,purge?1:0));
 if(purge)statements.push(env.DB.prepare("UPDATE note_receipts SET response=(SELECT json_object('id',id,'title',title,'document',document,'icon',icon,'pinned',pinned,'favorite',favorite,'deleted',deleted,'purged',purged,'version',version,'mutation',mutation,'updated',updated,'folder_id',folder_id) FROM notes_json n WHERE n.workspace=note_receipts.workspace AND n.id=note_receipts.note_id) WHERE workspace=? AND note_id IN(SELECT json_extract(value,'$.id') FROM json_each(?))").bind(workspace,targets));
 // Assertion rows contain no content and never survive a successful transaction.
 // A final bounded cleanup can safely remove all rows: transactions serialize.
 statements.push(env.DB.prepare('DELETE FROM workspace_tx_assertions'));
 try{await env.DB.batch(statements)}catch(error){if(/CHECK constraint failed|workspace_tx_assertions|constraint.*valid/i.test(error.message))fail('CONFLICT','A batch target, destination or authorization changed; no notes were modified');throw error}
 return {atomic:true,mutation:tx,results:items.map(item=>({id:item.id,version:item.version+1,ok:true}))};
}
