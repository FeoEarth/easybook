import {get,save,revision,textDocument} from './mcp-notes.mjs';
import {fail,walk,nodeText,at,splice} from './mcp-common.mjs';
export function tasks(n){const found=[];walk(n.document.doc,(node,path)=>{if(node.type==='taskItem')found.push({note_id:n.id,version:n.version,path,completed:node.attrs.checked,text:nodeText(node.content[0]),depth:path.length,parent_path:path.slice(0,-1)})});return found;}
function task(n,p){const t=at(n.document.doc,p);if(t.type!=='taskItem')fail('CONFLICT','Path is not a taskItem');return t;}
export async function taskTool(ctx,name,a){
 if(name==='tasks_list'){
  const limit=a.limit||20;let c={id:'',index:0};if(a.cursor){try{c=JSON.parse(atob(a.cursor));if(typeof c.id!=='string'||!Number.isSafeInteger(c.index)||c.index<0||c.filter!==JSON.stringify([a.note_id??null,a.completed??null]))throw Error()}catch{fail('INVALID_ARGUMENT','Invalid task cursor')}}
  const rows=a.note_id?[await get(ctx,a.note_id)]:(await ctx.env.DB.prepare('SELECT id,version,document FROM notes_json WHERE workspace=? AND deleted=0 AND purged=0 AND id>=? ORDER BY id LIMIT 5').bind(ctx.workspace,c.id).all()).results.map(n=>({...n,document:JSON.parse(n.document)}));
  const out=[];let scanned=0;
  for(const n of rows){if(c.id===n.id&&c.version!==undefined&&c.version!==n.version)fail('CONFLICT','Task page changed; restart listing');const all=tasks(n);for(let i=n.id===c.id?c.index:0;i<all.length;i++){const t=all[i];if(a.completed===undefined||t.completed===a.completed){out.push(t);if(out.length===limit)return {tasks:out,next_cursor:btoa(JSON.stringify({id:n.id,index:i+1,version:n.version,filter:JSON.stringify([a.note_id??null,a.completed??null])})),scanned_notes:scanned+1};}}scanned++;}
  return {tasks:out,next_cursor:!a.note_id&&rows.length===5?btoa(JSON.stringify({id:rows.at(-1).id+'~',index:0,filter:JSON.stringify([null,a.completed??null])})):null,scanned_notes:scanned};
 }
 const n=await get(ctx,a.id);revision(n,a.version);
 if(name==='tasks_get'){const t=task(n,a.path);return {note_id:n.id,version:n.version,path:a.path,completed:t.attrs.checked,text:nodeText(t.content[0]),document:t};}
 if(name==='tasks_create'){
  const item={type:'taskItem',attrs:{checked:a.checked||false},content:textDocument(a.text).doc.content};
  if(a.list_path){const list=at(n.document.doc,a.list_path);if(list.type!=='taskList')fail('INVALID_ARGUMENT','list_path must address a taskList');list.content.push(item)}else n.document.doc.content.push({type:'taskList',content:[item]});
 }else if(name==='tasks_batch_complete'){for(const t of a.tasks)task(n,t.path).attrs.checked=true;}
 else {
  const t=task(n,a.path);
  if(name==='tasks_delete'){
   const listPath=a.path.slice(0,-1),list=at(n.document.doc,listPath);splice(n.document.doc,a.path,[]);
   if(!list.content.length){splice(n.document.doc,listPath,[]);if(!n.document.doc.content.length)n.document=textDocument('');}
  }else if(name==='tasks_complete')t.attrs.checked=true;
  else if(name==='tasks_reopen')t.attrs.checked=false;
  else if(name==='tasks_update'){
   if(a.checked!==undefined)t.attrs.checked=a.checked;
   if(a.text!==undefined){const paragraph=t.content[0];if((paragraph.content||[]).some(x=>x.type!=='text')||(paragraph.content||[]).length>1)fail('AMBIGUOUS_MATCH','Use notes_replace_text for a task with multiple formatted spans');const old=paragraph.content?.[0];paragraph.content=a.text?[{type:'text',text:a.text,...(old?.marks?{marks:old.marks}:{})}]:[];}
  }else fail('INVALID_ARGUMENT','Unknown task tool');
 }
 return save(ctx,n);
}
