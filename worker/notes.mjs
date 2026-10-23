import {validateDocument} from '../shared/document.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields='id,title,document,icon,favorite,deleted,version,mutation,updated,folder_id';
const decode=n=>{if(!n)return null;return {...n,document:validateDocument(JSON.parse(n.document))}};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function notes(request,env,workspace,url,json){
 if(url.pathname==='/api/notes'&&request.method==='GET'){
  const raw=url.searchParams.get('cursor')||'0';if(!/^\d{1,15}$/.test(raw))return json({error:'Invalid cursor'},400);const cursor=Number(raw);
  const {results}=await env.DB.prepare(`SELECT c.cursor,${fields.split(',').map(f=>'n.'+f).join(',')} FROM note_changes c JOIN notes_json n ON n.workspace=c.workspace AND n.id=c.note_id WHERE c.workspace=? AND c.cursor>? ORDER BY c.cursor LIMIT 100`).bind(workspace,cursor).all();
  return json({notes:results.map(({cursor,...n})=>decode(n)),cursor:results.at(-1)?.cursor||cursor,hasMore:results.length===100});
 }
 const id=url.pathname.match(/^\/api\/notes\/([^/]+)$/)?.[1];if(!id||!uuid.test(id)||request.method!=='PUT')return json({error:'Not found'},404);
 const reader=request.body?.getReader();if(!reader)return json({error:'Missing body'},400);let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>230000){await reader.cancel();return json({error:'Too large'},413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 let n;try{n=JSON.parse(new TextDecoder().decode(bytes));if(!n||typeof n!=='object'||Array.isArray(n)||n.body!==undefined)throw Error();validateDocument(n.document);
 if(typeof n.title!=='string'||n.title.length>200||typeof n.icon!=='string'||n.icon.length>16||!Number.isSafeInteger(n.version)||n.version<0||!uuid.test(n.mutation)||![0,1].includes(n.favorite)||![0,1].includes(n.deleted)||typeof n.folder_id!=='string'||n.folder_id!==''&&!uuid.test(n.folder_id))throw Error();}catch{return json({error:'Invalid JSON note/schemaVersion'},400)}
 const payload={title:n.title,document:n.document,icon:n.icon,favorite:n.favorite,deleted:n.deleted,folder_id:n.folder_id,version:n.version,mutation:n.mutation};
 const requestHash=await hash(JSON.stringify({id,...payload}));
 const prior=await env.DB.prepare('SELECT note_id,request_hash,response FROM note_receipts WHERE workspace=? AND mutation=?').bind(workspace,n.mutation).first();
 if(prior){if(prior.note_id!==id||prior.request_hash!==requestHash)return json({error:'Mutation reused with different payload'},409);return json({note:decode(JSON.parse(prior.response)),replayed:true})}
 if(n.folder_id&&!await env.DB.prepare('SELECT id FROM folders WHERE workspace=? AND id=?').bind(workspace,n.folder_id).first())return json({error:'Folder missing'},400);
 const updated=Date.now(),document=JSON.stringify(n.document);
 // One transaction: conditional CAS, immutable receipt for this mutation, then current state.
 const insert=env.DB.prepare(`INSERT INTO notes_json(workspace,id,title,document,icon,favorite,deleted,version,mutation,updated,folder_id) SELECT ?,?,?,?,?,?,?,1,?,?,? WHERE ?=0 AND NOT EXISTS(SELECT 1 FROM note_receipts WHERE workspace=? AND mutation=?) ON CONFLICT(workspace,id) DO NOTHING`).bind(workspace,id,n.title,document,n.icon,n.favorite,n.deleted,n.mutation,updated,n.folder_id,n.version,workspace,n.mutation);
 const update=env.DB.prepare('UPDATE notes_json SET title=?,document=?,icon=?,favorite=?,deleted=?,version=version+1,mutation=?,updated=?,folder_id=? WHERE workspace=? AND id=? AND version=? AND NOT EXISTS(SELECT 1 FROM note_receipts WHERE workspace=? AND mutation=?)').bind(n.title,document,n.icon,n.favorite,n.deleted,n.mutation,updated,n.folder_id,workspace,id,n.version,workspace,n.mutation);
 const receipt=env.DB.prepare(`INSERT INTO note_receipts(workspace,mutation,note_id,request_hash,response) SELECT workspace,mutation,id,?,json_object('id',id,'title',title,'document',document,'icon',icon,'favorite',favorite,'deleted',deleted,'version',version,'mutation',mutation,'updated',updated,'folder_id',folder_id) FROM notes_json WHERE workspace=? AND id=? AND mutation=? AND version=? ON CONFLICT(workspace,mutation) DO NOTHING`).bind(requestHash,workspace,id,n.mutation,n.version+1);
 const read=env.DB.prepare(`SELECT ${fields} FROM notes_json WHERE workspace=? AND id=?`).bind(workspace,id);
 const results=await env.DB.batch([n.version===0?insert:update,receipt,read,env.DB.prepare('SELECT note_id,request_hash,response FROM note_receipts WHERE workspace=? AND mutation=?').bind(workspace,n.mutation)]);
 const accepted=results[3].results[0];if(accepted&&accepted.note_id===id&&accepted.request_hash===requestHash)return json({note:decode(JSON.parse(accepted.response))});
 return json({error:'Conflict',note:decode(results[2].results[0])},409);
}
