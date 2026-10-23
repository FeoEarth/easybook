import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';
const a=new WebStore(indexedDB),b=new WebStore(indexedDB);await a.open();await b.open();await a.load('space');await b.load('space');
await a.save('space',{notes:[{title:'offline'}],folders:[],inflight:{id:{mutation:'immutable'}},cursor:7});await assert.rejects(()=>b.save('space',{notes:[],cursor:0}));const c=new WebStore(indexedDB);await c.open();const recovered=await c.load('space');assert.equal(recovered.notes[0].title,'offline');assert.equal(recovered.inflight.id.mutation,'immutable');assert.equal(recovered.cursor,7);for(const s of [a,b,c])s.db.close();console.log('PASS IndexedDB: atomic recovery of notes/outbox/cursor, stale second tab rejected');
