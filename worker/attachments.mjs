import {attachmentDeleted} from './attachment-purge.mjs';
import {Buffer} from 'node:buffer';
const CLOUD=50*1024*1024,LOCAL=1024*1024*1024,CHUNK=4*1024*1024;
const hex=b=>Buffer.from(b).toString('hex'),hash=async b=>hex(await crypto.subtle.digest('SHA-256',b));
const valid=h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h);
export async function attachments(request,env,workspace,id,headers,metadata={}){
 if(await attachmentDeleted(env,workspace,id))return Response.json({error:'Attachment permanently deleted'},{status:410,headers});
 const bucket=env.ATTACHMENTS;
 // A write already in flight at fence creation must clean up its own late R2
 // write. Readers always check the fence, even before physical cleanup finishes.
 const tracked=[];
 const guarded=bucket?{get:bucket.get.bind(bucket),head:bucket.head.bind(bucket),async put(key,...args){tracked.push(key);return bucket.put(key,...args)}}:bucket;
 let response;
 try{response=await attachmentRequest(request,{...env,ATTACHMENTS:guarded},workspace,id,headers,metadata)}finally{
  if(request.method==='PUT'&&await attachmentDeleted(env,workspace,id)&&tracked.length)await bucket.delete(tracked);
 }
 if(await attachmentDeleted(env,workspace,id))return Response.json({error:'Attachment permanently deleted'},{status:410,headers});
 return response;
}
async function attachmentRequest(request,env,workspace,id,headers,metadata={}){
 const reply=(v,status=200)=>Response.json(v,{status,headers});if(!env.ATTACHMENTS)return reply({error:'Storage unavailable'},503);
 const bucket=env.ATTACHMENTS,base=workspace+'/'+id,manifestKey=base+'/manifest-v2';
 async function manifest(){const m=await bucket.get(manifestKey);if(m)return m.json();const old=await bucket.head(base);return old?{v:2,id,name:decodeURIComponent(old.customMetadata?.name||'%E9%99%84%E4%BB%B6'),mime:old.customMetadata?.mime||'application/octet-stream',size:old.size,wireSize:old.size,wireId:id,encoding:'identity',parts:[{hash:id,size:old.size}],legacy:true,localOnly:false}:null;}
 const url=new URL(request.url);
 if(request.method==='GET'){
  const m=await manifest();if(!m)return reply({error:'Attachment not found'},404);
  if(!url.searchParams.has('part'))return reply(m);
  const index=Number(url.searchParams.get('part'));if(m.localOnly||!Number.isInteger(index)||index<0||index>=m.parts.length)return reply({error:'Invalid part'},400);
  const part=m.parts[index],object=await bucket.get(m.legacy?base:base+'/'+m.wireId+'/'+index);if(!object)return reply({error:'Part missing'},404);
  return reply({data:Buffer.from(await object.arrayBuffer()).toString('base64'),hash:part.hash,size:part.size});
 }
 if(request.method!=='PUT')return reply({error:'Method not allowed'},405);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Missing body'},400);let total=0;const buffers=[];
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>6*1024*1024){await reader.cancel();return reply({error:'Chunk too large'},413)}buffers.push(value)}
 let v;try{v=JSON.parse(Buffer.concat(buffers).toString())}catch{return reply({error:'Invalid JSON'},400)}
 if(v.op==='part'){
  if(!valid(v.wireId)||!valid(v.hash)||!Number.isInteger(v.index)||v.index<0||v.index>=13||typeof v.data!=='string'||v.data.length>Math.ceil(CHUNK/3)*4||(v.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.data)))return reply({error:'Invalid chunk'},400);
  const bytes=Buffer.from(v.data,'base64');if(!bytes.length||bytes.length>CHUNK||await hash(bytes)!==v.hash)return reply({error:'Chunk integrity failure'},400);
  const partKey=base+'/'+v.wireId+'/'+v.index,existing=await bucket.head(partKey);if(existing&&(existing.customMetadata?.hash!==v.hash||existing.size!==bytes.length))return reply({error:'Immutable chunk conflict'},409);if(!existing)await bucket.put(partKey,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{hash:v.hash}});return reply({hash:v.hash,size:bytes.length});
 }
 const m=v.manifest;
 if(v.op!=='commit'||!m||m.v!==2||m.id!==id||typeof m.name!=='string'||m.name.length>180||typeof m.mime!=='string'||!/^[\w.+-]+\/[\w.+-]+$/.test(m.mime)||!Number.isSafeInteger(m.size)||m.size<0||m.size>LOCAL||typeof m.localOnly!=='boolean')return reply({error:'Invalid manifest'},400);
 const safe={v:2,id,name:m.name,mime:m.mime,size:m.size,localOnly:m.localOnly};
 const previous=await manifest();
 if(previous?.provenance||metadata.provenance&&Object.keys(metadata.provenance).length)safe.provenance=previous?.provenance||metadata.provenance;
 for(const k of ['width','height'])if(previous?.[k]||metadata.dimensions?.[k])safe[k]=previous?.[k]||metadata.dimensions[k];
 if(m.localOnly){const existing=await manifest();if(existing&&!existing.localOnly)return reply({id,size:m.size,localOnly:false});await bucket.put(manifestKey,JSON.stringify({...safe,parts:[],wireSize:0,encoding:'identity',wireId:id}));return reply({id,size:m.size,localOnly:true})}
 if(!valid(m.wireId)||!['identity','gzip'].includes(m.encoding)||!Number.isInteger(m.wireSize)||m.wireSize<0||m.wireSize>CLOUD||!Array.isArray(m.parts)||m.parts.length>13)return reply({error:'Cloud limit is 50 MB'},413);
 let wireSize=0;for(let i=0;i<m.parts.length;i++){const p=m.parts[i];if(!valid(p.hash)||!Number.isInteger(p.size)||p.size<1||p.size>CHUNK)return reply({error:'Invalid part'},400);const o=await bucket.head(base+'/'+m.wireId+'/'+i);if(!o||o.size!==p.size||o.customMetadata?.hash!==p.hash)return reply({error:'Missing verified part'},409);wireSize+=p.size}if(wireSize!==m.wireSize)return reply({error:'Wire size mismatch'},400);
 async function* pieces(){for(let i=0;i<m.parts.length;i++){const o=await bucket.get(base+'/'+m.wireId+'/'+i);if(!o)throw Error('Part missing');for await(const b of o.body)yield b}}
 let iterator=pieces(),stream=new ReadableStream({async pull(c){try{const r=await iterator.next();r.done?c.close():c.enqueue(r.value)}catch(e){c.error(e)}},cancel(){return iterator.return()}}),wireHash=new crypto.DigestStream('SHA-256');
 wireHash.digest.catch(()=>{});let wireCount=0;stream=stream.pipeThrough(new TransformStream({async transform(b,c){wireCount+=b.length;c.enqueue(b)}}));
 // Hash wire and original in one bounded pipeline, without tee buffering large objects.
 const wireWriter=wireHash.getWriter();stream=stream.pipeThrough(new TransformStream({async transform(b,c){await wireWriter.write(b);c.enqueue(b)},async flush(){await wireWriter.close()}}));
 if(m.encoding==='gzip')stream=stream.pipeThrough(new DecompressionStream('gzip'));
 let originalCount=0;const digest=new crypto.DigestStream('SHA-256');digest.digest.catch(()=>{});
 try{await stream.pipeThrough(new TransformStream({transform(b,c){originalCount+=b.length;if(originalCount>m.size||originalCount>LOCAL)throw Error('Expanded size exceeds manifest');c.enqueue(b)}})).pipeTo(digest);if(originalCount!==m.size||hex(await digest.digest)!==id||wireCount!==m.wireSize||hex(await wireHash.digest)!==m.wireId)return reply({error:'SHA-256 mismatch'},400)}catch{try{await wireWriter.abort()}catch{}return reply({error:'Integrity verification failed'},400)}
 await bucket.put(manifestKey,JSON.stringify({...safe,wireId:m.wireId,wireSize:m.wireSize,encoding:m.encoding,parts:m.parts}));return reply({id,size:m.size,localOnly:false});
}

