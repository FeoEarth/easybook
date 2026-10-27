import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const quoteId=value=>'"'+value.replaceAll('"','""')+'"';
const schemaSQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)<>'_cf_' ORDER BY type,name";
const DAY=86400000,MAX_SQL=16*1024*1024,MAX_OBJECT=50*1024*1024;
const validKey=key=>/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/(?:manifest-v2|[a-f0-9]{64}\/(?:[0-9]|1[0-2])))?$/.test(key);
const rows=async statement=>(await statement.all()).results;
async function checkpoint(env){
 const db=env.SECURITY_DB.withSession?.('first-primary') || env.SECURITY_DB;
 const s=await db.prepare('SELECT mode,epoch FROM security_state WHERE id=1 AND EXISTS(SELECT 1 FROM security_installation WHERE id=1)').first();
 if(s?.mode!=='open')throw Error('security_locked');return s;
}

// All exported rows, schema verification, reference data and business epoch
// are read in ONE D1 batch transaction. No table-by-table live snapshot claim.
export async function snapshot(env){
 const db=env.DB.withSession?.('first-primary') || env.DB;
 const schema=await rows(db.prepare(schemaSQL)),tables=schema.filter(x=>x.type==='table');
 if(tables.length>75 || !tables.some(x=>x.name==='notes_json') || tables.some(x=>x.name==='security_revocations'||/CREATE VIRTUAL TABLE/i.test(x.sql)))throw Error('unsupported_schema');
 const statements=[db.prepare(schemaSQL)];
 for(const table of tables){
  const columns=(await rows(db.prepare('PRAGMA table_info('+quoteId(table.name)+')'))).map(c=>quoteId(c.name));
  if(!columns.length)throw Error('missing_columns');
  const prefix='INSERT INTO '+quoteId(table.name)+'('+columns.join(',')+') VALUES(';
  const literal=value=>"'"+value.replaceAll("'","''")+"'";
  statements.push(db.prepare('SELECT '+literal(prefix)+'||'+columns.map(c=>'quote('+c+')').join("||','||")+"||');' AS line FROM "+quoteId(table.name)));
 }
 statements.push(db.prepare('SELECT workspace,document FROM notes_json WHERE purged=0'),db.prepare('SELECT epoch FROM security_restore_state WHERE id=1'),db.prepare('SELECT workspace,attachment FROM attachment_tombstones'),db.prepare('SELECT name,seq FROM sqlite_sequence'));
 const result=await db.batch(statements);
 if(JSON.stringify(result[0].results)!==JSON.stringify(schema))throw Error('schema_changed');
 const definitions=schema.filter(x=>x.type==='table').map(x=>x.sql+';');
 const data=result.slice(1,1+tables.length).flatMap(x=>x.results.map(r=>r.line));
 const sequence=result.at(-1).results;
 const sequenceSQL=sequence.length?["DELETE FROM sqlite_sequence;",...sequence.map(r=>"INSERT INTO sqlite_sequence(name,seq) VALUES('"+r.name.replaceAll("'","''")+"',"+Number(r.seq)+');')]:[];
 const sql=['PRAGMA foreign_keys=OFF;',...definitions,...data,...sequenceSQL,...schema.filter(x=>x.type!=='table').map(x=>x.sql+';'),'PRAGMA foreign_keys=ON;'].join('\n');
 if(new TextEncoder().encode(sql).length>MAX_SQL)throw Error('snapshot_too_large');
 const tombstones=new Set(result.at(-2).results.map(r=>r.workspace+'/'+r.attachment)),references=new Set();
 function walk(node,workspace){
  if(['image','attachment'].includes(node?.type)){
   if(!/^sha256:[a-f0-9]{64}$/.test(node.attrs?.assetId||'') || !/^[a-f0-9]{64}$/.test(workspace))throw Error('invalid_reference');
   const key=workspace+'/'+node.attrs.assetId.slice(7);if(!tombstones.has(key))references.add(key);
  }
  for(const child of node?.content || [])walk(child,workspace);
 }
 for(const row of result[1+tables.length].results)walk(JSON.parse(row.document).doc,row.workspace);
 return {sql,references:[...references],epoch:result[2+tables.length].results[0]?.epoch};
}

async function checkedObject(bucket,key,entry){
 const object=await bucket.get(key);if(!object || object.size>MAX_OBJECT)throw Error('object_missing_or_oversize');
 const value=new Uint8Array(await object.arrayBuffer());
 if(entry && (entry.size!==value.length || entry.sha256!==sha(value)))throw Error('object_corrupt');
 return {object,value};
}
export async function verifyStored(env,manifest,references){
 const entries=new Map(manifest.objects.map(o=>[o.key,o]));
 async function bytes(key){const e=entries.get(key);if(!e)throw Error('attachment_missing');return (await checkedObject(env.BACKUPS,e.storageKey,e)).value;}
 const roots=new Set(references);
 for(const key of entries.keys())if(/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/manifest-v2)?$/.test(key))roots.add(key.replace(/\/manifest-v2$/,''));
 let localOnly=0;
 for(const base of roots){
  const id=base.split('/')[1];
  if(!entries.has(base+'/manifest-v2')){if(sha(await bytes(base))!==id)throw Error('legacy_hash');continue;}
  const body=await bytes(base+'/manifest-v2');if(body.length>16384)throw Error('manifest_size');const m=JSON.parse(new TextDecoder().decode(body));
  if(m.v!==2 || m.id!==id || !/^[a-f0-9]{64}$/.test(m.wireId||'') || !Array.isArray(m.parts) || m.parts.length>13 || !Number.isSafeInteger(m.size) || m.size<0 || m.size>1073741824)throw Error('manifest_invalid');
  if(m.localOnly===true){if(m.parts.length || m.wireSize!==0)throw Error('local_manifest_invalid');localOnly++;continue;}
  if(m.localOnly!==false || !['identity','gzip'].includes(m.encoding))throw Error('encoding_invalid');
  async function* chunks(){for(let i=0;i<m.parts.length;i++){
   const p=m.parts[i],value=await bytes(base+'/'+m.wireId+'/'+i);
   if(!Number.isSafeInteger(p.size) || p.size<1 || p.size>4194304 || value.length!==p.size || sha(value)!==p.hash)throw Error('part_hash');yield value;
  }}
  const wireHash=createHash('sha256'),originalHash=createHash('sha256');let wireSize=0,size=0;
  const iterator=chunks();let stream=new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else{wireSize+=next.value.length;if(wireSize>MAX_OBJECT)throw Error('wire_limit');wireHash.update(next.value);controller.enqueue(next.value);}}catch(error){controller.error(error);}},cancel(){return iterator.return();}});
  if(m.encoding==='gzip')stream=stream.pipeThrough(new DecompressionStream('gzip'));
  for await(const chunk of stream){size+=chunk.length;if(size>m.size)throw Error('expanded_limit');originalHash.update(chunk);}
  if(size!==m.size || originalHash.digest('hex')!==id || wireSize!==m.wireSize || wireHash.digest('hex')!==m.wireId)throw Error('content_hash');
 }
 return {attachments:roots.size,localOnly};
}

export async function backup(env,now=Date.now()){
 const lease=crypto.randomUUID(),day=Math.floor(now/DAY)*DAY;
 const claimed=await env.DB.prepare("INSERT INTO identity_maintenance_runs(name,lease,lease_until) VALUES('business-backup',?,?) ON CONFLICT(name) DO UPDATE SET lease=excluded.lease,lease_until=excluded.lease_until WHERE identity_maintenance_runs.completed_at<? AND identity_maintenance_runs.lease_until<? RETURNING name").bind(lease,now+900000,day,now).first();
 if(!claimed)return {status:'skipped'};
 const id=new Date(now).toISOString().replace(/[:.]/g,'-')+'-'+lease,prefix='backups/'+id+'/';
 const status={format:1,id,startedAt:new Date(now).toISOString(),release:env.RELEASE_SHA};
 const putJSON=(key,value)=>env.BACKUPS.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});
 try{
  await putJSON(prefix+'status.json',{...status,status:'running'});
  const security=await checkpoint(env),dump=await snapshot(env);if(dump.epoch!==security.epoch)throw Error('security_epoch');
  const sqlBytes=new TextEncoder().encode(dump.sql),database={storageKey:prefix+'database.sql',size:sqlBytes.length,sha256:sha(sqlBytes)};
  await env.BACKUPS.put(database.storageKey,sqlBytes);await checkedObject(env.BACKUPS,database.storageKey,database);
  const objects=[];let cursor,temporaryUploadsExcluded=0,total=0;
  do{
   const page=await env.ATTACHMENTS.list({limit:100,...(cursor?{cursor}:{})});
   for(const listed of page.objects){
    if(Date.now()-now>720000 || objects.length>=10000)throw Error('backup_work_limit');
    if(listed.key.startsWith('_mcp_uploads/')){temporaryUploadsExcluded++;continue;}
    if(!validKey(listed.key))throw Error('unknown_object');
    const {object,value}=await checkedObject(env.ATTACHMENTS,listed.key);total+=value.length;if(total>5*1024**3)throw Error('backup_byte_limit');
    const entry={key:listed.key,storageKey:prefix+'objects/'+listed.key,size:value.length,sha256:sha(value),httpMetadata:object.httpMetadata||{},customMetadata:object.customMetadata||{}};
    if((entry.customMetadata.hash || entry.customMetadata.sha256) && entry.sha256!==(entry.customMetadata.hash || entry.customMetadata.sha256))throw Error('source_hash');
    await env.BACKUPS.put(entry.storageKey,value);await checkedObject(env.BACKUPS,entry.storageKey,entry);objects.push(entry);
   }
   if(!page.truncated)break;if(!page.cursor || page.cursor===cursor)throw Error('listing_cursor');cursor=page.cursor;
  }while(true);
  const manifest={...status,status:'complete',format:1,database,objects,temporaryUploadsExcluded,source:{database:'easybook-data',bucket:'easybook-attachments'},securityDatabaseIncluded:false,consistency:'One D1 batch transaction plus verified R2 reference closure; no cross-service atomic snapshot',completedAt:new Date().toISOString()};
  const verified=await verifyStored(env,manifest,dump.references);if((await checkpoint(env)).epoch!==security.epoch)throw Error('security_changed');
  const encoded=JSON.stringify(manifest);await env.BACKUPS.put(prefix+'manifest.json',encoded);
  const receipt={...status,status:'complete',completedAt:manifest.completedAt,manifestKey:prefix+'manifest.json',manifestSha256:sha(encoded),objects:objects.length,localOnly:verified.localOnly};
  await putJSON(prefix+'status.json',receipt);await putJSON('status/latest-success.json',receipt);
  await env.DB.prepare("UPDATE identity_maintenance_runs SET completed_at=?,lease=NULL,lease_until=0,error=NULL WHERE name='business-backup' AND lease=?").bind(Date.now(),lease).run();return receipt;
 }catch(error){
  const code=/^[a-z_]+$/.test(error.message)?error.message:'backup_failed';
  try{await putJSON(prefix+'status.json',{...status,status:'failed',code});}catch{}
  await env.DB.prepare("UPDATE identity_maintenance_runs SET lease=NULL,lease_until=0,error=? WHERE name='business-backup' AND lease=?").bind('BACKUP_RETRY:'+code,lease).run();
  throw Error('Business backup failed: '+code);
 }
}
export default {async fetch(){return new Response('Not found',{status:404});},async scheduled(controller,env){await backup(env);}};
