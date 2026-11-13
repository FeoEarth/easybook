import {normalizeOrigin,profileFor,probeServer,serverError} from './server-profile.mjs';

const LOCK='easybook-server-switch-v1',CHANNEL='easybook-server-profiles-v1';
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const changed=()=>serverError('SERVER_PROFILE_CHANGED','The active server changed; reload this page');
const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});

class Registry {
 constructor(indexedDB){this.indexedDB=indexedDB}
 async open(){this.db=await new Promise((resolve,reject)=>{const request=this.indexedDB.open('easybook-server-profiles-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('profiles',{keyPath:'id'});request.result.createObjectStore('meta');request.result.createObjectStore('tabs',{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return this}
 read(store,key){return requestResult(this.db.transaction(store).objectStore(store).get(key))}
 all(store){return requestResult(this.db.transaction(store).objectStore(store).getAll())}
 write(store,key,value){return new Promise((resolve,reject)=>{const transaction=this.db.transaction(store,'readwrite'),objectStore=transaction.objectStore(store);if(value===undefined)objectStore.delete(key);else if(key===null)objectStore.put(value);else objectStore.put(value,key);transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(transaction.error)})}
 async initialize(builtin){return new Promise((resolve,reject)=>{const transaction=this.db.transaction(['profiles','meta'],'readwrite'),profiles=transaction.objectStore('profiles'),meta=transaction.objectStore('meta');let active;const row=profiles.get(builtin.id);row.onsuccess=()=>profiles.put({...builtin,...row.result,builtin:true,hidden:false});const request=meta.get('active');request.onsuccess=()=>{active=request.result||{profileId:builtin.id,epoch:crypto.randomUUID()};if(!request.result)meta.put(active,'active')};transaction.oncomplete=()=>resolve(active);transaction.onabort=transaction.onerror=()=>reject(transaction.error)})}
 activate(expected,next){return new Promise((resolve,reject)=>{const transaction=this.db.transaction('meta','readwrite'),store=transaction.objectStore('meta'),request=store.get('active');let error;request.onsuccess=()=>{if(request.result?.profileId!==expected.profileId||request.result?.epoch!==expected.epoch){error=changed();transaction.abort();return}store.put(next,'active');store.delete('pending')};transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(error||transaction.error)})}
}

/** The gate lives in the same database as snapshots/vault writes. IDB transactions
 * serialize invalidation with those writes, including tabs delayed by suspension. */
export async function setProfileGate(indexedDB,profile,epoch,active){
 const {WebStore}=await import('./web-store.mjs');const store=new WebStore(indexedDB,{profile});await store.open();
 const files=await openFilesDatabase(indexedDB,profile);
 try{for(const db of [store.db,files])await new Promise((resolve,reject)=>{const transaction=db.transaction('runtime','readwrite');transaction.objectStore('runtime').put({profileId:profile.id,epoch,active},'server');transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(transaction.error)})}finally{store.db.close();files.close()}
}

export function openFilesDatabase(indexedDB,profile){return new Promise((resolve,reject)=>{const request=indexedDB.open(profile.filesDbName,2);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'key'});if(!db.objectStoreNames.contains('runtime'))db.createObjectStore('runtime')};request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(serverError('SERVER_STORAGE_BLOCKED','Close an older tab to update attachment storage'))})}

class ServerController {
 constructor(options,registry,profile){
  this.options=options;this.registry=registry;this.profile=Object.freeze(profile);this.phase='active';this.hooks={};this.listeners=new Set();this.requests=new Set();this.waiters=new Map();this.tabId=options.tabId||crypto.randomUUID();this.prepareTimeoutMs=options.prepareTimeoutMs??10000;
  const Broadcast=options.BroadcastChannel;this.channel=Broadcast?new Broadcast(CHANNEL):null;
  if(this.channel)this.channel.onmessage=event=>{void this._message(event.data).catch(error=>this._emit({type:'error',error}))};
 }
 async start(){
  await this._heartbeat();const interval=this.options.heartbeatMs??5000;this.heartbeat=setInterval(()=>{void this._heartbeat().catch(()=>{})},interval);this.heartbeat.unref?.();
  // Do not close/fence the store before the application's pagehide save handler.
  this.pagehide=()=>{clearInterval(this.heartbeat);this._abort();void this.registry.write('tabs',this.tabId,undefined).catch(()=>{})};this.options.eventTarget?.addEventListener('pagehide',this.pagehide);
  this.pageshow=event=>{if(event.persisted)this.options.reload(this.permissionURL(this.profile.origin))};this.options.eventTarget?.addEventListener('pageshow',this.pageshow);
  this.pendingOrigin=(await this.registry.read('meta','pending'))?.origin||'';
 }
 _emit(event){for(const listener of this.listeners)try{listener(event)}catch{}}
 on(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener)}
 setHooks(hooks){this.hooks={...this.hooks,...hooks};return this}
 async _heartbeat(){if(this.phase==='closed'||this.phase==='stale')return;if(this.phase==='active')await this.assertActive();await this.registry.write('tabs',null,{id:this.tabId,profileId:this.profile.id,epoch:this.profile.epoch,seen:Date.now()})}
 _send(value){this.channel?.postMessage(value)}
 assertWritable(){if(!['active','preparing'].includes(this.phase))throw changed()}
 guardTransaction(transaction){this.assertWritable();const request=transaction.objectStore('runtime').get('server');request.onsuccess=()=>{const gate=request.result;if(!gate?.active||gate.profileId!==this.profile.id||gate.epoch!==this.profile.epoch)transaction.abort()};return transaction}
 openFiles(){return openFilesDatabase(this.options.indexedDB,this.profile)}
 fileTransaction(db,mode='readonly'){this.assertWritable();const transaction=db.transaction(mode==='readwrite'?['files','runtime']:['files'],mode);return mode==='readwrite'?this.guardTransaction(transaction):transaction}
 async assertActive(){
  if(this.phase!=='active')throw changed();const active=await this.registry.read('meta','active');
  if(active?.profileId!==this.profile.id||active?.epoch!==this.profile.epoch){this._invalidate();const next=active&&await this.registry.read('profiles',active.profileId);if(next)this.options.reload(this.permissionURL(next.origin));throw changed()}
 }
 _abort(){for(const controller of this.requests)controller.abort(changed());this.requests.clear()}
 _invalidate(){this.phase='stale';clearTimeout(this.prepareTimer);clearInterval(this.heartbeat);this._abort();this._emit({type:'stale'})}
 async fetch(input,init={}){
  await this.assertActive();const url=new URL(String(input),this.profile.origin);
  if(url.origin!==this.profile.origin)throw serverError('SERVER_ORIGIN_MISMATCH','A server request cannot change origin');
  const controller=new AbortController(),abort=()=>controller.abort(init.signal?.reason);this.requests.add(controller);
  if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
  const finish=()=>{this.requests.delete(controller);init.signal?.removeEventListener('abort',abort)};let retained=false;
  try{
   const response=await this.options.fetch(url.href,{...init,redirect:'error',signal:controller.signal});await this.assertActive();
   if(!response.body)return response;
   const reader=response.body.getReader(),owner=this;
   const body=new ReadableStream({async pull(stream){try{const result=await reader.read();await owner.assertActive();if(result.done){finish();stream.close()}else stream.enqueue(result.value)}catch(error){finish();stream.error(error)}},async cancel(reason){try{await reader.cancel(reason)}finally{finish()}}});
   const result=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
   for(const property of ['url','type','redirected'])Object.defineProperty(result,property,{value:response[property]});
   retained=true;return result;
  }finally{if(!retained)finish()}
 }
 needsPermission(value){const origin=normalizeOrigin(value,{clientOrigin:this.options.location.origin});return origin!==this.options.location.origin&&new URL(this.options.location.href).searchParams.get('server_origin')!==origin}
 permissionURL(value){const origin=normalizeOrigin(value,{clientOrigin:this.options.location.origin}),url=new URL(this.options.location.href);url.searchParams.set('server_origin',origin);return url.href}
 async requestPermission(value,name){await this.assertActive();const origin=normalizeOrigin(value,{clientOrigin:this.options.location.origin});await this.hooks.flush?.();await this.registry.write('meta','pending',{origin,...(name?{name:this._name(name)}:{})});this.pendingOrigin=origin;this.navigationPending=true;clearInterval(this.heartbeat);await this.registry.write('tabs',this.tabId,undefined);this.options.reload(this.permissionURL(origin));return {origin,reloadURL:this.permissionURL(origin)}}
 async test(value){
  await this.assertActive();
  const origin=normalizeOrigin(value,{clientOrigin:this.options.location.origin});
  if(this.needsPermission(origin))throw Object.assign(serverError('SERVER_PERMISSION_REQUIRED','Reload this page to test the selected server'),{origin,reloadURL:this.permissionURL(origin)});
  return probeServer(origin,{fetch:this.options.fetch,timeoutMs:this.options.probeTimeoutMs??8000});
 }
 async list(){return (await this.registry.all('profiles')).filter(profile=>!profile.hidden).map(copy)}
 _name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>60)throw serverError('INVALID_SERVER_NAME','Server names must contain 1–60 characters');return value.trim()}
 async add(value,name){
  await this.assertActive();
  const origin=normalizeOrigin(value,{clientOrigin:this.options.location.origin}),profile=await profileFor(origin,{name:name===undefined?undefined:this._name(name)}),known=await this.registry.read('profiles',profile.id);
  if(known?.builtin){if(name!==undefined)await this.rename(known.id,name);return this.registry.read('profiles',known.id)}
  const discovery=known?.verifiedAt?null:await this.test(origin);
  const result={...profile,...known,name:name===undefined?(known?.name||profile.name):this._name(name),hidden:false,verifiedAt:known?.verifiedAt||Date.now(),capabilities:discovery?.capabilities||known?.capabilities};
  await this.registry.write('profiles',null,result);await this.registry.write('meta','pending',undefined);this.pendingOrigin='';this._emit({type:'profiles'});return copy(result);
 }
 async rename(id,name){await this.assertActive();const profile=await this.registry.read('profiles',id);if(!profile)throw serverError('UNKNOWN_SERVER','Unknown server');const result={...profile,name:this._name(name)};await this.registry.write('profiles',null,result);this._emit({type:'profiles'});return copy(result)}
 async remove(id){await this.assertActive();const profile=await this.registry.read('profiles',id),active=await this.registry.read('meta','active');if(!profile||profile.builtin||id===active?.profileId)throw serverError('SERVER_REMOVE_DENIED','Switch away before hiding a custom server');await this.registry.write('profiles',null,{...profile,hidden:true});this._emit({type:'profiles'})}
 async _prepare(id){
  if(this.preparing===id)return this.preparation;
  if(this.phase!=='active')throw changed();this.phase='preparing';this.preparing=id;this._abort();this._emit({type:'prepare'});
  this.prepareTimer=setTimeout(()=>{void this._resume(id)},this.prepareTimeoutMs+1000);this.prepareTimer.unref?.();
  this.preparation=(async()=>{await this.hooks.stop?.({reason:'prepare'});await this.hooks.flush?.()})();return this.preparation;
 }
 async _resume(id){if(this.preparing!==id||this.phase!=='preparing')return;clearTimeout(this.prepareTimer);this.phase='active';this.preparing=null;await this.hooks.resume?.();this._emit({type:'cancel'})}
 async _message(message){
  if(!message||message.from===this.tabId)return;
  if(message.type==='prepare'&&message.profileId===this.profile.id&&message.epoch===this.profile.epoch){try{await this._prepare(message.id);this._send({type:'ack',id:message.id,from:this.tabId,ok:true})}catch{this._send({type:'ack',id:message.id,from:this.tabId,ok:false})}}
  else if(message.type==='ack'){const waiter=this.waiters.get(message.id);if(!waiter||!waiter.expected.has(message.from))return;if(!message.ok){waiter.reject(serverError('SERVER_PREPARE_FAILED','Another tab could not save its changes'));return}waiter.expected.delete(message.from);if(!waiter.expected.size)waiter.resolve()}
  else if(message.type==='cancel')await this._resume(message.id);
  else if(message.type==='commit'&&message.profileId===this.profile.id&&message.epoch===this.profile.epoch){this._invalidate();this._emit({type:'switched',profile:message.next});this.options.reload(this.permissionURL(message.next.origin))}
 }
 async switch(id){
  if(!this.options.locks?.request||!this.channel)throw serverError('SERVER_SWITCH_UNSUPPORTED','This browser must support Web Locks and BroadcastChannel to switch servers');
  return this.options.locks.request(LOCK,async()=>{
   await this.assertActive();const target=await this.registry.read('profiles',id);
   if(!target||target.hidden||!target.builtin&&!target.verifiedAt)throw serverError('UNKNOWN_SERVER','Test and add this server before activation');
   if(id===this.profile.id)return this.profile;
   const operation=crypto.randomUUID(),epoch=crypto.randomUUID(),next={...target,epoch},before={profileId:this.profile.id,epoch:this.profile.epoch};let committed=false,gated=false;
   const tabs=await this.registry.all('tabs'),expected=new Set(tabs.filter(tab=>tab.profileId===before.profileId&&tab.epoch===before.epoch&&Date.now()-tab.seen<Math.max(30000,(this.options.heartbeatMs??5000)*3)).map(tab=>tab.id));expected.add(this.tabId);
   let timer;
   const prepared=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(serverError('SERVER_PREPARE_TIMEOUT','Other tabs did not finish saving; the server was not changed')),this.prepareTimeoutMs);this.waiters.set(operation,{expected,resolve,reject})});
   this._send({type:'prepare',id:operation,from:this.tabId,...before});
   void this._prepare(operation).then(()=>{const waiter=this.waiters.get(operation);if(!waiter)return;waiter.expected.delete(this.tabId);if(!waiter.expected.size)waiter.resolve()}).catch(()=>this.waiters.get(operation)?.reject(serverError('SERVER_PREPARE_FAILED','Save the current tab before switching servers')));
   try{
    await prepared;clearTimeout(timer);
    await setProfileGate(this.options.indexedDB,this.profile,before.epoch,false);gated=true;
    await setProfileGate(this.options.indexedDB,next,epoch,true);
    await this.registry.activate(before,{profileId:id,epoch});committed=true;
    this._send({type:'commit',id:operation,from:this.tabId,...before,next});this._invalidate();this._emit({type:'switched',profile:next});this.options.reload(this.permissionURL(next.origin));return next;
   }catch(error){
    if(!committed){if(gated){await setProfileGate(this.options.indexedDB,this.profile,before.epoch,true);await setProfileGate(this.options.indexedDB,next,epoch,false)}this._send({type:'cancel',id:operation,from:this.tabId});await this._resume(operation)}throw error;
   }finally{clearTimeout(timer);this.waiters.delete(operation)}
  });
 }
 async close(){if(this.phase==='closed')return;this.phase='closed';clearInterval(this.heartbeat);clearTimeout(this.prepareTimer);this._abort();this.channel?.close();this.options.eventTarget?.removeEventListener('pagehide',this.pagehide);this.options.eventTarget?.removeEventListener('pageshow',this.pageshow);await this.registry.write('tabs',this.tabId,undefined);this.registry.db.close()}
}

export async function bootstrap(options={}){
 const location=options.location||globalThis.location,settings={indexedDB:options.indexedDB||globalThis.indexedDB,location,storage:options.storage||globalThis.localStorage,locks:options.locks??globalThis.navigator?.locks,BroadcastChannel:options.BroadcastChannel??globalThis.BroadcastChannel,fetch:options.fetch||globalThis.fetch?.bind(globalThis),eventTarget:options.eventTarget||globalThis.window,reload:options.reload||(url=>location.assign(url)),...options};
 const origin=normalizeOrigin(location.origin,{clientOrigin:location.origin}),builtin=await profileFor(origin,{builtin:true,name:'Current site'}),registry=await new Registry(settings.indexedDB).open();
 const initialize=async()=>{const active=await registry.initialize(builtin),saved=await registry.read('profiles',active.profileId);if(!saved||saved.hidden)throw serverError('UNKNOWN_SERVER','The selected server profile is unavailable');const profile={...saved,epoch:active.epoch};await setProfileGate(settings.indexedDB,profile,profile.epoch,true);const controller=new ServerController(settings,registry,profile);await controller.start();return {profile:controller.profile,controller}};
 return settings.locks?.request?settings.locks.request(LOCK,initialize):initialize();
}
