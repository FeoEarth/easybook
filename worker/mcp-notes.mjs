import {notes} from './notes.mjs';
import {validateDocument,emptyDocument,plainText} from '../shared/document.mjs';
import {fail,nodeText,walk,at,splice} from './mcp-common.mjs';
export const columns='id,title,document,icon,pinned,favorite,deleted,purged,version,mutation,updated,folder_id';
export const meta='id,title,icon,pinned,favorite,deleted,version,updated,folder_id';
export const textDocument=text=>({schemaVersion:1,doc:{type:'doc',content:text.split('\n').map(t=>({type:'paragraph',...(t?{content:[{type:'text',text:t}]}:{})}))}});
export async function get(ctx,id,deleted=false){const n=await ctx.env.DB.prepare(`SELECT ${columns} FROM notes_json WHERE workspace=? AND id=? AND purged=0 ${deleted?'':'AND deleted=0'}`).bind(ctx.workspace,id).first();if(!n)fail('NOT_FOUND','Note not found');n.document=validateDocument(JSON.parse(n.document));return n;}
export async function folderExists(ctx,id){if(id&&!await ctx.env.DB.prepare('SELECT id FROM folders WHERE workspace=? AND id=? AND deleted=0').bind(ctx.workspace,id).first())fail('NOT_FOUND','Folder not found');}
export function revision(n,v){if(n.version!==v)fail('CONFLICT','Note changed; reread before editing',{current_version:n.version});}
export async function save(ctx,n){validateDocument(n.document);await folderExists(ctx,n.folder_id);const r=await notes(new Request('https://internal/api/notes/'+n.id,{method:'PUT',body:JSON.stringify({...n,mutation:crypto.randomUUID()})}),ctx.env,ctx.workspace,new URL('https://internal/api/notes/'+n.id),(x,status=200)=>Response.json(x,{status}));const v=await r.json();if(!r.ok)fail(r.status===409?'CONFLICT':'INVALID_ARGUMENT',r.status===409?'Note changed; reread before editing':'Note rejected by shared sync service',{current_version:v.note?.version});return summary(v.note);}
export function summary(n,fields){const out={};for(const k of fields||meta.split(','))out[k]=n[k];return out;}
export function present(n,args={}){
 const out=summary(n,args.fields);if(args.format==='metadata')return out;
 if(args.format==='text'){const text=plainText(n.document),start=args.offset||0,end=start+(args.length||20000);return {...out,text:text.slice(start,end),total_length:text.length,next_offset:end<text.length?end:null};}
 const start=args.offset||0,content=n.document.doc.content||[];let size=0,end=start;const selected=[];
 for(;end<content.length;end++){const part=content[end],bytes=JSON.stringify(part).length;if(selected.length&&size+bytes>40000)break;if(bytes>180000)fail('RESOURCE_TOO_LARGE','Single node exceeds resource budget; use text segments');selected.push(part);size+=bytes;if(selected.length>=30) {end++;break}}
 return {...out,document:{schemaVersion:1,doc:{type:'doc',content:selected}},document_segment:true,total_nodes:content.length,offset:start,next_offset:end<content.length?end:null};
}
export async function list(ctx,a={},search=false){
 const clauses=['workspace=?','deleted=?','purged=0'],params=[ctx.workspace,a.deleted?1:0];
 if(a.folder_id!==undefined){clauses.push('folder_id=?');params.push(a.folder_id)}
 if(search){clauses.push("(title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_tree(notes_json.document) jt WHERE jt.key='text' AND jt.type='text' AND jt.value LIKE ? ESCAPE '\\'))");const q='%'+a.query.replace(/[\\%_]/g,c=>'\\'+c)+'%';params.push(q,q)}
 const asc=a.sort==='updated_asc';if(a.cursor){let c;try{c=JSON.parse(atob(a.cursor))}catch{fail('INVALID_ARGUMENT','Invalid note cursor')}if(!Array.isArray(c)||!Number.isSafeInteger(c[0])||typeof c[1]!=='string'||c[2]!==JSON.stringify([a.folder_id??null,a.deleted||false,a.query??null,asc]))fail('INVALID_ARGUMENT','Cursor does not match query');clauses.push(`(updated ${asc?'>':'<'} ? OR (updated=? AND id ${asc?'>':'<'} ?))`);params.push(c[0],c[0],c[1])}
 const limit=a.limit||20;const rows=(await ctx.env.DB.prepare(`SELECT ${meta} FROM notes_json WHERE ${clauses.join(' AND ')} ORDER BY updated ${asc?'ASC':'DESC'},id ${asc?'ASC':'DESC'} LIMIT ?`).bind(...params,limit+1).all()).results;
 const more=rows.length>limit;rows.length=Math.min(rows.length,limit);const last=rows.at(-1);
 const output=[];if(a.format&&a.format!=='metadata'&&limit>5)fail('INVALID_ARGUMENT','Use limit<=5 for list body output');for(const n of rows)output.push(a.format&&a.format!=='metadata'?present(await get(ctx,n.id,!!a.deleted),a):summary(n,a.fields));
 return {notes:output,next_cursor:more?btoa(JSON.stringify([last.updated,last.id,JSON.stringify([a.folder_id??null,a.deleted||false,a.query??null,asc])])):null};
}
export async function noteTool(ctx,name,a){
 if(name==='notes_list'||name==='notes_search')return list(ctx,a,name==='notes_search');
 if(name==='notes_batch_get'){const out=[];for(const id of a.ids){try{out.push(present(await get(ctx,id),a))}catch(e){out.push({id,error:e.code||'INTERNAL'})}}return {notes:out}}
 if(name==='notes_create'){if(a.document&&a.text!==undefined)fail('INVALID_ARGUMENT','Choose document or text');const n={id:crypto.randomUUID(),title:a.title,icon:a.icon||'📄',pinned:a.pinned?1:0,favorite:a.favorite?1:0,deleted:0,purged:0,version:0,folder_id:a.folder_id||'',document:a.document||textDocument(a.text||'')};return save(ctx,n)}
 const n=await get(ctx,a.id,name==='notes_restore');
 if(name==='notes_get')return present(n,a);
 if(name==='notes_get_outline'){const outline=[];walk(n.document.doc,(node,p)=>{if(node.type==='heading')outline.push({path:p,level:node.attrs.level,text:nodeText(node)})});return {id:n.id,version:n.version,outline};}
 if(name==='notes_find_in_note'){const matches=[];walk(n.document.doc,(node,p)=>{if(node.type==='text'&&node.text.includes(a.query)&&matches.length<100)matches.push({path:p,text:node.text.slice(0,1000),offset:node.text.indexOf(a.query)})});return {id:n.id,version:n.version,matches,limit:100};}
 revision(n,a.version);
 if(name==='notes_duplicate')return save(ctx,{...n,id:crypto.randomUUID(),version:0,title:a.title??n.title,folder_id:a.folder_id??n.folder_id,deleted:0});
 if(name==='notes_update'){for(const k of ['title','icon','folder_id'])if(a[k]!==undefined)n[k]=a[k];for(const k of ['pinned','favorite'])if(a[k]!==undefined)n[k]=+a[k];if(a.document)n.document=validateDocument(a.document);}
 else if(name==='notes_append'){if(a.document&&a.text!==undefined||!a.document&&a.text===undefined)fail('INVALID_ARGUMENT','Provide document or text');n.document.doc.content.push(...validateDocument(a.document||textDocument(a.text)).doc.content);}
 else if(name==='notes_move')n.folder_id=a.folder_id;
 else if(name==='notes_pin')n.pinned=+a.pinned;
 else if(name==='notes_delete')n.deleted=1;
 else if(name==='notes_restore')n.deleted=0;
 else if(name==='notes_replace_text'){const node=at(n.document.doc,a.path);if(node.type!=='text')fail('INVALID_ARGUMENT','Path must address one text node');const first=node.text.indexOf(a.find);if(first<0||node.text.indexOf(a.find,first+a.find.length)>=0)fail('AMBIGUOUS_MATCH','Expected one match in selected text node');node.text=node.text.slice(0,first)+a.replace+node.text.slice(first+a.find.length);if(!node.text)splice(n.document.doc,a.path,[]);}
 else if(name==='notes_insert_section'){if(a.index>n.document.doc.content.length)fail('INVALID_ARGUMENT','Index out of range');if(a.document&&a.text!==undefined)fail('INVALID_ARGUMENT','Choose document or text');const nodes=[{type:'heading',attrs:{level:a.level},content:[{type:'text',text:a.title}]},...validateDocument(a.document||textDocument(a.text||'')).doc.content];n.document.doc.content.splice(a.index,0,...nodes);}
 else fail('INVALID_ARGUMENT','Unknown note tool');
 return save(ctx,n);
}
