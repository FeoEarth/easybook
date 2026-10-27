import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';
import {backup,snapshot} from '../backup-worker/index.mjs';
import {digest,inspectSnapshot,verifyBackup} from './backup-core.mjs';

function adapter(sql){return {prepare(text){const q=sql.prepare(text);let p=[];return {bind(...args){p=args;return this},async first(){return q.get(...p)||null},async all(){return {results:q.all(...p)}},async run(){return q.run(...p)}}},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};}
function bucket(){const data=new Map();return {data,async put(key,value,options={}){data.set(key,{value:Buffer.from(value),...options});},async get(key){const row=data.get(key);return row?{size:row.value.length,customMetadata:row.customMetadata,httpMetadata:row.httpMetadata,body:new Blob([row.value]).stream(),async arrayBuffer(){return Uint8Array.from(row.value).buffer}}:null},async list(){return {truncated:false,objects:[...data].map(([key,row])=>({key,size:row.value.length}))}}};}
function fixture(){
 const db=new DatabaseSync(':memory:'),security=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE notes_json(workspace TEXT,document TEXT,purged INTEGER); CREATE TABLE security_restore_state(id INTEGER PRIMARY KEY,epoch TEXT); INSERT INTO security_restore_state VALUES(1,'synthetic'); CREATE TABLE attachment_tombstones(workspace TEXT,attachment TEXT); CREATE TABLE identity_maintenance_runs(name TEXT PRIMARY KEY,completed_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease TEXT,error TEXT); CREATE TABLE fixture(id INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT,bytes BLOB); INSERT INTO fixture(body,bytes) VALUES('quote '' and Unicode 中文',X'00FF');`);
 db.exec("CREATE TABLE workspaces(id TEXT,manager_account_id TEXT,deleted_at INTEGER); INSERT INTO workspaces VALUES('fixture','fixture-owner',NULL); CREATE TABLE account_notifications(id TEXT PRIMARY KEY,account_id TEXT,severity TEXT,code TEXT,created_at INTEGER,read_at INTEGER); CREATE TABLE z_parent(id INTEGER PRIMARY KEY); CREATE TABLE a_child(parent_id INTEGER REFERENCES z_parent(id)); INSERT INTO z_parent VALUES(1); INSERT INTO a_child VALUES(1);");
 security.exec("CREATE TABLE security_state(id INTEGER,epoch TEXT,mode TEXT);INSERT INTO security_state VALUES(1,'synthetic','open');CREATE TABLE security_installation(id INTEGER);INSERT INTO security_installation VALUES(1);");
 return {db,security,env:{DB:adapter(db),SECURITY_DB:adapter(security),ATTACHMENTS:bucket(),BACKUPS:bucket(),RELEASE_SHA:'synthetic'}};
}
const f=fixture(),workspace='a'.repeat(64),raw=Buffer.from('Synthetic gzipped attachment'),id=digest(raw),wire=gzipSync(raw),wireId=digest(wire),base=workspace+'/'+id;
const manifest={v:2,id,wireId,size:raw.length,wireSize:wire.length,encoding:'gzip',localOnly:false,parts:[{hash:wireId,size:wire.length}]};
await f.env.ATTACHMENTS.put(base+'/manifest-v2',JSON.stringify(manifest));await f.env.ATTACHMENTS.put(base+'/'+wireId+'/0',wire,{customMetadata:{hash:wireId}});await f.env.ATTACHMENTS.put('_mcp_uploads/temporary',Buffer.from('Excluded'));
f.db.prepare('INSERT INTO notes_json VALUES(?,?,0)').run(workspace,JSON.stringify({schemaVersion:1,doc:{type:'doc',content:[{type:'attachment',attrs:{assetId:'sha256:'+id}}]}}));
const dump=await snapshot(f.env),restored=new DatabaseSync(':memory:');restored.exec(dump.sql);
assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
assert.equal(restored.prepare('SELECT body FROM fixture').get().body,"quote ' and Unicode 中文");assert.equal(Buffer.from(restored.prepare('SELECT bytes FROM fixture').get().bytes).toString('hex'),'00ff');restored.close();
const strict=new DatabaseSync(':memory:');strict.exec('PRAGMA foreign_keys=ON;BEGIN;');strict.exec(dump.sql);strict.exec('COMMIT;');assert.equal(strict.prepare('PRAGMA foreign_key_check').all().length,0,'D1-style enforced foreign keys allow out-of-order inserts only with transaction deferral');strict.close();
assert.equal(inspectSnapshot(dump.sql).references.length,1);
const result=await backup(f.env);assert.equal(result.status,'complete');
const completed=JSON.parse(f.env.BACKUPS.data.get(result.manifestKey).value);assert.equal(completed.temporaryUploadsExcluded,1);
assert.equal((await verifyBackup(completed,e=>f.env.BACKUPS.data.get(e.storageKey).value)).attachments,1,'independent Node verifier restores Worker-generated SQL and validates R2 closure');
assert.equal((await backup(f.env)).status,'skipped','daily completion prevents duplicate snapshots');
const broken=fixture();broken.db.prepare('INSERT INTO notes_json VALUES(?,?,0)').run(workspace,JSON.stringify({doc:{type:'doc',content:[{type:'image',attrs:{assetId:'sha256:'+id}}]}}));
await assert.rejects(backup(broken.env),/attachment_missing/);assert.ok(!broken.env.BACKUPS.data.has('status/latest-success.json'));assert.ok([...broken.env.BACKUPS.data.keys()].every(k=>!k.endsWith('/manifest.json')));
assert.equal(broken.db.prepare("SELECT count(*) AS n FROM account_notifications WHERE severity='critical' AND code='operation.backup_failed'").get().n,1);
await assert.rejects(backup(broken.env),/attachment_missing/);assert.equal(broken.db.prepare('SELECT count(*) AS n FROM account_notifications').get().n,1,'same daily failure does not duplicate critical notices');
// A failed attempt releases its lease and the next scheduled attempt can recover.
await broken.env.ATTACHMENTS.put(base,raw);assert.equal((await backup(broken.env)).status,'complete');
const locked=fixture();locked.security.exec("UPDATE security_state SET mode='blocked'");await assert.rejects(backup(locked.env),/security_locked/);
assert.equal(locked.db.prepare('SELECT count(*) AS n FROM account_notifications').get().n,0,'planned restore gate is not a severe incident');
for(const x of [f,broken,locked]){x.db.close();x.security.close();}
console.log('PASS binding backup: one-transaction SQL export restores quotes/Unicode/BLOBs, full compressed R2 closure passes independent verifier, daily exclusion, missing attachment fail-closed, failed-job retry and recovery gate.');
