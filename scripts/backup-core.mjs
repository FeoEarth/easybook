import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function inspectSnapshot(sql) {
 const db = new DatabaseSync(':memory:');
 try {
  db.exec(sql);
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('snapshot_integrity');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('snapshot_foreign_keys');
  // Explicitly reject the independent security database as a business backup.
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  if (!tables.has('notes_json') || tables.has('security_revocations')) throw Error('wrong_database');
  const refs = new Set();
  const tombstones = tables.has('attachment_tombstones') ? new Set(db.prepare('SELECT workspace,attachment FROM attachment_tombstones').all().map(r=>r.workspace+'/'+r.attachment)) : new Set();
  function walk(node, workspace) {
   if (['image','attachment'].includes(node?.type)) {
    const asset = node.attrs?.assetId;
    if (typeof asset !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset)) throw Error('invalid_attachment_reference');
    const key = workspace+'/'+asset.slice(7);
    if (!tombstones.has(key)) refs.add(key);
   }
   for (const child of node?.content || []) walk(child, workspace);
  }
  for (const row of db.prepare('SELECT workspace,document FROM notes_json WHERE purged=0').all()) {
   if (!hex(row.workspace)) throw Error('invalid_workspace');
   walk(JSON.parse(row.document).doc, row.workspace);
  }
  const checkpoint=tables.has('security_restore_state')?db.prepare('SELECT epoch FROM security_restore_state WHERE id=1').get():null;
  return {references:[...refs].sort(),tables:tables.size,securityEpoch:checkpoint?.epoch || null};
 } finally { db.close(); }
}

// Validates the bytes that will actually be restored, rather than live R2 HEADs.
// R2 is not an atomic snapshot: only a complete, hash-checked closure is accepted.
export async function verifyAttachments(references, entries, get) {
 const objects = new Map(entries.map(e=>[e.key,e]));
 if (objects.size !== entries.length) throw Error('duplicate_object');
 async function bytes(key) {
  const entry=objects.get(key); if(!entry) throw Error('missing_attachment');
  const value=Buffer.from(await get(entry));
  if(value.length!==entry.size || digest(value)!==entry.sha256) throw Error('corrupt_attachment');
  return value;
 }
 const roots=new Set(references);
 for(const key of objects.keys()) {
  if(/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/manifest-v2)?$/.test(key)) roots.add(key.replace(/\/manifest-v2$/,''));
 }
 let localOnly=0;
 for(const base of roots) {
  const id=base.split('/')[1];
  if(!objects.has(base+'/manifest-v2')) { if(digest(await bytes(base))!==id) throw Error('legacy_hash'); continue; }
  const manifestBytes=await bytes(base+'/manifest-v2');
  if(manifestBytes.length>16384) throw Error('manifest_size');
  const m=JSON.parse(manifestBytes);
  if(m.v!==2 || m.id!==id || !hex(m.wireId) || !Number.isSafeInteger(m.size) || m.size<0 || m.size>1073741824 || !Array.isArray(m.parts) || m.parts.length>13) throw Error('invalid_manifest');
  if(m.localOnly===true) { if(m.parts.length || m.wireSize!==0) throw Error('invalid_local_manifest'); localOnly++; continue; }
  if(m.localOnly!==false || !['identity','gzip'].includes(m.encoding)) throw Error('manifest_encoding');
  const chunks=[];
  for(let i=0;i<m.parts.length;i++) {
   const p=m.parts[i]; if(!hex(p.hash) || !Number.isSafeInteger(p.size) || p.size<1 || p.size>4194304) throw Error('invalid_part');
   const b=await bytes(base+'/'+m.wireId+'/'+i);
   if(b.length!==p.size || digest(b)!==p.hash) throw Error('part_hash'); chunks.push(b);
  }
  const wire=Buffer.concat(chunks);
  if(wire.length!==m.wireSize || wire.length>52428800 || digest(wire)!==m.wireId) throw Error('wire_hash');
  const original=m.encoding==='gzip'?gunzipSync(wire,{maxOutputLength:Math.max(1,m.size)}):wire;
  if(original.length!==m.size || digest(original)!==id) throw Error('original_hash');
 }
 return {attachments:roots.size,localOnly};
}

export async function verifyBackup(manifest, get) {
 if(manifest?.format!==1 || manifest.status!=='complete' || !Array.isArray(manifest.objects)) throw Error('incomplete_backup');
 const sql=Buffer.from(await get(manifest.database));
 if(sql.length!==manifest.database.size || digest(sql)!==manifest.database.sha256) throw Error('corrupt_database');
 const inspected=inspectSnapshot(sql.toString('utf8'));
 for(const entry of manifest.objects) {
  if(!/^[a-f0-9]{64}\/[a-f0-9]{64}(?:\/(?:manifest-v2|[a-f0-9]{64}\/(?:[0-9]|1[0-2])))?$/.test(entry.key) || !hex(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size<0) throw Error('invalid_object_entry');
  const b=Buffer.from(await get(entry)); if(b.length!==entry.size || digest(b)!==entry.sha256) throw Error('corrupt_object');
 }
 return {...inspected,...await verifyAttachments(inspected.references,manifest.objects,get)};
}
