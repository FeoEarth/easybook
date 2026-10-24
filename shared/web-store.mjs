/** One atomic workspace record contains notes, dirty outbox, in-flight requests and pull cursor.
 * Revision CAS rejects another tab's stale snapshot instead of overwriting it. */
export class WebStore {
 constructor(indexedDB){this.indexedDB=indexedDB;this.revision=0;this.tail=Promise.resolve();this.failed=false}
 async open(){this.db=await new Promise((resolve,reject)=>{const r=this.indexedDB.open('easybook-json-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('spaces');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
 async load(key){await this.tail;const data=await new Promise((resolve,reject)=>{const t=this.db.transaction('spaces','readonly'),r=t.objectStore('spaces').get(key);let value;r.onsuccess=()=>value=r.result;t.oncomplete=()=>resolve(value);t.onerror=t.onabort=()=>reject(t.error)});this.revision=data?.revision||0;this.failed=false;const management=await new Promise((resolve,reject)=>{const t=this.db.transaction('spaces','readonly'),r=t.objectStore('spaces').get('management:'+key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {...(data||{notes:[],folders:[],inflight:{},cursor:0}),...(management?{management}:{})}}
 save(key,data){const snapshot=JSON.parse(JSON.stringify(data));this.tail=this.tail.then(()=>new Promise((resolve,reject)=>{if(this.failed)return reject(Error('Reload required after local write conflict'));const t=this.db.transaction('spaces','readwrite'),s=t.objectStore('spaces'),r=s.get(key);r.onsuccess=()=>{if((r.result?.revision||0)!==this.revision){t.abort();return}s.put({...snapshot,revision:this.revision+1},key);if(snapshot.management)s.put(snapshot.management,'management:'+key)};t.oncomplete=()=>{this.revision++;resolve()};t.onerror=t.onabort=()=>{this.failed=true;reject(t.error||Error('Local revision conflict: reload to preserve both tabs'))}}));return this.tail}
 flush(){return this.tail}
}

