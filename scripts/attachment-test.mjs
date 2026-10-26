import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker/index.mjs';
import {upload,download,hash} from '../shared/attachments.mjs';
class DigestStream extends WritableStream{constructor(){const h=createHash('sha256');let resolve,reject;const digest=new Promise((a,b)=>{resolve=a;reject=b});super({write(b){h.update(b)},close(){resolve(h.digest())},abort(e){reject(e)}});this.digest=digest}}
Object.defineProperty(crypto,'DigestStream',{value:DigestStream,configurable:true});
const objects=new Map(),ATTACHMENTS={async put(key,data,options={}){if(options.onlyIf&&objects.has(key))return null;objects.set(key,{blob:new Blob([data]),customMetadata:options.customMetadata});return {}},async head(key){const o=objects.get(key);return o?{size:o.blob.size,customMetadata:o.customMetadata}:null},async get(key){const o=objects.get(key);return o?{size:o.blob.size,customMetadata:o.customMetadata,body:o.blob.stream(),arrayBuffer:()=>o.blob.arrayBuffer(),json:async()=>JSON.parse(await o.blob.text())}:null}};
const blob=new Blob(['离线附件\u0000data']),id=await hash(blob),file={id,name:'附件.txt',mime:'text/plain',size:blob.size,blob};
async function request(method,key='a'.repeat(64),data,target=id,suffix=''){const res=await worker.fetch(new Request('https://test/api/attachments/'+target+suffix,{method,headers:{Authorization:'Bearer '+key},...(data?{body:JSON.stringify(data)}:{})}),{ATTACHMENTS});return {status:res.status,...await res.json()}}
const call=async(suffix='',body)=>{const value=await request(body?'PUT':'GET','a'.repeat(64),body,id,suffix);assert.equal(value.status,200);return value};
await upload(file,call,false);await upload(file,call,false);assert.equal(objects.size,2,'chunk and manifest are reused');
const restored=await download(id,call);assert.equal(await hash(restored.blob),id);assert.equal(await restored.blob.text(),await blob.text());assert.equal(restored.name,file.name);
assert.equal((await request('GET','b'.repeat(64))).status,404);assert.equal((await request('GET','invalid')).status,401);
assert.equal((await request('PUT','a'.repeat(64),{...file,data:'AAAA'})).status,400,'obsolete whole-file protocol is rejected');
assert.equal((await request('PUT','a'.repeat(64),{op:'part',wireId:id,index:0,hash:id,data:'AAAA'})).status,400);
const manifest=await call();assert.equal((await request('PUT','a'.repeat(64),{op:'commit',manifest},'b'.repeat(64))).status,400);
const changed=new Blob(['different']),changedId=await hash(changed);
assert.equal((await request('PUT','a'.repeat(64),{op:'part',wireId:id,index:0,hash:changedId,data:Buffer.from(await changed.arrayBuffer()).toString('base64')})).status,409,'verified chunks cannot be overwritten');
assert.equal((await request('PUT','a'.repeat(64),{op:'commit',manifest:{...manifest,wireSize:50*1024*1024+1}})).status,413);
console.log('PASS attachment v2 through Worker: chunk/manifest round trip, byte integrity, retry idempotence, workspace isolation, authentication, immutable chunks and hard limits');
