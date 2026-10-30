import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';
const a=new WebStore(indexedDB),b=new WebStore(indexedDB);await a.open();await b.open();await a.load('space');await b.load('space');
await a.save('space',{notes:[{title:'offline'}],folders:[],inflight:{id:{mutation:'immutable'}},cursor:7});await assert.rejects(()=>b.save('space',{notes:[],cursor:0}));const c=new WebStore(indexedDB);await c.open();const recovered=await c.load('space');assert.equal(recovered.notes[0].title,'offline');assert.equal(recovered.inflight.id.mutation,'immutable');assert.equal(recovered.cursor,7);for(const s of [a,b,c])s.db.close();console.log('PASS IndexedDB: atomic recovery of notes/outbox/cursor, stale second tab rejected');


// Upgrade an existing v1 database without rewriting notes, outbox or cache paths.
const {IDBFactory}=await import('fake-indexeddb');
const factory=new IDBFactory(),oldKey='a'.repeat(64),rotatedKey='b'.repeat(64),workspace={id:'1'.repeat(64),name:'工作',mode:'personal',role:'manager'};
const oldDB=await new Promise((resolve,reject)=>{const r=factory.open('easybook-json-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('spaces');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const original={notes:[{id:'note',title:'offline',dirty:true}],folders:[{id:'folder'}],inflight:{note:{mutation:'frozen'}},cursor:27,revision:5,management:{pending:[{id:'move'}]}};
await new Promise((resolve,reject)=>{const t=oldDB.transaction('spaces','readwrite');t.objectStore('spaces').put(original,oldKey);t.oncomplete=resolve;t.onabort=()=>reject(t.error)});oldDB.close();
const migrated=new WebStore(factory);await migrated.open();assert.equal(migrated.db.version,3);
assert.deepEqual(await migrated.load(oldKey),original);
await migrated.bindWorkspace(oldKey,workspace);await migrated.bindWorkspace(oldKey,workspace);
assert.equal(await migrated.namespace(oldKey),oldKey,'legacy attachment/cache namespace stays in place');
await migrated.bindWorkspace(rotatedKey,workspace);
assert.deepEqual(await migrated.load(rotatedKey),original,'rotated key finds the same offline queue/cursor');
assert.equal(await migrated.namespace(rotatedKey),oldKey);
await migrated.save(rotatedKey,{...original,notes:[{id:'note',title:'after rotation',dirty:true}]});
assert.equal((await migrated.load(oldKey)).notes[0].title,'after rotation');
assert.deepEqual(await migrated.listWorkspaces(),[workspace],'public list omits the local credential-bearing address');
await assert.rejects(()=>migrated.bindWorkspace(rotatedKey,{...workspace,id:'2'.repeat(64)}),/identity changed/);
const otherKey='c'.repeat(64);await migrated.load(otherKey);await migrated.save(otherKey,{notes:[{id:'separate',dirty:true}],folders:[],inflight:{},cursor:0});
await assert.rejects(()=>migrated.bindWorkspace(otherKey,workspace),/separate offline data/);
assert.equal((await migrated.load(otherKey)).notes[0].id,'separate','conflicting local data is retained');
assert.equal((await migrated.load(rotatedKey)).notes[0].id,'note');
const cachedShared={id:'3'.repeat(64),name:'共享目录',mode:'shared',role:'editor'},cachedPersonal={id:'4'.repeat(64),name:'个人目录',mode:'personal',role:'manager'};
await migrated.cacheWorkspaces([cachedShared,cachedPersonal]);
assert.deepEqual((await migrated.listWorkspaces()).filter(w=>[cachedShared.id,cachedPersonal.id].includes(w.id)),[cachedShared,cachedPersonal],'cached catalog retains both personal and shared workspaces');
const cachedKey='d'.repeat(64);await migrated.load(cachedKey);await migrated.save(cachedKey,{notes:[{id:'catalog-note'}],folders:[],inflight:{},cursor:0});
await migrated.bindWorkspace(cachedKey,cachedPersonal);
assert.equal((await migrated.load(cachedKey)).notes[0].id,'catalog-note','catalog metadata never redirects existing offline data');
const stale=new WebStore(factory);await stale.open();await stale.load(rotatedKey);
await migrated.save(rotatedKey,{notes:[{id:'newer'}],folders:[],inflight:{},cursor:28});
await assert.rejects(()=>stale.save(rotatedKey,{notes:[],folders:[],inflight:{},cursor:0}));
for(const store of [migrated,stale])store.db.close();
console.log('PASS workspace storage: v1 upgrade, personal/shared catalog cache, stable namespace through rotation, queue/cursor/cache preservation, retryable binding, no cross-workspace rebind or silent offline overwrite, stale-tab CAS');


const vault=new WebStore(new IDBFactory());await vault.open();const secret=await vault.activeCredential();assert.match(secret,/^[a-f0-9]{64}$/);assert.equal(await vault.activeCredential(),secret);assert.equal((await vault.vaultKey()).extractable,false);assert.ok(!JSON.stringify(await vault.vaultGet('active')).includes(secret));assert.equal(await vault.namespace(secret),'local:'+await vault.fingerprint(secret));await vault.setActiveCredential('account:'+'2'.repeat(64));assert.equal(await vault.activeCredential(),'account:'+'2'.repeat(64));vault.db.close();console.log('PASS Web credential vault: nonextractable AES-GCM key, encrypted active credential, stable recovery, public account selector and no raw-key namespace for new data');
