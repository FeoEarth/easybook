/** Atomic workspace snapshots with revision CAS. The local namespace is stable
 * across credential rotation and may retain a legacy storage address. Bindings
 * are local lookup metadata, never authorization or an alternative sync key. */
export class WebStore {
 constructor(indexedDB){this.indexedDB=indexedDB;this.revision=0;this.revisions=new Map();this.tail=Promise.resolve();this.failed=false}
 async open(){this.db=await new Promise((resolve,reject)=>{const r=this.indexedDB.open('easybook-json-v1',3);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('vault'))db.createObjectStore('vault');if(!db.objectStoreNames.contains('spaces'))db.createObjectStore('spaces');if(!db.objectStoreNames.contains('bindings'))db.createObjectStore('bindings');if(!db.objectStoreNames.contains('workspaces')){const s=db.createObjectStore('workspaces',{keyPath:'id'});s.createIndex('localNamespace','localNamespace',{unique:true})}};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close other Easybook tabs to upgrade local storage'))})}
 async fingerprint(key){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),b=>b.toString(16).padStart(2,'0')).join('')}
 async namespace(key){const digest=await this.fingerprint(key);return new Promise((resolve,reject)=>{const t=this.db.transaction(['bindings','spaces'],'readonly'),r=t.objectStore('bindings').get(digest);r.onsuccess=()=>{if(r.result)return resolve(r.result.localNamespace);const legacy=t.objectStore('spaces').get(key);legacy.onsuccess=()=>resolve(legacy.result?key:'local:'+digest);legacy.onerror=()=>reject(legacy.error)};r.onerror=()=>reject(r.error)})}
 async vaultGet(name){return new Promise((resolve,reject)=>{const r=this.db.transaction('vault','readonly').objectStore('vault').get(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async vaultKey(){const existing=await this.vaultGet('key');if(existing)return existing;const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);return new Promise((resolve,reject)=>{const t=this.db.transaction('vault','readwrite'),s=t.objectStore('vault'),r=s.get('key');let selected;r.onsuccess=()=>{selected=r.result||candidate;if(!r.result)s.put(candidate,'key')};t.oncomplete=()=>resolve(selected);t.onerror=t.onabort=()=>reject(t.error)})}
 async setActiveCredential(value){if(!/^(?:account:)?[a-f0-9]{64}$/.test(value))throw Error('Invalid local credential');const key=await this.vaultKey(),iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('easybook-active-v1')},key,new TextEncoder().encode(value));return new Promise((resolve,reject)=>{const t=this.db.transaction('vault','readwrite');t.objectStore('vault').put({iv,data},'active');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error)})}
 async activeCredential(legacy){const saved=await this.vaultGet('active');if(saved){const key=await this.vaultGet('key');if(!key)throw Error('Local credential key unavailable');const value=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:new TextEncoder().encode('easybook-active-v1')},key,saved.data));if(!/^(?:account:)?[a-f0-9]{64}$/.test(value))throw Error('Local credential invalid');return value}const value=legacy||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');await this.setActiveCredential(value);return value}

 async load(key){await this.tail;const fallback=await this.namespace(key),digest=await this.fingerprint(key);return new Promise((resolve,reject)=>{const t=this.db.transaction(['spaces','bindings'],'readonly'),s=t.objectStore('spaces'),b=t.objectStore('bindings').get(digest);let localNamespace,data,management;b.onsuccess=()=>{localNamespace=b.result?.localNamespace||fallback;const r=s.get(localNamespace);r.onsuccess=()=>data=r.result;const m=s.get('management:'+localNamespace);m.onsuccess=()=>management=m.result};t.oncomplete=()=>{this.revision=data?.revision||0;this.revisions.set(localNamespace,this.revision);this.failed=false;resolve({...data,...(!data?{notes:[],folders:[],inflight:{},cursor:0}:{}),...(management?{management}:{})})};t.onerror=t.onabort=()=>reject(t.error)})}
 save(key,data){const snapshot=JSON.parse(JSON.stringify(data));this.tail=this.tail.then(async()=>{const fallback=await this.namespace(key),digest=await this.fingerprint(key);return new Promise((resolve,reject)=>{if(this.failed)return reject(Error('Reload required after local write conflict'));const t=this.db.transaction(['spaces','bindings'],'readwrite'),s=t.objectStore('spaces'),b=t.objectStore('bindings').get(digest);let next;b.onsuccess=()=>{const localNamespace=b.result?.localNamespace||fallback,r=s.get(localNamespace);r.onsuccess=()=>{const expected=this.revisions.get(localNamespace);if(expected===undefined||(r.result?.revision||0)!==expected){t.abort();return}next={localNamespace,revision:expected+1};s.put({...snapshot,revision:next.revision},localNamespace);if(snapshot.management)s.put(snapshot.management,'management:'+localNamespace)}};t.oncomplete=()=>{this.revisions.set(next.localNamespace,next.revision);this.revision=next.revision;resolve()};t.onerror=t.onabort=()=>{this.failed=true;reject(t.error||Error('Local revision conflict: reload to preserve both tabs'))}})});return this.tail}
 // Optional local-only key escrow: encrypted under the same nonextractable
 // per-installation AES key as the active credential. Server stores only hashes.
 async personalWorkspaceCredential(workspaceId){
  if(!/^[a-f0-9]{64}$/.test(workspaceId))throw Error('Invalid workspace identity');
  const record=await this.vaultGet('personal-key:'+workspaceId);
  if(!record)return null;
  const vault=await this.vaultGet('key');if(!vault)throw Error('Local credential key unavailable');
  const text=new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:new TextEncoder().encode('easybook-personal-key-v1:'+workspaceId)},vault,record.data));
  if(!/^[a-f0-9]{64}$/.test(text))throw Error('Stored workspace key invalid');
  return text;
 }
 async bindWorkspace(key,workspace){
  if(!workspace||!/^([a-f0-9]{64})$/.test(workspace.id)||!['personal','shared'].includes(workspace.mode)||typeof workspace.name!=='string'||!workspace.name.trim()||workspace.name.length>60)throw Error('Invalid workspace identity');
  await this.tail;const fallback=await this.namespace(key),digest=await this.fingerprint(key);
  const isPersonalKey=workspace.mode==='personal'&&/^[a-f0-9]{64}$/.test(key);
  let sealed=null;
  if(isPersonalKey){const vault=await this.vaultKey(),iv=crypto.getRandomValues(new Uint8Array(12));sealed={iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('easybook-personal-key-v1:'+workspace.id)},vault,new TextEncoder().encode(key))}}
  return new Promise((resolve,reject)=>{const t=this.db.transaction(['spaces','bindings','workspaces','vault'],'readwrite'),spaces=t.objectStore('spaces'),bindings=t.objectStore('bindings'),registry=t.objectStore('workspaces'),vault=t.objectStore('vault');let result,error;
   const abort=message=>{error=Error(message);t.abort()};
   const b=bindings.get(digest);b.onsuccess=()=>{if(b.result&&b.result.workspaceId!==workspace.id){abort('Credential workspace identity changed');return}const source=b.result?.localNamespace||fallback,w=registry.get(workspace.id);w.onsuccess=()=>{const target=w.result?.localNamespace||source;if(target!==source){const pending=spaces.get(source);pending.onsuccess=()=>{const value=pending.result;if(value&&(value.notes?.length||value.folders?.length||Object.keys(value.inflight||{}).length||value.cursor||value.management?.pending?.length)){abort('This key has separate offline data; export it before reconnecting');return}finish(target)}}else finish(target)};function finish(localNamespace){result={id:workspace.id,name:workspace.name,mode:workspace.mode,role:workspace.role||'manager',localNamespace};registry.put(result);bindings.put({workspaceId:workspace.id,localNamespace},digest);if(sealed)vault.put(sealed,'personal-key:'+workspace.id);else if(workspace.mode==='shared')vault.delete('personal-key:'+workspace.id)}};
   t.oncomplete=()=>resolve(result);t.onerror=t.onabort=()=>reject(error||t.error||Error('Workspace binding failed'));
  })
 }
 async workspaceForCredential(key){
  const digest=await this.fingerprint(key);
  return new Promise((resolve,reject)=>{
   const t=this.db.transaction(['bindings','workspaces'],'readonly'),binding=t.objectStore('bindings').get(digest);
   let workspace=null;
   binding.onsuccess=()=>{if(!binding.result)return;const row=t.objectStore('workspaces').get(binding.result.workspaceId);row.onsuccess=()=>{if(row.result){const {localNamespace,...publicRow}=row.result;workspace=publicRow}}};
   t.oncomplete=()=>resolve(workspace);t.onerror=t.onabort=()=>reject(t.error);
  });
 }
 async listWorkspaces(){return new Promise((resolve,reject)=>{const r=this.db.transaction('workspaces','readonly').objectStore('workspaces').getAll();r.onsuccess=()=>resolve(r.result.map(({localNamespace,...workspace})=>workspace));r.onerror=()=>reject(r.error)})}
 flush(){return this.tail}
}

