import assert from 'node:assert/strict';
import {fixture} from './document-test.mjs';
const origin=process.env.EASYBOOK_TEST_ORIGIN||'https://easybook-sync.1902521952.workers.dev';
const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const id=crypto.randomUUID();async function request(path,data){const r=await fetch(origin+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,...await r.json()}}
assert.equal((await request('/health')).schemaVersion,1);
const n={title:'Phase 2 protocol smoke',document:fixture,icon:'📄',favorite:0,deleted:0,folder_id:'',version:0,mutation:crypto.randomUUID()};
const first=await request('/api/notes/'+id,n);assert.equal(first.status,200);assert.deepEqual(first.note.document,fixture);assert.equal(first.note.version,1);
const next=await request('/api/notes/'+id,{...first.note,title:'verified',mutation:crypto.randomUUID()});assert.equal(next.status,200);assert.equal(next.note.version,2);
const replay=await request('/api/notes/'+id,n);assert.equal(replay.note.version,1);assert.equal(replay.replayed,true);
assert.equal((await request('/api/notes/'+id,{...first.note,mutation:crypto.randomUUID()})).status,409);
const feed=await request('/api/notes?cursor=0');assert.ok(feed.notes.some(n=>n.id===id));assert.equal((await request('/api/notes?cursor='+feed.cursor)).notes.length,0);
const tombstone=await request('/api/notes/'+id,{...next.note,deleted:1,mutation:crypto.randomUUID()});assert.equal(tombstone.note.deleted,1);assert.equal((await request('/api/notes?cursor='+feed.cursor)).notes[0].deleted,1);
console.log('PASS live development Worker+D1: schemaVersion, full JSON round trip, CAS conflict, delayed replay, change cursor and tombstone. Only one random test workspace written; no user workspace or R2 object modified.');
