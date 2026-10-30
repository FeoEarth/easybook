import {attachmentDeleted} from './attachment-purge.mjs';
import {hasWorkspaceGrant} from './account-grants.mjs';
import {fail,hash,at,splice} from './mcp-common.mjs';
import {get,save,revision,textDocument} from './mcp-notes.mjs';
export async function manifest(ctx,id){
 if(await attachmentDeleted(ctx.env,ctx.workspace,id))fail('NOT_FOUND','Attachment permanently deleted');
 const b=ctx.env.ATTACHMENTS;if(!b)fail('UNAVAILABLE','Attachment binding unavailable');
 const object=await b.get(ctx.workspace+'/'+id+'/manifest-v2');let m;
 if(object){if(object.size>16384)fail('INVALID_ATTACHMENT','Manifest too large');m=await object.json();}
 else {const old=await b.head(ctx.workspace+'/'+id);if(!old)fail('NOT_FOUND','Attachment not found');let name='附件';try{name=decodeURIComponent(old.customMetadata?.name||name)}catch{}m={id,name,mime:old.customMetadata?.mime||'application/octet-stream',size:old.size,legacy:true,localOnly:false};}
 if(m.id!==id||typeof m.name!=='string'||typeof m.mime!=='string'||!Number.isSafeInteger(m.size))fail('INVALID_ATTACHMENT','Invalid attachment metadata');return m;
}
const safe=m=>({id:m.id,name:m.name,mime:m.mime,size:m.size,local_only:!!m.localOnly,download_available:!m.localOnly,...(m.provenance?{provenance:m.provenance}:{}),...(m.width?{width:m.width,height:m.height}:{})});
async function retired(ctx,id){return !!await ctx.env.DB.prepare('SELECT attachment FROM mcp_attachment_retirements WHERE workspace=? AND attachment=?').bind(ctx.workspace,id).first()}
export async function attachmentTool(ctx,name,a){
 if(name==='attachments_list'||name==='attachments_search'){
  if(!ctx.env.ATTACHMENTS)fail('UNAVAILABLE','Attachment binding unavailable');
  const r=await ctx.env.ATTACHMENTS.list({prefix:ctx.workspace+'/',delimiter:'/',limit:a.limit||20,...(a.cursor?{cursor:a.cursor}:{})});
  const ids=[...new Set([...(r.delimitedPrefixes||[]).map(p=>p.slice(ctx.workspace.length+1,-1)),...r.objects.map(o=>o.key.slice(ctx.workspace.length+1))])].filter(id=>/^[a-f0-9]{64}$/.test(id)).slice(0,30),out=[];
  for(const id of ids){try{const m=await manifest(ctx,id);if(a.query&&!m.name.toLowerCase().includes(a.query.toLowerCase())||a.mime&&!m.mime.startsWith(a.mime)||await retired(ctx,id))continue;out.push(safe(m))}catch(e){if(e.code!=='NOT_FOUND')throw e}}
  return {attachments:out,next_cursor:r.truncated?r.cursor:null,filter_applied_to_page:true};
 }
 const m=await manifest(ctx,a.attachment_id);
 if(name==='attachments_get_metadata')return {...safe(m),retired:await retired(ctx,m.id)};
 if(name==='attachments_get_download_url'){
  if(!ctx.client)fail('PERMISSION_DENIED','Download tickets require OAuth client identity');if(m.localOnly)fail('UNAVAILABLE','Attachment bytes are device-local');
  await ctx.env.DB.prepare('DELETE FROM mcp_downloads WHERE token_hash IN (SELECT token_hash FROM mcp_downloads WHERE expires<? LIMIT 100)').bind(Date.now()).run();
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),expires=Date.now()+300000;
  await ctx.env.DB.prepare('INSERT INTO mcp_downloads(token_hash,workspace,client,attachment,expires) VALUES(?,?,?,?,?)').bind(await hash(token),ctx.workspace,ctx.client,m.id,expires).run();
  return {url:'https://easybook.loonxy.com/api/mcp/download?ticket='+token,expires_at:expires,warning:'短期 bearer 下载链接；仅分享给获授权用户，不自动向第三方 AI 发送文件。'};
 }
 if(name==='attachments_delete'){
  // Reversible retirement only. Existing offline clients and references retain their bytes.
  const ref=await ctx.env.DB.prepare("SELECT id FROM notes_json WHERE workspace=? AND purged=0 AND EXISTS(SELECT 1 FROM json_tree(document) jt WHERE jt.key='assetId' AND jt.value=?) LIMIT 1").bind(ctx.workspace,'sha256:'+m.id).first();
  if(ref)fail('ATTACHMENT_IN_USE','Remove references from all notes, including recently deleted notes, first');
  await ctx.env.DB.prepare('INSERT INTO mcp_attachment_retirements(workspace,attachment,updated) VALUES(?,?,?) ON CONFLICT(workspace,attachment) DO UPDATE SET updated=excluded.updated').bind(ctx.workspace,m.id,Date.now()).run();
  return {id:m.id,retired:true,bytes_preserved:true,permanent_delete:false};
 }
 const n=await get(ctx,a.id);revision(n,a.version);
 if(name==='attachments_attach_to_note'){
  if(await retired(ctx,m.id))fail('ATTACHMENT_RETIRED','Attachment is retired');
  if(a.as_image&&!m.mime.startsWith('image/'))fail('INVALID_ARGUMENT','Attachment is not an image');
  const node=a.as_image?{type:'image',attrs:{assetId:'sha256:'+m.id,alt:m.name,...(m.width?{width:m.width,height:m.height}:{})}}:{type:'attachment',attrs:{assetId:'sha256:'+m.id,name:m.name,mime:m.mime,size:m.size}};
  const i=a.index??n.document.doc.content.length;if(i>n.document.doc.content.length)fail('INVALID_ARGUMENT','Index out of range');const nodes=[node];if(a.as_image&&m.provenance&&Object.keys(m.provenance).length){const p=m.provenance,label=[p.ai_generated?'AI 生成示意图，非新闻现场照片':'图片来源',p.author,p.license,p.source_url].filter(Boolean).join(' · ');nodes.push({type:'paragraph',content:[{type:'text',text:label}]})}n.document.doc.content.splice(i,0,...nodes);
 }else if(name==='attachments_detach_from_note'){
  const node=at(n.document.doc,a.path);if(!['image','attachment'].includes(node.type)||node.attrs.assetId!=='sha256:'+m.id)fail('CONFLICT','Attachment path mismatch');splice(n.document.doc,a.path,[]);if(!n.document.doc.content.length)n.document=textDocument('');
 }else fail('INVALID_ARGUMENT','Unknown attachment tool');
 return save(ctx,n);
}
export async function download(request,env){
 const ticket=new URL(request.url).searchParams.get('ticket');if(!/^[a-f0-9]{64}$/.test(ticket||''))return new Response('Invalid ticket',{status:403});
 const row=await env.DB.prepare('SELECT d.workspace,d.client,d.attachment FROM mcp_downloads d WHERE d.token_hash=? AND d.expires>? ').bind(await hash(ticket),Date.now()).first();
 if(!row||!await hasWorkspaceGrant(env,row.workspace,row.client))return new Response('Expired or revoked ticket',{status:403});
 const ctx={env,workspace:row.workspace},m=await manifest(ctx,row.attachment);if(m.localOnly)return new Response('Device local',{status:404});
 const base=row.workspace+'/'+row.attachment;
 let body;
 if(m.legacy){const o=await env.ATTACHMENTS.get(base);if(!o)return new Response('Not found',{status:404});body=o.body;}
 else {
  if(!/^[a-f0-9]{64}$/.test(m.wireId)||!Array.isArray(m.parts)||m.parts.length>13||!['identity','gzip'].includes(m.encoding))return new Response('Invalid manifest',{status:409});
  async function* parts(){for(let i=0;i<m.parts.length;i++){const o=await env.ATTACHMENTS.get(base+'/'+m.wireId+'/'+i);if(!o)throw Error('Missing attachment part');for await(const b of o.body)yield b}}
  const iterator=parts();body=new ReadableStream({async pull(c){try{const x=await iterator.next();x.done?c.close():c.enqueue(x.value)}catch(e){c.error(e)}},cancel(){return iterator.return()}});
  if(m.encoding==='gzip')body=body.pipeThrough(new DecompressionStream('gzip'));
 }
 let size=0;const digest=new crypto.DigestStream('SHA-256'),writer=digest.getWriter();
 body=body.pipeThrough(new TransformStream({async transform(chunk,c){size+=chunk.byteLength;if(size>m.size||size>1073741824)throw Error('Attachment size exceeded');await writer.write(chunk);c.enqueue(chunk)},async flush(){await writer.close();const actual=Array.from(new Uint8Array(await digest.digest),b=>b.toString(16).padStart(2,'0')).join('');if(size!==m.size||actual!==m.id)throw Error('Attachment integrity check failed')}}));
 return new Response(body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(m.name),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}


