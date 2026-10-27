import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {prepare,verify} from './remote-restore-drill-worker.mjs';
const source=new DatabaseSync(':memory:'),security=new DatabaseSync(':memory:'),restored=new DatabaseSync(':memory:');
const files=['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','mcp-oauth/migrations/0004_native_identity.sql','worker/migrations/0008-mcp-capabilities.sql','worker/migrations/0009-mcp-uploads.sql','worker/migrations/0010-workspace-identity.sql','worker/migrations/0011-oauth-workspaces.sql','worker/migrations/0012-account-approvals.sql','worker/migrations/0013-permanent-operations.sql','worker/migrations/0014-notifications-audit.sql','worker/migrations/0015-restore-state.sql','worker/migrations/0016-account-deletion.sql'];
for(const file of files)source.exec(readFileSync(file,'utf8'));
security.exec(readFileSync('worker/security-migrations/0001-checkpoint.sql','utf8'));
for(const db of [source,security])db.exec("CREATE TABLE drill_disposable_marker(id INTEGER PRIMARY KEY,marker TEXT);INSERT INTO drill_disposable_marker VALUES(1,'fixture');");
function adapter(db){return {prepare(text){const q=db.prepare(text);let p=[];return {bind(...args){p=args;return this},async first(){return q.get(...p)||null},async all(){return {results:q.all(...p)}},async run(){return q.run(...p)}}},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.all());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};}
const objects=new Map(),TEST_OBJECTS={async put(key,value){objects.set(key,Buffer.from(value));},async delete(key){objects.delete(key);},async get(key){const value=objects.get(key);return value?{size:value.length,body:new Blob([value]).stream(),async json(){return JSON.parse(value)},async arrayBuffer(){return Uint8Array.from(value).buffer}}:null}};
const env={SOURCE_DB:adapter(source),RESTORED_DB:adapter(restored),SECURITY_DB:adapter(security),TEST_OBJECTS,DRILL_MARKER:'fixture',DRILL_CONFIRMATION:'SYNTHETIC_ONLY'};
assert.equal((await prepare(env)).restoreGate,'blocked');
restored.exec(objects.get('old-business.sql').toString());
assert.equal((await verify(env)).status,'passed');assert.equal((await verify(env)).repeatedVerification,true);
for(const db of [source,security,restored])db.close();
console.log('PASS disposable remote-drill harness: old SQL restore, interrupted recovery gate, account/session/passkey/OAuth revocations, old key/member/manager/workspace quarantine, anonymous access, missing/corrupt R2 and repeated verification.');
