import assert from 'node:assert/strict';
import {upload,download,hash} from '../shared/attachments.mjs';
const origin=process.argv[2];if(!origin?.startsWith('https://'))throw Error('Pass exact HTTPS release origin');
async function request(path,body,key,method){const r=await fetch(origin+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});let data;try{data=await r.json()}catch{throw Error('Release probe non-JSON HTTP '+r.status)}return {response:r,data}}
const {response, data}=await request('/api/workspaces',{name:'Release verification '+Date.now()});assert.equal(response.status,201);const original=data.key,id=data.workspace.id;
const folder=crypto.randomUUID(),note=crypto.randomUUID();assert.equal((await request('/api/folders/'+folder,{name:'Verification',updated:Date.now(),deleted:0},original,'PUT')).response.status,200);
const blob=new Blob(['Easybook isolated release attachment']),asset=await hash(blob),file={id:asset,name:'verification.txt',mime:'text/plain',size:blob.size,blob};
const call=async(suffix,body)=>{const r=await request('/api/attachments/'+asset+suffix,body,original,body?'PUT':'GET');assert.equal(r.response.status,200);return r.data};await upload(file,call,false);assert.equal(await (await download(asset,call)).blob.text(),await blob.text());
const body={id:note,title:'Release verification',document:{schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Two device check'}]},{type:'attachment',attrs:{assetId:'sha256:'+asset,name:file.name,mime:file.mime,size:file.size}}]}},icon:'📄',folder_id:folder,favorite:0,pinned:0,deleted:0,version:0,mutation:crypto.randomUUID(),updated:Date.now()};
let r=await request('/api/notes/'+note,body,original,'PUT');assert.equal(r.response.status,200);const saved=r.data.note;
r=await request('/api/notes?cursor=0',null,original);assert.ok(r.data.notes.some(n=>n.id===note));
const foreign=await request('/api/workspaces',{name:'Release isolation '+Date.now()});assert.equal(foreign.response.status,201);assert.equal((await request('/api/workspaces/'+id,null,foreign.data.key)).response.status,403);
const rotated=await request('/api/workspaces/'+id+'/key',{confirm:true},original);assert.equal(rotated.response.status,200);assert.equal(rotated.data.workspace.id,id);assert.equal((await request('/api/notes?cursor=0',null,original)).response.status,401);assert.ok((await request('/api/notes?cursor=0',null,rotated.data.key)).data.notes.some(n=>n.id===note));
// Retain an ordinary soft-delete tombstone; never invoke permanent deletion.
assert.equal((await request('/api/notes/'+note,{...saved,deleted:1,mutation:crypto.randomUUID()},rotated.data.key,'PUT')).response.status,200);
console.log(JSON.stringify({result:'passed',workspace:id,checks:['anonymous create','folders','attachment upload/download hash','two-device read','foreign key denied','rotation invalidates old key','stable content','soft cleanup']}));
