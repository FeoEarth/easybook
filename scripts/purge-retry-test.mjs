import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runAttachmentPurges} from '../worker/attachment-purge.mjs';
import {runWorkspacePurges} from '../worker/workspace-purge.mjs';
import {purgeRetryDelay} from '../worker/purge-retry.mjs';
import {createWorkspace} from '../worker/workspace-identity.mjs';
import {initializeCheckpoint,revokeExternally,beginSecurityRestore} from '../worker/security-checkpoint.mjs';
const sql=new DatabaseSync(':memory:'),security=new DatabaseSync(':memory:');
for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','mcp-oauth/migrations/0004_native_identity.sql','worker/migrations/0008-mcp-capabilities.sql','worker/migrations/0009-mcp-uploads.sql','worker/migrations/0010-workspace-identity.sql','worker/migrations/0011-oauth-workspaces.sql','worker/migrations/0012-account-approvals.sql','worker/migrations/0013-permanent-operations.sql','worker/migrations/0014-notifications-audit.sql','worker/migrations/0015-restore-state.sql','worker/migrations/0016-account-deletion.sql'])sql.exec(readFileSync(file,'utf8'));
security.exec(readFileSync('worker/security-migrations/0001-checkpoint.sql','utf8'));
function adapter(db){return {prepare(text){const q=db.prepare(text);let p=[];return {bind(...args){p=args;return this},async first(){return q.get(...p)||null},async all(){return {results:q.all(...p)}},async run(){return q.run(...p)}}},async batch(statements){db.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.all());db.exec('COMMIT');return rows}catch(e){db.exec('ROLLBACK');throw e}}};}
let clock=Date.now(),fail=true,calls=0;const realNow=Date.now;Date.now=()=>clock;
const objects=new Map(),deleted=[],env={DB:adapter(sql),SECURITY_DB:adapter(security),WORKSPACE_IDENTITY_V2:'true',ATTACHMENTS:{async list({prefix,cursor='',limit}){calls++;if(fail)throw Error('storage unavailable');const keys=[...objects.keys()].filter(k=>k.startsWith(prefix)&&k>cursor).sort(),page=keys.slice(0,limit);return {objects:page.map(key=>({key})),truncated:keys.length>limit,cursor:page.at(-1)}},async delete(keys){calls++;if(fail)throw Error('storage unavailable');for(const key of Array.isArray(keys)?keys:[keys]){objects.delete(key);deleted.push(key)}}}};
try{
const account=crypto.randomUUID();sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(account,'Synthetic purge fixture',clock);
const active=(await createWorkspace(env,'Active',{kind:'account',accountId:account})).workspace.id,removed=(await createWorkspace(env,'Removed',{kind:'account',accountId:account})).workspace.id;
await initializeCheckpoint(env);env.SECURITY_CHECKPOINT_V2='true';await revokeExternally(env,[['workspace',removed]]);sql.prepare('UPDATE workspaces SET deleted_at=? WHERE id=?').run(clock,removed);
const approval=crypto.randomUUID(),policy=crypto.randomUUID(),attachment='a'.repeat(64),attachmentJob=crypto.randomUUID(),workspaceJob=crypto.randomUUID();
sql.prepare('INSERT INTO oauth_grants(id,account_id,client_id,workspace_id,scopes,created_at) VALUES(?,?,?,?,?,?)').run(policy,account,'fixture',active,'[]',clock);
sql.prepare("INSERT INTO account_operation_approvals(id,account_id,policy_id,client_id,workspace_id,scope,tool,payload,payload_hash,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'completed')").run(approval,account,policy,'fixture',active,'attachments.write','attachments_permanent_delete','{}','hash',clock,clock);
sql.prepare('INSERT INTO attachment_tombstones VALUES(?,?,?,?)').run(active,attachment,approval,clock);
sql.prepare("INSERT INTO attachment_purge_jobs(id,approval_id,workspace,attachment,status,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)").run(attachmentJob,approval,active,attachment,clock,clock);
sql.prepare("INSERT INTO workspace_deletion_jobs(id,workspace_id,status,created_at,updated_at) VALUES(?,?,'queued',?,?)").run(workspaceJob,removed,clock,clock);
const jobs=[['attachment_purge_jobs',attachmentJob,runAttachmentPurges],['workspace_deletion_jobs',workspaceJob,runWorkspacePurges]],row=(table,id)=>sql.prepare('SELECT * FROM '+table+' WHERE id=?').get(id),noticeCount=()=>sql.prepare("SELECT count(*) n FROM account_notifications WHERE code='operation.cleanup_failed'").get().n;
// Each pass is subject to both the retry deadline and an atomic lease claim.
for(let n=1;n<=6;n++){
 for(const [table,id,run]of jobs){await run(env,1);const r=row(table,id);assert.equal(r.attempts,n);assert.equal(r.status,n>=5?'failed':'queued');assert.equal(r.lease,null);assert.equal(r.lease_until,clock+purgeRetryDelay(n-1));const before=calls;await run(env,1);assert.equal(calls,before,'backoff excludes premature attempts');}
 if(n>=5)assert.equal(noticeCount(),1,'continued outage does not duplicate critical failure notice');
 clock=Math.max(...jobs.map(([t,id])=>row(t,id).lease_until))+1;
}
for(const [table,id,run]of jobs){sql.prepare('UPDATE '+table+' SET lease=?,lease_until=? WHERE id=?').run('other-run',clock+120000,id);const before=calls;await run(env,1);assert.equal(calls,before,'live lease excludes another runner');sql.prepare('UPDATE '+table+' SET lease=NULL,lease_until=0 WHERE id=?').run(id);}
fail=false;const attachmentPrefix=active+'/'+attachment+'/',workspacePrefix=removed+'/';
objects.set(active+'/unrelated','keep');objects.set('f'.repeat(64)+'/fixture','keep');objects.set(active+'/'+attachment,'legacy');
for(let i=0;i<251;i++){const key=String(i).padStart(4,'0');objects.set(attachmentPrefix+key,'x');objects.set(workspacePrefix+key,'x');}
for(let i=0;i<3;i++)for(const [, ,run]of jobs)await run(env,1);
for(const [table,id]of jobs){const r=row(table,id);assert.equal(r.status,'complete');assert.equal(r.cursor,null);assert.equal(r.error,null);assert.equal(r.lease_until,0);assert.equal(r.attempts,6,'failure history remains inspectable');}
assert.equal(objects.size,2);assert.ok(objects.has(active+'/unrelated'));assert.ok(deleted.every(k=>k===active+'/'+attachment||k.startsWith(attachmentPrefix)||k.startsWith(workspacePrefix)));
assert.equal(noticeCount(),1);assert.equal(sql.prepare('SELECT count(*) n FROM attachment_tombstones').get().n,1);assert.equal(security.prepare("SELECT count(*) n FROM security_revocations WHERE subject=?").get(removed).n,1);
// An invalid fence is terminal and must never become eligible through the retry path.
for(const [table,id,run]of jobs){sql.prepare("UPDATE "+table+" SET status='failed',error='INVALID_FENCE',lease_until=0 WHERE id=?").run(id);const before=calls;await run(env,1);assert.equal(calls,before);sql.prepare("UPDATE "+table+" SET status='queued',error=NULL WHERE id=?").run(id);}
sql.prepare('UPDATE workspace_deletion_jobs SET workspace_id=? WHERE id=?').run(active,workspaceJob); // A live workspace has no deletion fence.
sql.prepare('UPDATE attachment_purge_jobs SET workspace=? WHERE id=?').run('not-a-workspace',attachmentJob);
for(const [table,id,run]of jobs){const before=calls;await run(env,1);assert.equal(calls,before,'fence is validated before touching R2');const r=row(table,id);assert.equal(r.error,'INVALID_FENCE');assert.equal(r.lease,null);}
assert.equal(purgeRetryDelay(99999),86400000,'retry delay is bounded at one day');await beginSecurityRestore(env);await assert.rejects(runAttachmentPurges(env),e=>e.code==='security_restore_locked');await assert.rejects(runWorkspacePurges(env),e=>e.code==='security_restore_locked');
console.log('PASS durable purge retries: six storage failures recover, exponential capped backoff, lease exclusion, one critical notice, paginated exact-namespace deletion, retained fences, invalid-fence denial and restore gates.');
}finally{Date.now=realNow;sql.close();security.close();}
