import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {workspaceAuthorize} from '../mcp-oauth/src/workspace-consent.mjs';
import {requestedScopes} from '../mcp-oauth/src/requested-scopes.mjs';
import {ACCOUNT_COOKIE,createSession,session,csrf} from '../mcp-oauth/src/accounts.mjs';
import {createWorkspace,convertToShared} from '../worker/workspace-identity.mjs';
import {READ} from '../worker/mcp-common.mjs';

const sql=new DatabaseSync(':memory:');
for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','mcp-oauth/migrations/0003_passkeys.sql','mcp-oauth/migrations/0004_native_identity.sql','worker/migrations/0008-mcp-capabilities.sql','worker/migrations/0009-mcp-uploads.sql','worker/migrations/0010-workspace-identity.sql','worker/migrations/0011-oauth-workspaces.sql','worker/migrations/0012-account-approvals.sql','worker/migrations/0013-permanent-operations.sql','worker/migrations/0014-notifications-audit.sql'])sql.exec(readFileSync(file,'utf8'));
const DB={prepare(text){const q=sql.prepare(text);let params=[];return {bind(...p){params=p;return this},async first(){return q.get(...params)||null},async all(){return {results:q.all(...params)}},async run(){return q.run(...params)}}},async batch(statements){sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.all());sql.exec('COMMIT');return rows}catch(error){sql.exec('ROLLBACK');throw error}}};
const env={DB,WORKSPACE_IDENTITY_V2:'true'},origin='https://easybook.loonxy.com';
const alice={kind:'account',accountId:crypto.randomUUID()},bob={kind:'account',accountId:crypto.randomUUID()};
for(const a of [alice,bob])sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(a.accountId,'Synthetic',Date.now());
const personal=(await createWorkspace(env,'Managed',alice)).workspace.id,shared=(await createWorkspace(env,'Read-only',bob)).workspace.id;
await convertToShared(env,shared,bob,{confirm:true,firstAccountId:alice.accountId,role:'reader'});
const login=await createSession(new Request(origin),env,alice.accountId),cookie=ACCOUNT_COOKIE+'='+login.token;
let scopes=[],completed;
const auth=()=>({scope:scopes,state:'fixture',codeChallenge:'fixture',codeChallengeMethod:'S256',clientId:'fixture-client',redirectUri:'https://client.example/callback'});
env.OAUTH_PROVIDER={async parseAuthRequest(){return auth()},async lookupClient(){return {clientName:'Synthetic client'}},async beginConsent(){return {handle:'fixture',headers:new Headers()}},async approveConsent(){return {request:auth(),headers:new Headers()}},async completeAuthorization(value){completed=value;return {redirectTo:'https://client.example/callback?code=fixture'}}};
async function get() {return workspaceAuthorize(new Request(origin+'/oauth/authorize',{headers:{Cookie:cookie}}),env)}
async function post(workspace,selected) {
 const request=new Request(origin,{headers:{Cookie:cookie}}),s=await session(request,env);
 const form=new URLSearchParams({csrf:await csrf(request,s),handle:'fixture',decision:'allow',workspace,['workspace_scope_mode:'+workspace]:'explicit'});
 for(const scope of selected)form.append('workspace_scope:'+workspace,scope);
 return workspaceAuthorize(new Request(origin+'/oauth/authorize',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:form}),env);
}
assert.deepEqual(requestedScopes(['mcp:read']),READ);
assert.deepEqual(requestedScopes([]),['workspace.read']);
scopes=['mcp:read'];let response=await get(),html=await response.text();
assert.equal(response.status,200);assert.ok(html.includes('此客户端本次仅申请阅读权限'));
assert.ok(!html.includes('value="notes.write"'));
assert.equal((await post(personal,['notes.read','notes.write'])).status,400,'manager cannot grant unrequested write access');
scopes=['mcp:read','notes.write','attachments.write','workspace.write'];
response=await get();html=await response.text();assert.equal(response.status,200);
assert.ok(!html.includes('此客户端本次仅申请阅读权限'));
for(const scope of ['notes.write','attachments.write','workspace.write']){
 const input=html.match(new RegExp('<input[^>]+value="'+scope.replace('.','\\.')+'"[^>]*>'))?.[0];
 assert.ok(input,'explicit mixed-request scope remains visible: '+scope);assert.ok(!input.includes('checked'),'write scopes are opt-in');
}
assert.equal((await post(personal,['notes.read','notes.write','attachments.write','workspace.write'])).status,303);
assert.ok(completed.scope.includes('notes.write'));assert.ok(completed.scope.includes('attachments.write'));assert.ok(completed.scope.includes('workspace.write'));
assert.ok(!completed.scope.includes('notes.delete'),'unselected permissions are not granted');
const saved=JSON.parse(sql.prepare('SELECT scopes FROM oauth_grants WHERE id=?').get(completed.props.policyId).scopes);
assert.deepEqual(saved,completed.scope,'persisted grant and issued authorization agree');
assert.equal((await post(shared,['notes.read','notes.write','workspace.write'])).status,303);
assert.deepEqual(completed.scope,['notes.read'],'reader role still caps mixed-request scopes');
scopes=['notes.write'];assert.equal((await post(personal,['notes.write'])).status,303);assert.deepEqual(completed.scope,['notes.write']);
scopes=[];html=await (await get()).text();assert.ok(html.includes('此客户端本次仅申请阅读权限'));assert.ok(html.includes('value="workspace.read"'));assert.ok(!html.includes('value="notes.write"'));
scopes=['mcp:read','account.admin'];assert.equal((await get()).status,400);
sql.close();
console.log('PASS OAuth consent: mixed legacy/read plus explicit write scopes persist and issue correctly; writes remain opt-in; manager cannot add unrequested scopes; reader cannot gain writes; read-only explanation, empty/unknown scopes and granular-only requests.');
