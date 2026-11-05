import assert from 'node:assert/strict';
import {req,rotated} from './core-workspace-release-test.mjs';

const auth={Authorization:'Bearer '+rotated.key},id=crypto.randomUUID(),mutation=()=>crypto.randomUUID();
let r=await req('/api/folders/'+id,{method:'PUT',headers:auth,body:{name:'初始',updated:1,deleted:0,version:0,mutation:mutation()}});
assert.equal(r.status,200);let folder=(await r.json()).folder;assert.equal(folder.version,1);
const base=folder.version,a=mutation(),b=mutation();
r=await req('/api/folders/'+id,{method:'PUT',headers:auth,body:{name:'设备 A',updated:2,deleted:0,version:base,mutation:a}});assert.equal(r.status,200);assert.equal((await r.json()).folder.version,2);
r=await req('/api/folders/'+id,{method:'PUT',headers:auth,body:{name:'设备 B',updated:999999999,deleted:0,version:base,mutation:b}});assert.equal(r.status,409,'client clock cannot overwrite a newer folder revision');assert.equal((await r.json()).folder.name,'设备 A');
r=await req('/api/folders/'+id,{method:'PUT',headers:auth,body:{name:'设备 A',updated:2,deleted:0,version:base,mutation:a}});assert.equal(r.status,200);assert.equal((await r.json()).replayed,true,'folder mutation retry is idempotent');

const noteId=crypto.randomUUID(),document={schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'安全终态'}]}]}};
r=await req('/api/notes/'+noteId,{method:'PUT',headers:auth,body:{id:noteId,title:'终态',document,icon:'📄',folder_id:'',favorite:0,pinned:0,deleted:0,version:0,mutation:mutation(),updated:1}});let note=(await r.json()).note;
r=await req('/api/notes/'+noteId,{method:'PUT',headers:auth,body:{...note,deleted:1,purged:1,mutation:mutation()}});assert.equal(r.status,200);
r=await req('/api/notes/'+noteId,{method:'PUT',headers:auth,body:{...note,title:'离线旧编辑',mutation:mutation()}});assert.equal(r.status,200);assert.equal((await r.json()).note.purged,1,'old offline edits cannot revive a permanent deletion');

const scoped=await req('/api/notes?cursor=0&scope=none',{headers:auth});assert.equal(scoped.status,200);const page=await scoped.json();assert.equal(page.scopeApplied,1);assert.ok(page.cursor>=0,'scope omission still advances a valid cursor');
console.log('PASS sync consistency: folder CAS/replay/clock independence, terminal purge, and scoped cursor safety.');
