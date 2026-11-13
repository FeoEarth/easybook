import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {normalizeOrigin,serverId,probeServer} from '../shared/server-profile.mjs';
import {bootstrap} from '../shared/server-registry.mjs';
import {WebStore} from '../shared/web-store.mjs';

class Locks {
 constructor(){this.tail=Promise.resolve()}
 request(_name,callback){const result=this.tail.then(callback);this.tail=result.catch(()=>{});return result}
}
class Channels {
 static instances=new Set();
 constructor(name){this.name=name;Channels.instances.add(this)}
 postMessage(value){for(const channel of Channels.instances)if(channel!==this&&channel.name===this.name)queueMicrotask(()=>channel.onmessage?.({data:structuredClone(value)}))}
 close(){Channels.instances.delete(this)}
}
const site='https://app.example',custom='https://notes.example:8443';
const locationFor=permission=>({origin:site,href:site+'/?server_origin='+encodeURIComponent(permission||site)});
const discovery=origin=>({protocolVersion:1,serverOrigin:origin,capabilities:{sync:true,accounts:true,webConnector:true}});
const closes=[];
async function make(options){const value=await bootstrap(options);closes.push(value.controller);return value}

assert.equal(normalizeOrigin('https://EXAMPLE.com:443/'),'https://example.com');
for(const value of ['https://user:secret@example.com','https://@example.com','https://example.com/api','https://example.com/a/..','https://example.com/?','https://example.com/#','ftp://example.com','http://192.168.1.2','http://localhost:8000'])assert.throws(()=>normalizeOrigin(value));
assert.equal(normalizeOrigin('http://localhost:8000',{clientOrigin:'http://localhost:8000'}),'http://localhost:8000');
assert.equal((await serverId('https://example.com')).length,64);
assert.equal(await serverId('https://EXAMPLE.com:443/'),await serverId('https://example.com'));
for(const invalid of [{...discovery(custom),serverOrigin:site},{...discovery(custom),protocolVersion:2},{...discovery(custom),capabilities:{sync:true,accounts:true}}])await assert.rejects(()=>probeServer(custom,{fetch:async()=>Response.json(invalid)}));

const indexedDB=new IDBFactory(),locks=new Locks(),reloads=[],calls=[];let offline=false,releaseRequest;
const fetcher=async(input,init)=>{
 calls.push({url:String(input),init});const url=new URL(input);
 if(url.pathname==='/.well-known/easybook.json'){
  assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,undefined);
  if(offline)throw Error('offline');return Response.json(discovery(url.origin));
 }
 return new Promise(resolve=>{releaseRequest=()=>resolve(Response.json({ok:true}))});
};
const options={indexedDB,locks,BroadcastChannel:Channels,location:locationFor(custom),fetch:fetcher,reload:url=>reloads.push(url),prepareTimeoutMs:60};
const {profile:original,controller:a}=await make({...options,tabId:'a'}),{controller:b}=await make({...options,tabId:'b'});
assert.equal(original.builtin,true,'A permission query does not activate an unknown server');
assert.equal(original.dbName,'easybook-json-v1');assert.equal(original.filesDbName,'easybook-files');assert.equal(original.storagePrefix,'');
const store=new WebStore(indexedDB,{profile:original,controller:a});await store.open();
const key='a'.repeat(64),workspace={id:'1'.repeat(64),name:'Same workspace identity',mode:'personal'};
await store.load(key);await store.save(key,{notes:[{id:'same-note',title:'official'}],folders:[],inflight:{pending:{mutation:'frozen'}},cursor:27});
await store.bindWorkspace(key,workspace);await store.setActiveCredential(key);await store.vaultPut('session',{operationId:'official-login',data:'official-token'});
const files=await a.openFiles();
const transactionDone=transaction=>new Promise((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(transaction.error||Error('inactive gate'))});
let fileWrite=a.fileTransaction(files,'readwrite');fileWrite.objectStore('files').put({key:'same:asset',data:'official asset'});await transactionDone(fileWrite);
const added=await a.add(custom,'Custom');assert.equal(added.id,await serverId(custom));assert.equal(added.builtin,false);
assert.notEqual(added.dbName,original.dbName);assert.notEqual(added.filesDbName,original.filesDbName);assert.ok(added.storagePrefix.includes(added.id));
let flushed=0,resumed=0;a.setHooks({flush:async()=>{flushed++;await store.flush()},resume:()=>resumed++});b.setHooks({flush:async()=>{flushed++}});
const pendingRequest=a.fetch('/api/notes').then(()=>null,error=>error);
while(!releaseRequest)await new Promise(resolve=>setImmediate(resolve));
await a.switch(added.id);releaseRequest();assert.equal((await pendingRequest).code,'SERVER_PROFILE_CHANGED');
assert.equal(calls.find(call=>new URL(call.url).pathname==='/api/notes').url,site+'/api/notes','An old request keeps the old server origin');
assert.equal(flushed,2,'Every registered tab flushes before switching');assert.equal(resumed,0);
assert.equal(reloads.length,2,'All tabs reload after the shared switch commits');
for(const url of reloads)assert.equal(new URL(url).searchParams.get('server_origin'),custom);
await assert.rejects(()=>a.assertActive());await assert.rejects(()=>store.save(key,{notes:[],cursor:0}));await assert.rejects(()=>store.vaultPut('session',{data:'late'}));
assert.throws(()=>a.fileTransaction(files,'readwrite'));
const sleeping=Object.create(a);sleeping.phase='active';fileWrite=sleeping.fileTransaction(files,'readwrite');fileWrite.objectStore('files').put({key:'same:asset',data:'late asset'});await assert.rejects(()=>transactionDone(fileWrite),'File writes are fenced inside their own transaction even without the broadcast');

// Even a suspended tab that has not received the broadcast is fenced by the
// gate in its own snapshot/vault write transaction.
const suspended=new WebStore(indexedDB,{profile:original,controller:{assertWritable(){}}});await suspended.open();await suspended.load(key);
await assert.rejects(()=>suspended.save(key,{notes:[],folders:[],inflight:{},cursor:0}));suspended.db.close();
const {profile:customProfile,controller:c}=await make({...options,tabId:'c'}),customStore=new WebStore(indexedDB,{profile:customProfile,controller:c});await customStore.open();
assert.equal(customProfile.id,added.id);assert.deepEqual((await customStore.load(key)).notes,[]);assert.equal(await customStore.vaultGet('session'),undefined);assert.equal(await customStore.personalWorkspaceCredential(workspace.id),null);
const customFiles=await c.openFiles(),fileRead=(db,key)=>new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
assert.equal(await fileRead(customFiles,'same:asset'),undefined,'The same attachment address is isolated across server file databases');
fileWrite=c.fileTransaction(customFiles,'readwrite');fileWrite.objectStore('files').put({key:'same:asset',data:'custom asset'});await transactionDone(fileWrite);
await customStore.bindWorkspace(key,workspace);await customStore.setActiveCredential('b'.repeat(64));await customStore.save(key,{notes:[{id:'same-note',title:'custom'}],folders:[],inflight:{},cursor:3});
await customStore.vaultPut('session',{operationId:'new-login',data:'custom-token'});await customStore.vaultDelete('session',{operationId:'old-login'});assert.equal((await customStore.vaultGet('session')).data,'custom-token','Cancellation cannot delete a newer login');
await c.rename(added.id,'Renamed');c.setHooks({flush:()=>customStore.flush()});
let bodyController,bodySignal;
c.options.fetch=async(_input,init)=>{bodySignal=init.signal;return new Response(new ReadableStream({start(controller){bodyController=controller}}))};
const streaming=await c.fetch('/api/stream'),reading=streaming.text().then(()=>null,error=>error);
assert.equal(c.requests.size,1,'A response retains its abort controller until its body finishes');
await c.switch(original.id);assert.equal(bodySignal.aborted,true,'Switching aborts a body that is still streaming');bodyController.enqueue(new TextEncoder().encode('late'));bodyController.close();assert.equal((await reading).code,'SERVER_PROFILE_CHANGED');
const {controller:d}=await make({...options,tabId:'d'});
await d.remove(added.id);assert.equal((await d.list()).some(item=>item.id===added.id),false);
const beforeOffline=calls.length;offline=true;const restored=await d.add(custom);assert.equal(restored.name,'Renamed');await d.switch(added.id);assert.equal(calls.length,beforeOffline,'A known hidden profile can be restored and activated offline');
const {profile:again,controller:e}=await make({...options,tabId:'e'}),restoredStore=new WebStore(indexedDB,{profile:again,controller:e});await restoredStore.open();
assert.equal((await restoredStore.load(key)).notes[0].title,'custom');assert.equal(await restoredStore.activeCredential(),'b'.repeat(64));assert.equal((await restoredStore.vaultGet('session')).data,'custom-token');
const restoredFiles=await e.openFiles();assert.equal((await fileRead(restoredFiles,'same:asset')).data,'custom asset');assert.equal((await fileRead(files,'same:asset')).data,'official asset');
await assert.rejects(()=>customStore.vaultPut('session',{data:'old-epoch'}),'Returning to the same profile cannot reactivate an old tab epoch');
const officialInspection=new WebStore(indexedDB,{profile:original});await officialInspection.open();const preserved=await officialInspection.load(key);assert.equal(preserved.notes[0].title,'official');assert.equal(preserved.cursor,27);assert.equal(preserved.inflight.pending.mutation,'frozen');assert.equal((await officialInspection.vaultGet('session')).data,'official-token');
for(const value of [store,customStore,restoredStore,officialInspection])value.db.close();
for(const db of [files,customFiles,restoredFiles])db.close();

// A failed or unresponsive tab prevents activation and preserves the old gate.
const failureDB=new IDBFactory(),failureLocks=new Locks(),failureOptions={...options,indexedDB:failureDB,locks:failureLocks,prepareTimeoutMs:20,fetch:async input=>Response.json(discovery(new URL(input).origin)),reload:()=>assert.fail('A failed preparation must not reload')};
const {profile:old,controller:f}=await make({...failureOptions,tabId:'f'}),{controller:g}=await make({...failureOptions,tabId:'g'}),target=await f.add(custom);
g.setHooks({flush:async()=>{throw Error('unsaved')}});await assert.rejects(()=>f.switch(target.id),error=>error.code==='SERVER_PREPARE_FAILED');await f.assertActive();
g.channel.onmessage=()=>{};await assert.rejects(()=>f.switch(target.id),error=>error.code==='SERVER_PREPARE_TIMEOUT');await f.assertActive();
const surviving=new WebStore(failureDB,{profile:old,controller:f});await surviving.open();await surviving.load(key);await surviving.save(key,{notes:[{title:'still original'}],folders:[],inflight:{},cursor:0});surviving.db.close();

const permissionDB=new IDBFactory(),{controller:permission}=await make({...options,indexedDB:permissionDB,locks:new Locks(),location:locationFor(site),tabId:'permission'});
await assert.rejects(()=>permission.add(custom),error=>error.code==='SERVER_PERMISSION_REQUIRED');assert.equal((await permission.list()).length,1);
for(const controller of closes.reverse())await controller.close();
console.log('PASS server profiles: strict discovery, origin/profile isolation, preserved default storage, per-profile secrets, coordinated tab switching, stale-epoch fencing, offline restore, and failure/timeout rollback.');
