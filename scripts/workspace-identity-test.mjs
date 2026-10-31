import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import * as service from '../worker/workspace-identity.mjs';
import {hash,READ,WRITE} from '../worker/mcp-common.mjs';
import worker from '../worker/index.mjs';
import {workspaceAPI} from '../worker/workspace-api.mjs';
import {inspectLegacyWorkspaces,backfillLegacyWorkspaces} from '../worker/workspace-migration.mjs';

const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','worker/migrations/0010-workspace-identity.sql'])sqlite.exec(readFileSync(file,'utf8'));
sqlite.exec(readFileSync('worker/migrations/0010-workspace-identity.sql','utf8'));
let beforeBatch=null;
const DB={prepare(sql){const q=sqlite.prepare(sql);let params=[];return {
 bind(...args){params=args;return this},async first(){return q.get(...params)||null},
 async all(){return {results:q.all(...params)}},async run(){return q.run(...params)}
}},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=null;hook()}
 sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results}
 catch(e){sqlite.exec('ROLLBACK');throw e}
}};
const env={DB,TURNSTILE_SECRET:'test-secret',TURNSTILE_HOSTNAMES:'easybook.loonxy.com',TURNSTILE_VERIFY:{fetch:async()=>Response.json({success:true,action:'create_workspace',hostname:'easybook.loonxy.com'})}};
const account=id=>({kind:'account',accountId:id});
for(const id of ['alice','bob','carol'])sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(id,id,Date.now());
const alice=account('alice'),bob=account('bob'),carol=account('carol');
const reject=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
const role=async(id,p)=>(await service.workspaceAccess(env,id,p))?.role||null;
const w=await service.createWorkspace(env,'离线笔记');const id=w.workspace.id;
assert.match(w.key,/^[a-f0-9]{64}$/);assert.notEqual(id,await hash(w.key),'ID independent of credential');
assert.equal(sqlite.prepare('SELECT key_hash FROM workspace_keys').get().key_hash,await hash(w.key));
assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM workspace_keys').get()).includes(w.key));
const key=(await service.resolveWorkspaceKey(env,w.key)).principal;
assert.equal(await role(id,key),'manager');assert.equal(await role(id,alice),null);
await service.associateWorkspace(env,id,key,alice);
assert.equal(await role(id,alice),'manager');assert.equal(await role(id,key),'manager','account association preserves key');
await reject(()=>service.associateWorkspace(env,id,key,bob),'already_associated');
assert.equal((await service.listWorkspaces(env,alice)).length,1);
await service.createWorkspace(env,'另一工作区',alice);
assert.equal((await service.listWorkspaces(env,alice)).length,2);
const rotated=await service.rotateWorkspaceKey(env,id,alice);
assert.equal(await service.resolveWorkspaceKey(env,w.key,{allowLegacy:true}),null,'old key cannot resurrect through fallback');
const newKey=(await service.resolveWorkspaceKey(env,rotated.key)).principal;
assert.equal(await role(id,key),null);assert.equal(await role(id,newKey),'manager');
assert.equal(rotated.workspace.id,id);
await reject(()=>service.convertToShared(env,id,alice,{firstAccountId:'bob'}),'explicit_conversion_required');
await service.convertToShared(env,id,alice,{confirm:true,firstAccountId:'bob',role:'reader'});
assert.equal(await service.resolveWorkspaceKey(env,rotated.key,{allowLegacy:true}),null);
assert.equal(await role(id,bob),'reader');assert.equal(await role(id,alice),'manager');
assert.deepEqual(service.roleScopes('reader',[...READ,...WRITE]),READ);
assert.throws(()=>sqlite.prepare('INSERT INTO workspace_keys VALUES(?,?,?,NULL)').run('a'.repeat(64),id,Date.now()),/shared workspace/);
const policy=crypto.randomUUID();sqlite.prepare('INSERT INTO oauth_grants VALUES(?,?,?,?,?,?,NULL,NULL)').run(policy,'bob','client',id,JSON.stringify(WRITE),Date.now());
await service.setWorkspaceMember(env,id,alice,'bob','editor');
assert.equal(await role(id,bob),'editor');assert.ok(sqlite.prepare('SELECT revoked_at FROM oauth_grants WHERE id=?').get(policy).revoked_at);
await reject(()=>service.convertToPersonal(env,id,alice,{confirm:true}),'workspace_changed_retry');
assert.equal((await service.workspaceAccess(env,id,alice)).mode,'shared','failed conversion fully rolls back');
await service.transferWorkspaceManager(env,id,alice,'bob',{confirm:true});
assert.equal(await role(id,bob),'manager');assert.equal(await role(id,alice),'editor');
assert.equal(sqlite.prepare('SELECT manager_account_id FROM workspaces WHERE id=?').get(id).manager_account_id,'bob');
await reject(()=>service.setWorkspaceMember(env,id,alice,'carol','reader'),'manager_required');
await reject(()=>service.setWorkspaceMember(env,id,{kind:'oauth',accountId:'bob',scopes:WRITE},'carol','reader'),'account_security_operation_forbidden');
await service.setWorkspaceMember(env,id,bob,'alice',null);
assert.equal(await role(id,alice),null);assert.equal((await service.workspaceAccess(env,id,bob)).mode,'shared','does not auto-downgrade');
const downgraded=await service.convertToPersonal(env,id,bob,{confirm:true});
assert.equal(downgraded.workspace.id,id);assert.equal(await role(id,bob),'manager');
assert.ok(await service.resolveWorkspaceKey(env,downgraded.key));
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_keys WHERE workspace_id=? AND revoked_at IS NULL').get(id).n,1);
const legacy='f'.repeat(64),legacyId=await hash(legacy);
assert.equal(await service.resolveWorkspaceKey(env,legacy),null,'legacy creation explicitly opt in');
const imported=await service.resolveWorkspaceKey(env,legacy,{allowLegacy:true});assert.equal(imported.workspace.id,legacyId);
await service.rotateWorkspaceKey(env,legacyId,imported.principal);
assert.equal(await service.resolveWorkspaceKey(env,legacy,{allowLegacy:true}),null);
// Simulate a competing write between the preliminary permission read and batch.
beforeBatch=()=>sqlite.prepare('UPDATE workspaces SET version=version+1 WHERE id=?').run(id);
await reject(()=>service.rotateWorkspaceKey(env,id,bob),'workspace_changed_retry');
assert.ok(await service.resolveWorkspaceKey(env,downgraded.key),'failed concurrent rotation leaves prior key valid');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM workspace_tx_assertions').get().n,0);
sqlite.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').run(Date.now(),'bob');
assert.equal(await role(id,bob),null);assert.ok(await service.resolveWorkspaceKey(env,downgraded.key),'account and key authorizations independent');
assert.equal(await role(id,carol),null);
// Exercise the real HTTP principal boundary and sync entry point, not only the
// service helpers. No caller-supplied role/account can become an authority.
const origin='https://easybook.loonxy.com';
const token='c'.repeat(64),sessionId=crypto.randomUUID(),now=Date.now();
sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(sessionId,await hash(token),'carol',now,now+86400000,now,'Synthetic');
const cookies='__Host-easybook-session='+token;
const csrfToken=await hash(token+'|'+sessionId);
async function api(path,body,headers={}){return workspaceAPI(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
assert.equal((await api('/api/workspaces',{name:'匿名'})).status,403,'anonymous creation requires Turnstile');
const anonymous=await api('/api/workspaces',{name:'匿名',turnstileToken:'verified'});assert.equal(anonymous.status,201);
const fresh=await anonymous.json(),wid=fresh.workspace.id,base='/api/workspaces/'+wid;
assert.equal((await api(base,undefined,{Authorization:'Bearer '+fresh.key})).status,200);
assert.equal((await api(base+'/associate',{key:fresh.key},{Cookie:cookies,'X-Easybook-CSRF':csrfToken})).status,200);
assert.equal((await api(base+'/key',{confirm:true},{Cookie:cookies})).status,403,'CSRF required');
assert.equal((await api(base,undefined,{Authorization:'Bearer '+'0'.repeat(64),Cookie:cookies})).status,401,'bad explicit key cannot fall back to session');
assert.equal((await api(base,{name:'劫持'},{Cookie:cookies,'X-Easybook-CSRF':csrfToken,Origin:'https://evil.example'})).status,403);
assert.equal((await api(base+'/mode',{mode:'shared',confirm:true,firstAccountId:'alice',role:'reader'},{Cookie:cookies,'X-Easybook-CSRF':csrfToken})).status,200);
// This legacy reader-access fixture is seeded directly; the HTTP conversion
// itself no longer bypasses the new invitation acceptance requirement.
sqlite.prepare('INSERT INTO workspace_members(workspace_id,account_id,role,created_at) VALUES(?,?,?,?)').run(wid,'alice','reader',now);
assert.equal((await api(base,undefined,{Authorization:'Bearer '+fresh.key})).status,401);
const aliceToken='d'.repeat(64),aliceSession=crypto.randomUUID();
sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(aliceSession,await hash(aliceToken),'alice',now,now+86400000,now,'Synthetic reader');
const aliceHeaders={Cookie:'__Host-easybook-session='+aliceToken,'X-Easybook-Workspace':wid};
assert.equal((await worker.fetch(new Request(origin+'/api/folders',{headers:aliceHeaders}),{...env,WORKSPACE_IDENTITY_V2:'true'})).status,200);
assert.equal((await worker.fetch(new Request(origin+'/api/folders/'+crypto.randomUUID(),{method:'PUT',headers:{...aliceHeaders,Origin:origin,'X-Easybook-CSRF':await hash(aliceToken+'|'+aliceSession),'X-Role':'manager'},body:'{}'}),{...env,WORKSPACE_IDENTITY_V2:'true'})).status,403,'reader write denied despite forged role');
assert.equal((await worker.fetch(new Request(origin+'/api/folders',{headers:{...aliceHeaders,'X-Easybook-Workspace':id}}),{...env,WORKSPACE_IDENTITY_V2:'true'})).status,403,'other workspace denied');
assert.equal((await worker.fetch(new Request(origin+'/mcp'),{...env,WORKSPACE_IDENTITY_V2:'true'})).status,410,'legacy MCP bypass retired in new mode');
const memberPage=await api(base+'/members',undefined,aliceHeaders);assert.equal(memberPage.status,200);
assert.equal((await memberPage.json()).members.length,2);
assert.equal((await api(base+'/leave',{confirm:true},{Cookie:cookies,'X-Easybook-CSRF':csrfToken})).status,409,'manager must transfer first');
assert.equal((await api(base+'/leave',{confirm:true},aliceHeaders)).status,403,'leave requires CSRF');
assert.equal((await api(base+'/leave',{confirm:true},{...aliceHeaders,'X-Easybook-CSRF':await hash(aliceToken+'|'+aliceSession)})).status,200);
assert.equal((await api(base+'/members',undefined,aliceHeaders)).status,403,'former member cannot enumerate members');
assert.equal((await worker.fetch(new Request(origin+'/api/folders',{headers:aliceHeaders}),{...env,WORKSPACE_IDENTITY_V2:'true'})).status,403,'leave immediately closes content access');
const oldKey='e'.repeat(64),oldId=await hash(oldKey),folderId=crypto.randomUUID();
sqlite.prepare('INSERT INTO folders VALUES(?,?,?,?,?)').run(oldId,folderId,'迁移前文件夹',now,0);
const folderBefore=JSON.stringify(sqlite.prepare('SELECT * FROM folders').all());
assert.ok((await inspectLegacyWorkspaces(env)).workspaceIds.includes(oldId));
await assert.rejects(()=>backfillLegacyWorkspaces(env),/checkpoint/);
await backfillLegacyWorkspaces(env,{recoveryCheckpointVerified:true});
await backfillLegacyWorkspaces(env,{recoveryCheckpointVerified:true});
assert.ok(await service.resolveWorkspaceKey(env,oldKey));
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM folders').all()),folderBefore,'backfill preserves content byte for byte');
await service.rotateWorkspaceKey(env,oldId,(await service.resolveWorkspaceKey(env,oldKey)).principal);
await backfillLegacyWorkspaces(env,{recoveryCheckpointVerified:true});
assert.equal(await service.resolveWorkspaceKey(env,oldKey),null,'rerunning backfill does not revive old key');
console.log('PASS: retryable migration; independent ID/key; personal dual access; anti-hijack association; key tombstones; shared roles; explicit conversion; atomic manager transfer; OAuth security denial; revocation; stale-state rollback.');

