import {hasWorkspaceGrant} from './account-grants.mjs';
import {Buffer} from 'node:buffer';
import {fail,hash,canonical,need} from './mcp-common.mjs';
import {permissions} from './mcp-access.mjs';
import {attachments} from './attachments.mjs';
import {CHUNK,MAX_UPLOAD,MIME,decodeBase64,sniff} from './mcp-upload-types.mjs';
const ORIGIN='https://easybook-mcp-oauth.1902521952.workers.dev';
const hex=b=>Buffer.from(b).toString('hex'),sha=async b=>hex(await crypto.subtle.digest('SHA-256',b));
const temp=(s,i)=>'_mcp_uploads/'+s.workspace+'/'+s.id+'/'+i;
const publicStatus=s=>({upload_id:s.id,status:s.status,size:s.size,mime_type:s.mime,filename:s.filename,expires_at:s.expires,attachment_id:s.attachment_id||null,error:s.error||null});
async function authorized(ctx){
 need(ctx,'attachments.write');if(!ctx.client)fail('PERMISSION_DENIED','Upload requires a paired OAuth client');
 const g=await hasWorkspaceGrant(ctx.env,ctx.workspace,ctx.client);
 if(!g||(await permissions(ctx.env,ctx.workspace,ctx.client)).includes('attachments.write')===false)fail('PERMISSION_DENIED','OAuth workspace upload permission is missing or revoked');
 if(!ctx.env.ATTACHMENTS||!ctx.env.MCP_PAIRING_SIGNING_KEY)fail('UNAVAILABLE','Upload storage is unavailable');
}
async function ticket(env,s){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MCP_PAIRING_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('easybook-upload-v1|'+s.workspace+'|'+s.client+'|'+s.id+'|'+s.expires)));}
async function row(ctx,id){const s=await ctx.env.DB.prepare('SELECT * FROM mcp_uploads WHERE workspace=? AND client=? AND id=?').bind(ctx.workspace,ctx.client,id).first();if(!s)fail('NOT_FOUND','Upload session not found');return s;}
async function clearTemp(env,s){await env.ATTACHMENTS.delete(Array.from({length:Math.ceil(s.size/CHUNK)},(_,i)=>temp(s,i)));}
export async function cleanupUploads(env,limit=2){
 if(!env.ATTACHMENTS)return;
 const now=Date.now();const rows=(await env.DB.prepare("SELECT * FROM mcp_uploads WHERE (status IN ('pending','failed','completing') OR error='CLEANUP_PENDING') AND expires<? AND lease_until<? ORDER BY expires LIMIT ?").bind(now,now,limit).all()).results;
 for(const s of rows){await env.DB.prepare("UPDATE mcp_uploads SET status='expired',error='CLEANUP_PENDING',lease=NULL,lease_until=0 WHERE id=? AND status<>'complete' AND lease_until<?").bind(s.id,now).run();await clearTemp(env,s);await env.DB.prepare("UPDATE mcp_uploads SET error=NULL WHERE id=?").bind(s.id).run();await env.DB.prepare("DELETE FROM mcp_uploads WHERE id=? AND expires<? AND status IN ('expired','aborted')").bind(s.id,now-86400000).run();}
 const cleanup=(await env.DB.prepare("SELECT * FROM mcp_uploads WHERE status='complete' AND error='CLEANUP_PENDING' LIMIT ?").bind(limit).all()).results;for(const s of cleanup){await clearTemp(env,s);await env.DB.prepare('UPDATE mcp_uploads SET error=NULL WHERE id=?').bind(s.id).run();}
 await env.DB.prepare("DELETE FROM mcp_uploads WHERE id IN (SELECT id FROM mcp_uploads WHERE status IN ('expired','aborted') AND error IS NULL AND expires<? LIMIT 50)").bind(now-86400000).run();
 // Completed sessions retain the idempotent result for a day; never delete registered attachment bytes.
 await env.DB.prepare("DELETE FROM mcp_uploads WHERE id IN (SELECT id FROM mcp_uploads WHERE status='complete' AND created<? LIMIT 50)").bind(now-86400000).run();
 await env.DB.prepare('DELETE FROM mcp_upload_budgets WHERE day<?').bind(Math.floor(now/86400000)-2).run();
}
async function prepared(ctx,s){return {...publicStatus(s),chunk_size:CHUNK,parts:Math.ceil(s.size/CHUNK),upload_method:'PUT',upload_url:(ctx.uploadOrigin||ORIGIN)+'/uploads/'+s.id+'?part={part_index}',headers:{Authorization:'Bearer '+await ticket(ctx.env,s),'Content-Type':'application/octet-stream'},instructions:'按0开始的part_index上传原始二进制；除最后一块外每块4 MiB。完成全部分块后调用 attachments_complete_upload。不要将完整文件作为一个超大MCP JSON请求。'};}
async function prepare(ctx,a){
 await cleanupUploads(ctx.env);
 if(!MIME.includes(a.mime_type)||!a.filename.trim()||/[\x00-\x1f\x7f/\\]/.test(a.filename)||!Number.isSafeInteger(a.size)||a.size<1||a.size>MAX_UPLOAD)fail('INVALID_ARGUMENT','Invalid filename, MIME or upload size');
 const request_id=a.request_id||crypto.randomUUID(),payload={filename:a.filename,mime_type:a.mime_type,size:a.size,sha256:a.sha256||null,provenance:a.provenance||{}},fingerprint=await hash(canonical(payload));
 const old=await ctx.env.DB.prepare('SELECT * FROM mcp_uploads WHERE workspace=? AND client=? AND request_id=?').bind(ctx.workspace,ctx.client,request_id).first();
 if(old){if(old.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','request_id was used for a different upload');if(old.status==='complete')return publicStatus(old);if(old.expires<=Date.now()||old.status!=='pending')fail('UPLOAD_UNAVAILABLE','Upload is no longer pending');return prepared(ctx,old);}
 const now=Date.now(),day=Math.floor(now/86400000),id=crypto.randomUUID(),expires=now+15*60000;
 // Quota and session creation are one D1 transaction; no attachment catalog is duplicated.
 const quota=ctx.env.DB.prepare("INSERT INTO mcp_upload_budgets(workspace,day,requests,reserved_bytes) SELECT ?,?,1,? WHERE (SELECT COUNT(*) FROM mcp_uploads WHERE workspace=? AND status IN ('pending','completing') AND expires>?)<5 ON CONFLICT(workspace,day) DO UPDATE SET requests=requests+1,reserved_bytes=reserved_bytes+excluded.reserved_bytes WHERE requests<60 AND reserved_bytes+excluded.reserved_bytes<=524288000 AND (SELECT COUNT(*) FROM mcp_uploads WHERE workspace=? AND status IN ('pending','completing') AND expires>?)<5").bind(ctx.workspace,day,a.size,ctx.workspace,now,ctx.workspace,now);
 const insert=ctx.env.DB.prepare('INSERT INTO mcp_uploads(id,workspace,client,request_id,fingerprint,filename,mime,size,expected_sha,provenance,created,expires) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1 ON CONFLICT(workspace,client,request_id) DO NOTHING').bind(id,ctx.workspace,ctx.client,request_id,fingerprint,a.filename,a.mime_type,a.size,a.sha256||null,JSON.stringify(a.provenance||{}),now,expires);
 const r=await ctx.env.DB.batch([quota,insert]);if(r[0].meta.changes!==1)fail('QUOTA_EXCEEDED','Limit: 5 active uploads, 60 preparations and 500 MiB reserved per workspace per UTC day');
 const s=await ctx.env.DB.prepare('SELECT * FROM mcp_uploads WHERE workspace=? AND client=? AND request_id=?').bind(ctx.workspace,ctx.client,request_id).first();if(s.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Concurrent request_id mismatch');return prepared(ctx,s);
}
async function readBytes(request,limit){
 const length=request.headers.get('Content-Length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))fail('FILE_TOO_LARGE','Chunk exceeds limit');
 const reader=request.body?.getReader();if(!reader)fail('INVALID_ARGUMENT','Missing chunk body');let size=0;const pieces=[];for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('FILE_TOO_LARGE','Chunk exceeds limit')}pieces.push(value)}const bytes=new Uint8Array(size);let at=0;for(const b of pieces){bytes.set(b,at);at+=b.length}return bytes;
}
async function putPart(ctx,s,index,bytes){
 if(s.expires<=Date.now()||s.status!=='pending')fail('UPLOAD_UNAVAILABLE','Upload is expired, aborted or being committed');
 const expected=Math.min(CHUNK,s.size-index*CHUNK);if(!Number.isInteger(index)||index<0||expected<1||bytes.length!==expected)fail('SIZE_MISMATCH','Chunk size or index does not match prepared upload');
 const permit=await ctx.env.DB.prepare("UPDATE mcp_uploads SET attempts=attempts+1 WHERE id=? AND status='pending' AND expires>? AND attempts<64").bind(s.id,Date.now()).run();if(permit.meta.changes!==1)fail('QUOTA_EXCEEDED','Upload expired or exceeded 64 chunk attempts');
 const digest=await sha(bytes),key=temp(s,index);const old=await ctx.env.ATTACHMENTS.head(key);
 if(old&&(old.size!==bytes.length||old.customMetadata?.sha256!==digest))fail('CHUNK_CONFLICT','Uploaded chunks are immutable');
 if(!old){const saved=await ctx.env.ATTACHMENTS.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:digest}});if(!saved){const winner=await ctx.env.ATTACHMENTS.head(key);if(winner?.customMetadata?.sha256!==digest||winner?.size!==bytes.length)fail('CHUNK_CONFLICT','Concurrent chunk mismatch')}}
 const latest=await row(ctx,s.id);if(latest.status!=='pending'||latest.expires<=Date.now()){await ctx.env.ATTACHMENTS.delete(key);fail('UPLOAD_UNAVAILABLE','Upload no longer accepts chunks')}
 return {upload_id:s.id,part_index:index,size:bytes.length,sha256:digest};
}
async function complete(ctx,s){
 if(s.status==='complete')return publicStatus(s);
 if(s.expires<=Date.now())fail('UPLOAD_EXPIRED','Upload session expired');
 const lease=crypto.randomUUID();const claim=await ctx.env.DB.prepare("UPDATE mcp_uploads SET status='completing',lease=?,lease_until=? WHERE id=? AND ((status='pending') OR (status='completing' AND lease_until<?)) AND expires>?").bind(lease,Date.now()+120000,s.id,Date.now(),Date.now()).run();
 if(claim.meta.changes!==1)fail('UPLOAD_BUSY','Upload is being committed or is no longer pending');
 let invalid=false;
 try{
  const parts=[],digest=new crypto.DigestStream('SHA-256');digest.digest.catch(()=>{});const writer=digest.getWriter();let count=0,prefix=new Uint8Array(0),tail=new Uint8Array(0);const decoder=s.mime==='text/plain'?new TextDecoder('utf-8',{fatal:true}):null;
  try{
   for(let i=0;i<Math.ceil(s.size/CHUNK);i++){
    const o=await ctx.env.ATTACHMENTS.get(temp(s,i));if(!o)fail('UPLOAD_INCOMPLETE','A required chunk is missing');const expected=Math.min(CHUNK,s.size-i*CHUNK);if(o.size!==expected)fail('SIZE_MISMATCH','Stored chunk size mismatch');parts.push({hash:o.customMetadata.sha256,size:o.size});
    for await(const b of o.body){count+=b.length;if(count>s.size)fail('SIZE_MISMATCH','Object size exceeded');if(prefix.length<65536){const p=b.subarray(0,65536-prefix.length),next=new Uint8Array(prefix.length+p.length);next.set(prefix);next.set(p,prefix.length);prefix=next}tail=Uint8Array.from(b.length>=16?b.subarray(-16):Buffer.concat([tail,b]).subarray(-16));if(decoder){let text;try{text=decoder.decode(b,{stream:true})}catch{fail('INVALID_FILE','Text must be valid UTF-8')}if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))fail('INVALID_FILE','Binary controls in text file')}await writer.write(b);
    }
   }if(decoder){try{decoder.decode()}catch{fail('INVALID_FILE','Incomplete UTF-8 text')}}await writer.close();
  }catch(e){await writer.abort().catch(()=>{});throw e}
  const id=hex(await digest.digest);if(count!==s.size)fail('SIZE_MISMATCH','Complete file size mismatch');if(s.expected_sha&&id!==s.expected_sha)fail('CHECKSUM_MISMATCH','SHA-256 does not match prepared upload');
  const detected=sniff(prefix,tail,count,s.mime);
  await authorized(ctx);
  for(let i=0;i<parts.length;i++){const heartbeat=await ctx.env.DB.prepare("UPDATE mcp_uploads SET lease_until=? WHERE id=? AND lease=? AND status='completing'").bind(Date.now()+120000,s.id,lease).run();if(heartbeat.meta.changes!==1)fail('UPLOAD_BUSY','Commit lease changed');const o=await ctx.env.ATTACHMENTS.get(temp(s,i));if(!o)fail('UPLOAD_INCOMPLETE','Stored chunk missing');const bytes=new Uint8Array(await o.arrayBuffer());if(bytes.length!==parts[i].size||await sha(bytes)!==parts[i].hash)fail('CHECKSUM_MISMATCH','Stored chunk integrity mismatch');const r=await attachments(new Request('https://internal/api/attachments/'+id,{method:'PUT',body:JSON.stringify({op:'part',wireId:id,index:i,hash:parts[i].hash,data:Buffer.from(bytes).toString('base64')})}),ctx.env,ctx.workspace,id,{});if(!r.ok)fail('STORAGE_ERROR','Shared attachment chunk validation failed');}
  const current=await ctx.env.DB.prepare("SELECT id FROM mcp_uploads WHERE id=? AND status='completing' AND lease=?").bind(s.id,lease).first();if(!current)fail('UPLOAD_BUSY','Commit lease changed');
  await authorized(ctx);
  const m={v:2,id,name:s.filename,mime:s.mime,size:s.size,localOnly:false,encoding:'identity',wireSize:s.size,wireId:id,parts};
  const r=await attachments(new Request('https://internal/api/attachments/'+id,{method:'PUT',body:JSON.stringify({op:'commit',manifest:m})}),ctx.env,ctx.workspace,id,{}, {provenance:JSON.parse(s.provenance),dimensions:detected});if(!r.ok)fail('STORAGE_ERROR','Shared attachment manifest validation failed');
  const committed=await ctx.env.DB.prepare("UPDATE mcp_uploads SET status='complete',attachment_id=?,error='CLEANUP_PENDING',lease=NULL,lease_until=0 WHERE id=? AND lease=?").bind(id,s.id,lease).run();if(committed.meta.changes!==1)fail('UPLOAD_BUSY','Completion state changed; retry status');try{await clearTemp(ctx.env,s);await ctx.env.DB.prepare('UPDATE mcp_uploads SET error=NULL WHERE id=?').bind(s.id).run()}catch{}return publicStatus(await row(ctx,s.id));
 }catch(e){invalid=['MIME_MISMATCH','INVALID_FILE','CHECKSUM_MISMATCH','SIZE_MISMATCH'].includes(e.code);await ctx.env.DB.prepare("UPDATE mcp_uploads SET status=?,error=?,lease=NULL,lease_until=0 WHERE id=? AND lease=?").bind(invalid?'failed':'pending',e.code||'STORAGE_ERROR',s.id,lease).run();if(invalid)await clearTemp(ctx.env,s);throw e}
}
export async function uploadTool(ctx,name,a){
 await authorized(ctx);
 if(name==='attachments_prepare_upload')return prepare(ctx,a);
 if(name==='attachments_upload_base64'){
  const bytes=decodeBase64(a.content_base64),id=await sha(bytes);sniff(bytes.subarray(0,65536),bytes.subarray(-16),bytes.length,a.mime_type);if(a.sha256&&id!==a.sha256)fail('CHECKSUM_MISMATCH','SHA-256 mismatch');
  const p=await prepare(ctx,{...a,size:bytes.length,sha256:id});if(p.status==='complete')return p;const s=await row(ctx,p.upload_id);await putPart(ctx,s,0,bytes);return complete(ctx,s);
 }
 const s=await row(ctx,a.upload_id);
 if(name==='attachments_complete_upload')return complete(ctx,s);
 if(name==='attachments_abort_upload'){
  if(s.status==='complete')fail('UPLOAD_COMPLETE','Registered attachments cannot be aborted');if(s.status==='completing'&&s.lease_until>Date.now())fail('UPLOAD_BUSY','Commit in progress; retry after completion');
  const r=await ctx.env.DB.prepare("UPDATE mcp_uploads SET status='aborted',lease=NULL,lease_until=0 WHERE id=? AND (status<>'completing' OR lease_until<?) AND status<>'complete'").bind(s.id,Date.now()).run();if(r.meta.changes!==1)fail('UPLOAD_BUSY','Upload state changed');await clearTemp(ctx.env,s);return publicStatus(await row(ctx,s.id));
 }
 if(name==='attachments_upload_status'){
  if(s.expires<=Date.now()&&s.status!=='complete'&&s.lease_until<Date.now()){await ctx.env.DB.prepare("UPDATE mcp_uploads SET status='expired' WHERE id=? AND status<>'complete' AND lease_until<?").bind(s.id,Date.now()).run();await clearTemp(ctx.env,s);s.status='expired';}
  const received=[];if(s.status==='pending'||s.status==='completing')for(let i=0;i<Math.ceil(s.size/CHUNK);i++){const o=await ctx.env.ATTACHMENTS.head(temp(s,i));if(o)received.push({part_index:i,size:o.size})}return {...publicStatus(s),received_parts:received,received_bytes:s.status==='complete'?s.size:received.reduce((n,p)=>n+p.size,0)};
 }
 fail('INVALID_ARGUMENT','Unknown upload tool');
}
export async function uploadHTTP(request,env){
 const origins=new Set(['https://easybook.loonxy.com','https://easybook-sync.1902521952.workers.dev',ORIGIN]),origin=request.headers.get('Origin');const cors=origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};const reply=(data,status=200)=>Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store'}});
 if(origin&&!origins.has(origin))return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:origin?204:403,headers:{...cors,'Access-Control-Allow-Methods':'PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
 if(request.method!=='PUT')return reply({error:'Method not allowed'},405);
 try{
  const u=new URL(request.url),id=u.pathname.match(/^\/uploads\/([a-f0-9-]{36})$/)?.[1];if(!id||u.searchParams.size!==1||!/^\d{1,2}$/.test(u.searchParams.get('part')||''))fail('INVALID_ARGUMENT','Invalid upload URL');
  const s=await env.DB.prepare('SELECT * FROM mcp_uploads WHERE id=?').bind(id).first();if(!s)fail('NOT_FOUND','Upload not found');
  const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer /,''),expected=await ticket(env,s);let difference=supplied.length^expected.length;for(let i=0;i<expected.length;i++)difference|=(supplied.charCodeAt(i)||0)^expected.charCodeAt(i);if(difference)fail('PERMISSION_DENIED','Invalid upload credential');
  const ctx={env,workspace:s.workspace,client:s.client,scopes:await permissions(env,s.workspace,s.client)};await authorized(ctx);
  if((request.headers.get('Content-Type')||'').split(';')[0].toLowerCase()!=='application/octet-stream')fail('INVALID_ARGUMENT','Upload requires application/octet-stream');
  const index=Number(u.searchParams.get('part')),size=Math.min(CHUNK,s.size-index*CHUNK);if(size<=0)fail('INVALID_ARGUMENT','Part index exceeds prepared file');
  return reply(await putPart(ctx,s,index,await readBytes(request,size)));
 }catch(e){return reply({error:e.code||'STORAGE_ERROR',message:e.code?e.message:'Upload temporarily unavailable'},['PERMISSION_DENIED'].includes(e.code)?403:e.code==='NOT_FOUND'?404:e.code==='FILE_TOO_LARGE'?413:e.code==='UPLOAD_BUSY'?409:e.code==='QUOTA_EXCEEDED'?429:400)}
}

