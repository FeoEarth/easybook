import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.mjs';
import {folderTool} from '../worker/mcp-folders.mjs';
import {hash} from '../worker/mcp-common.mjs';

const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('worker/schema.sql','utf8'));
// Match the transaction and changes() behavior used by the MCP SQLite harness.
const DB={prepare(query){const statement=sql.prepare(query);let params=[];return {bind(...p){params=p;return this},async first(){return statement.get(...params)||null},async all(){return {results:statement.all(...params)}},async run(){const r=statement.run(...params);return {meta:{changes:Number(r.changes)}}}}},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push({...await s.all(),meta:{changes:sql.prepare('SELECT changes() n').get().n}});sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const key='a'.repeat(64),workspace=await hash(key),ctx={env:{DB},workspace};
async function request(path,data){const res=await worker.fetch(new Request('https://test.local'+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key},body:data?JSON.stringify(data):undefined}),{DB});return {status:res.status,...await res.json()};}
async function read(id){return (await request('/api/folders')).folders.find(f=>f.id===id);}
async function put(id,data){return request('/api/folders/'+id,data);}
const revised=(name,version)=>({name,version,mutation:crypto.randomUUID()});

try{
 // MCP-created folders participate in the same revisions as Web/Android writes.
 const created=await folderTool(ctx,'folders_create',{name:'Initial',management_version:0});
 const initial=await read(created.id);assert.equal(initial.version,1);
 await folderTool(ctx,'folders_rename',{id:created.id,name:'MCP name',updated:created.updated});
 const afterRename=await read(created.id);assert.equal(afterRename.version,2);assert.notEqual(afterRename.mutation,initial.mutation);
 const stale=await put(created.id,revised('Stale device',initial.version));assert.equal(stale.status,409);assert.equal(stale.folder.name,'MCP name');
 await assert.rejects(()=>folderTool(ctx,'folders_rename',{id:created.id,name:'Stale MCP',updated:created.updated}),e=>e.code==='CONFLICT');
 assert.equal((await read(created.id)).version,afterRename.version,'failed MCP rename does not advance the revision');
 const currentRequest=revised('Fresh device',afterRename.version),fresh=await put(created.id,currentRequest);assert.equal(fresh.status,200);assert.equal(fresh.folder.version,3);
 const replay=await put(created.id,currentRequest);assert.equal(replay.replayed,true);assert.equal(replay.folder.version,3);

 await assert.rejects(()=>folderTool(ctx,'folders_delete',{id:created.id,updated:0,management_version:created.management_version}),e=>e.code==='CONFLICT');
 assert.equal((await read(created.id)).version,3,'failed MCP delete does not advance the revision');
 await folderTool(ctx,'folders_delete',{id:created.id,updated:fresh.folder.updated,management_version:created.management_version});
 const deleted=await read(created.id);assert.equal(deleted.deleted,1);assert.equal(deleted.version,4);
 const staleAfterDelete=await put(created.id,revised('Stale deleted folder',3));assert.equal(staleAfterDelete.status,409);assert.equal(staleAfterDelete.folder.deleted,1);

 // Legacy clients retain timestamp ordering, while newer clients detect changes.
 const id=crypto.randomUUID(),first=await put(id,revised('Web name',0)),timestamp=first.folder.updated+10;
 const legacy=await put(id,{name:'Legacy name',updated:timestamp,deleted:0});assert.equal(legacy.folder.version,2);
 const staleAfterLegacy=await put(id,revised('Offline Web name',first.folder.version));assert.equal(staleAfterLegacy.status,409);assert.equal(staleAfterLegacy.folder.name,'Legacy name');
 const staleLegacy=await put(id,{name:'Old legacy name',updated:timestamp-1,deleted:0});assert.equal(staleLegacy.folder.version,2);assert.equal(staleLegacy.folder.name,'Legacy name');
 const duplicateLegacy=await put(id,{name:'Legacy name',updated:timestamp,deleted:0});assert.equal(duplicateLegacy.folder.version,2,'no-op legacy retries do not create conflicts');
 const legacyDelete=await put(id,{name:'Legacy name',updated:timestamp+1,deleted:1});assert.equal(legacyDelete.folder.version,3);assert.equal(legacyDelete.folder.deleted,1);

 // Existing folders without revision rows have always represented version 1.
 const oldId=crypto.randomUUID();sql.prepare('INSERT INTO folders(workspace,id,name,updated,deleted) VALUES(?,?,?,?,0)').run(workspace,oldId,'Before migration',1);
 const migrated=await put(oldId,{name:'Legacy edit after migration',updated:2});assert.equal(migrated.folder.version,2);
 const oldMcpId=crypto.randomUUID();sql.prepare('INSERT INTO folders(workspace,id,name,updated,deleted) VALUES(?,?,?,?,0)').run(workspace,oldMcpId,'Before migration',1);
 await folderTool(ctx,'folders_rename',{id:oldMcpId,name:'MCP edit after migration',updated:1});assert.equal((await read(oldMcpId)).version,2);
 const legacyCreated=await put(crypto.randomUUID(),{name:'New legacy folder',updated:1});assert.equal(legacyCreated.folder.version,1);
 console.log('PASS folder revisions: MCP and legacy writes invalidate stale device versions; rejected writes and no-op retries preserve revisions; migration fallback and revised replay remain compatible.');
}finally{sql.close();}
