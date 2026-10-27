import {digest,inspectSnapshot,verifyBackup} from './backup-core.mjs';
import {randomUUID} from 'node:crypto';

const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const database='af430aed-01b5-41ca-9653-31212bed3f9f';
const source='easybook-attachments',destination='easybook-backups';
const securityDatabase='d1761c2d-6372-489c-ae5e-114f3d5baa80';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!account || !token) throw Error('backup_credentials_missing');
const api='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account);
async function request(path,{method='GET',body,json=false,retry=true}={}) {
 for(let attempt=0;attempt<4;attempt++) {
  let response;
  try {response=await fetch(api+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':json?'application/json':'application/octet-stream'}:{})},body:json?JSON.stringify(body):body,signal:AbortSignal.timeout(90000)});}
  catch {if(retry && attempt<3) {await sleep(1000*2**attempt);continue;} throw Error('backup_network');}
  if(retry && (response.status===429 || response.status>=500) && attempt<3) {await response.body?.cancel();await sleep(1000*2**attempt);continue;}
  if(!response.ok) {await response.body?.cancel();throw Error('backup_api_'+response.status);}
  return response;
 }
}
async function json(path,options) {const r=await (await request(path,options)).json();if(r.success===false)throw Error('backup_api_error');return r;}
const objectPath=(bucket,key)=>'/r2/buckets/'+bucket+'/objects/'+key.split('/').map(encodeURIComponent).join('/');
const read=async(bucket,key)=>Buffer.from(await (await request(objectPath(bucket,key))).arrayBuffer());
async function put(key,bytes) {await json(objectPath(destination,key),{method:'PUT',body:bytes});}
async function privateBucket(bucket) {
 const managed=await json('/r2/buckets/'+bucket+'/domains/managed');
 const custom=await json('/r2/buckets/'+bucket+'/domains/custom');
 if(managed.result?.enabled!==false || custom.result?.domains?.length!==0) throw Error('backup_bucket_public');
}
async function exportDatabase() {
 let bookmark;
 for(let poll=0;poll<120;poll++) {
  const r=await json('/d1/database/'+database+'/export',{method:'POST',body:{output_format:'polling',...(bookmark?{current_bookmark:bookmark}:{})},json:true,retry:!!bookmark});
  const result=r.result || r;
  if(result.status==='error') throw Error('backup_export_failed');
  const signed=result.signed_url || result.result?.signed_url;
  if(signed) {
   const url=new URL(signed);if(url.protocol!=='https:')throw Error('backup_export_url');
   // This signed URL must never receive the API Authorization header or enter logs.
   const response=await fetch(url,{signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw Error('backup_export_download');
   return Buffer.from(await response.arrayBuffer());
  }
  bookmark=result.at_bookmark || bookmark;if(!bookmark)throw Error('backup_export_bookmark');
  await sleep(1000);
 }
 throw Error('backup_export_timeout');
}
async function listObjects() {
 const objects=[];let cursor;
 do {
  const q=new URLSearchParams({per_page:'1000',...(cursor?{cursor}:{})});
  const page=await json('/r2/buckets/'+source+'/objects?'+q);
  if(!Array.isArray(page.result))throw Error('backup_listing');
  objects.push(...page.result);
  if(!page.result_info?.is_truncated)break;
  const next=page.result_info.cursor;if(!next || next===cursor)throw Error('backup_listing_cursor');cursor=next;
 } while(true);
 return objects;
}
async function securityState() {
 const response=await json('/d1/database/'+securityDatabase+'/query',{method:'POST',body:{sql:'SELECT mode,epoch FROM security_state WHERE id=1 AND EXISTS(SELECT 1 FROM security_installation WHERE id=1)'},json:true});
 const state=response.result?.[0]?.results?.[0];
 if(state?.mode!=='open' || typeof state.epoch!=='string')throw Error('backup_security_locked');
 return state;
}

const startedAt=new Date().toISOString();
const id=startedAt.replace(/[:.]/g,'-')+'-'+randomUUID();
const prefix='backups/'+id+'/';
const status={format:1,id,startedAt,release:process.env.GITHUB_SHA || null};
try {
 await privateBucket(destination);
 const lifecycle=(await json('/r2/buckets/'+destination+'/lifecycle')).result;
 if(!lifecycle?.rules?.some(r=>r.enabled && r.conditions?.prefix==='backups/' && r.deleteObjectsTransition?.condition?.type==='Age' && r.deleteObjectsTransition.condition.maxAge===2592000))throw Error('backup_retention_missing');
 await put(prefix+'status.json',Buffer.from(JSON.stringify({...status,status:'running'})));
 const checkpoint=await securityState();
 const sql=await exportDatabase();const inspected=inspectSnapshot(sql.toString('utf8'));
 if(inspected.securityEpoch!==checkpoint.epoch)throw Error('backup_security_epoch');
 const dbEntry={storageKey:prefix+'database.sql',size:sql.length,sha256:digest(sql)};
 await put(dbEntry.storageKey,sql);
 const entries=[];
 for(const object of await listObjects()) {
  // Fail on unexpected namespaces rather than silently omit recoverable data.
  if(!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/(?:manifest-v2|[a-f0-9]{64}\/(?:[0-9]|1[0-2])))?$/.test(object.key))throw Error('backup_unknown_object');
  const bytes=await read(source,object.key);
  const entry={key:object.key,storageKey:prefix+'objects/'+object.key,size:bytes.length,sha256:digest(bytes),httpMetadata:object.http_metadata || {},customMetadata:object.custom_metadata || {}};
  // Validate immutable chunk metadata when available. A manifest is allowed to
  // change after listing; the copied manifest's own closure is checked below.
  if(entry.customMetadata.hash && digest(bytes)!==entry.customMetadata.hash)throw Error('backup_source_hash');
  await put(entry.storageKey,bytes);entries.push(entry);
 }
 const manifest={...status,format:1,status:'complete',completedAt:new Date().toISOString(),source:{database,bucket:source},database:dbEntry,objects:entries,consistency:'D1 export snapshot; copied R2 closure verified against snapshot references; no cross-service atomic snapshot',securityDatabaseIncluded:false};
 // Restore verification reads every object back from the destination. Completion
 // is committed only after SQLite integrity and all attachment hashes succeed.
 const result=await verifyBackup(manifest,e=>read(destination,e.storageKey));
 if((await securityState()).epoch!==checkpoint.epoch)throw Error('backup_security_changed');
 await privateBucket(destination);
 await put(prefix+'manifest.json',Buffer.from(JSON.stringify(manifest)));
 const receipt={...status,status:'complete',completedAt:manifest.completedAt,manifestKey:prefix+'manifest.json',manifestSha256:digest(Buffer.from(JSON.stringify(manifest))),objects:entries.length,references:inspected.references.length,localOnly:result.localOnly};
 await put(prefix+'status.json',Buffer.from(JSON.stringify(receipt)));
 await put('status/latest-success.json',Buffer.from(JSON.stringify(receipt)));
 console.log(JSON.stringify({status:'complete',id,objects:entries.length,localOnly:result.localOnly}));
} catch(error) {
 // No signed URLs, user identifiers, note contents or API error bodies in logs.
 const code=/^backup_[a-z0-9_]+$/.test(error.message)?error.message:'backup_validation_failed';
 try {await put(prefix+'status.json',Buffer.from(JSON.stringify({...status,status:'failed',failedAt:new Date().toISOString(),code})));}catch{}
 console.error(JSON.stringify({status:'failed',id,code}));process.exitCode=1;
}
