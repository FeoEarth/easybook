import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {digest,inspectSnapshot,verifyBackup} from './backup-core.mjs';

const workspace='a'.repeat(64),original=Buffer.from('Synthetic attachment; never production data.');
const id=digest(original),wire=gzipSync(original),wireId=digest(wire),base=workspace+'/'+id;
const doc={schemaVersion:1,doc:{type:'doc',content:[{type:'image',attrs:{assetId:'sha256:'+id}}]}};
const sql=Buffer.from(`CREATE TABLE notes_json(workspace TEXT,document TEXT,purged INTEGER); INSERT INTO notes_json VALUES('${workspace}','${JSON.stringify(doc)}',0);`);
const attachment={v:2,id,wireId,size:original.length,wireSize:wire.length,encoding:'gzip',localOnly:false,parts:[{hash:wireId,size:wire.length}]};
const data=new Map([['database.sql',sql],[base+'/manifest-v2',Buffer.from(JSON.stringify(attachment))],[base+'/'+wireId+'/0',wire]]);
const entry=key=>({key,storageKey:key,size:data.get(key).length,sha256:digest(data.get(key))});
const manifest={format:1,status:'complete',database:entry('database.sql'),objects:[entry(base+'/manifest-v2'),entry(base+'/'+wireId+'/0')]};
const get=async e=>{if(!data.has(e.storageKey))throw Error('missing_fixture_object');return data.get(e.storageKey)};
assert.equal((await verifyBackup(manifest,get)).attachments,1);
assert.equal((await verifyBackup(manifest,get)).attachments,1,'repeated validation has no mutation');
await assert.rejects(verifyBackup({...manifest,status:'running'},get),/incomplete_backup/);
await assert.rejects(verifyBackup({...manifest,objects:manifest.objects.slice(0,1)},get),/missing_attachment/);
await assert.rejects(verifyBackup(manifest,async e=>e===manifest.database?Buffer.from('corrupt'):get(e)),/corrupt_database/);
await assert.rejects(verifyBackup(manifest,async e=>e.key.endsWith('/0')?Buffer.from('corrupt'):get(e)),/corrupt_object/);
// Matching an outer backup hash cannot hide a corrupt inner content hash.
const badWire=Buffer.from(wire);badWire[0]^=1;const badEntry={...manifest.objects[1],sha256:digest(badWire)};
await assert.rejects(verifyBackup({...manifest,objects:[manifest.objects[0],badEntry]},async e=>e===badEntry?badWire:get(e)),/part_hash/);
await assert.rejects(verifyBackup({...manifest,objects:[...manifest.objects,manifest.objects[0]]},get),/duplicate_object/);
assert.throws(()=>inspectSnapshot('CREATE TABLE security_revocations(id TEXT); CREATE TABLE notes_json(id TEXT);'),/wrong_database/);
assert.throws(()=>inspectSnapshot('broken SQL'),/syntax/);
// A tombstone legitimately permits an old document reference to missing bytes.
const tombstoneSQL=sql.toString()+`CREATE TABLE attachment_tombstones(workspace TEXT,attachment TEXT); INSERT INTO attachment_tombstones VALUES('${workspace}','${id}');`;
assert.equal(inspectSnapshot(tombstoneSQL).references.length,0);
const local={...attachment,localOnly:true,wireSize:0,parts:[]};
const localBytes=Buffer.from(JSON.stringify(local)),localEntry={...manifest.objects[0],size:localBytes.length,sha256:digest(localBytes)};
assert.equal((await verifyBackup({...manifest,objects:[localEntry]},async e=>e===localEntry?localBytes:get(e))).localOnly,1);
console.log('PASS backup closure: SQL integrity, compressed attachment hashes, missing/corrupt bytes, incomplete backup, duplicate entries, repeated verification, independent security DB rejection, tombstones and explicit local-only exclusions.');
