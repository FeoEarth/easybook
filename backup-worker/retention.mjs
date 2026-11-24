// Retention operates only on private backup buckets. No live attachment deletion.
const DAY=86400000,MAX_LIST=50000,MAX_DELETE_GROUPS=20;
const pattern=/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[a-f0-9-]{36}$/;
function runTime(id){const m=pattern.exec(id);return m?Date.parse(m[1]+':'+m[2]+':'+m[3]+'.'+m[4]+'Z'):NaN}
async function listAll(bucket,prefix){
 const out=[];let cursor;
 do{const page=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});out.push(...page.objects);if(out.length>MAX_LIST)throw Error('retention_list_limit');if(!page.truncated)break;if(!page.cursor||page.cursor===cursor)throw Error('retention_cursor');cursor=page.cursor;}while(true);
 return out.filter(x=>x.key.startsWith(prefix));
}
function groups(objects,prefix){const result=new Map();for(const x of objects){const id=x.key.slice(prefix.length).split('/')[0],time=runTime(id);if(!Number.isFinite(time))continue;let g=result.get(id);if(!g){g={id,time,prefix:prefix+id+'/',keys:[]};result.set(id,g)}g.keys.push(x.key)}return [...result.values()].sort((a,b)=>b.time-a.time)}
async function readJSON(bucket,key){const object=await bucket.get(key);return object?object.json():null}
async function remove(bucket,g,guard){if(!await guard())return false;const manifest=g.prefix+'manifest.json';if(g.keys.includes(manifest))await bucket.delete(manifest);for(let i=0;i<g.keys.length;i+=100){if(!await guard())return false;const batch=g.keys.slice(i,i+100).filter(k=>k!==manifest);if(batch.length)await bucket.delete(batch)}return true}
export function securityKeep(groups,now){
 const keep=new Set(),days=new Set(),months=new Set();
 for(const [i,g] of groups.entries()){const date=new Date(g.time).toISOString(),age=now-g.time;
  if(i<3||age<7*DAY){keep.add(g.id);continue}
  if(age<90*DAY){const day=date.slice(0,10);if(!days.has(day)){days.add(day);keep.add(g.id)}}
  else{const month=date.slice(0,7);if(!months.has(month)){months.add(month);keep.add(g.id)}}
 }return keep;
}
export async function pruneBusiness(bucket,receipt,{now=Date.now(),guard=async()=>false}={}){
 if(receipt?.status!=='complete'||receipt.storageLayout!=='cas-v2'||!receipt.manifestKey||!await guard())return {skipped:true};
 const latest=await readJSON(bucket,'status/latest-success.json');if(latest?.id!==receipt.id||latest.manifestSha256!==receipt.manifestSha256)throw Error('retention_latest_changed');
 const all=groups(await listAll(bucket,'backups/'),'backups/'),complete=[],incomplete=[];
 for(const g of all){const key=g.prefix+'manifest.json';if(g.keys.includes(key)){
  const m=await readJSON(bucket,key);if(m?.format!==1||m.status!=='complete'||m.id!==g.id||!Array.isArray(m.objects)||!m.database?.storageKey)throw Error('retention_bad_manifest');
  complete.push({...g,manifest:m});
 }else incomplete.push(g)}
 if(!complete.some(g=>g.id===receipt.id))throw Error('retention_missing_latest');
 // Require three verified CAS generations before pruning any completed legacy backup.
 const cas=complete.filter(g=>g.manifest.storageLayout==='cas-v2');
 const keep=new Set([...complete.slice(0,3).map(g=>g.id),receipt.id]);
 const expired=complete.filter(g=>!keep.has(g.id)&&now-g.time>30*DAY&&cas.length>=3);
 const failed=incomplete.filter(g=>now-g.time>7*DAY);
 let removed=0;for(const g of [...failed,...expired].sort((a,b)=>a.time-b.time).slice(0,MAX_DELETE_GROUPS)){if(!await remove(bucket,g,guard))break;removed++}
 // Mark/sweep only after three CAS snapshots; re-list every remaining manifest.
 // Old incomplete CAS writes get a 7-day grace period. Never sweep a malformed manifest.
 let blobs=0;
 if(cas.length>=3&&await guard()){
  const retained=groups(await listAll(bucket,'backups/'),'backups/'),marked=new Set();
  for(const g of retained){const key=g.prefix+'manifest.json';if(!g.keys.includes(key))continue;const m=await readJSON(bucket,key);
   if(m?.status!=='complete'||m.id!==g.id||!Array.isArray(m.objects))throw Error('retention_bad_manifest');
   for(const e of m.objects)if(e.storageKey?.startsWith('blobs/sha256/')){if(e.storageKey!=='blobs/sha256/'+e.sha256||!/^([a-f0-9]{64})$/.test(e.sha256))throw Error('retention_bad_blob');marked.add(e.storageKey)}
  }
  const garbage=(await listAll(bucket,'blobs/sha256/')).filter(o=>/^blobs\/sha256\/[a-f0-9]{64}$/.test(o.key)&&!marked.has(o.key)&&Number.isFinite(new Date(o.uploaded).getTime())&&now-new Date(o.uploaded).getTime()>7*DAY).slice(0,100);
  if(garbage.length&&await guard()){await bucket.delete(garbage.map(o=>o.key));blobs=garbage.length}
 }
 return {removed,blobs,complete:complete.length,cas:cas.length};
}
export async function pruneSecurity(bucket,latest,{now=Date.now()}={}){
 const receipt=await readJSON(bucket,'status/latest.json');if(receipt?.sqlKey!==latest.sqlKey||latest.status!=='complete')return {skipped:true};
 const all=groups(await listAll(bucket,'checkpoints/'),'checkpoints/').filter(g=>g.keys.includes(g.prefix+'manifest.json')&&g.keys.includes(g.prefix+'security.sql'));
 const keep=securityKeep(all,now);const current=latest.sqlKey.split('/')[1];keep.add(current);
 if(!all.some(g=>g.id===current))throw Error('security_retention_missing_latest');
 let removed=0;
 for(const g of all.filter(g=>!keep.has(g.id)&&now-g.time>7*DAY).reverse().slice(0,MAX_DELETE_GROUPS)){
  const guard=async()=>{const r=await readJSON(bucket,'status/latest.json');return r?.sqlKey===latest.sqlKey};
  if(!await remove(bucket,g,guard))break;removed++;
 }
 return {removed,retained:all.length-removed};
}
