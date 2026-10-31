import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {aiAPI} from '../worker/ai.mjs';

const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','worker/migrations/0010-workspace-identity.sql','worker/migrations/0018-ai-credentials.sql'])sqlite.exec(readFileSync(file,'utf8'));
sqlite.exec(readFileSync('worker/migrations/0018-ai-credentials.sql','utf8'));
const DB={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}},async run(){return statement.run(...args)}}}};
const account='11111111-1111-4111-8111-111111111111',workspace='a'.repeat(64),now=Date.now();
sqlite.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').run(account,'AI test',now);
sqlite.prepare("INSERT INTO workspaces(id,name,mode,manager_account_id,created_at) VALUES(?,?,'personal',?,?)").run(workspace,'AI workspace',account,now);
const env={DB,AI_CREDENTIAL_KEY:Buffer.alloc(32,7).toString('base64')},principal={kind:'account',accountId:account,authenticatedAt:now};
const request=(path,method='GET',body)=>new Request('https://easybook.test'+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});

const secret='sk-test-this-value-must-never-be-returned';
let result=await aiAPI(request('/api/ai/config','PUT',{provider:'openai',model:'gpt-4.1-mini',apiKey:secret}),env,principal);
assert.equal(result.status,200);assert.equal((await result.json()).configured,true);
const stored=sqlite.prepare('SELECT * FROM account_ai_credentials').get();assert.ok(!JSON.stringify(stored).includes(secret));assert.notEqual(stored.key_ciphertext,secret);
result=await aiAPI(request('/api/ai/config'),env,principal);const config=await result.json();assert.deepEqual({...config,updatedAt:0},{configured:true,provider:'openai',model:'gpt-4.1-mini',updatedAt:0});assert.ok(!JSON.stringify(config).includes('sk-test'));

let authorization='';
const fetcher=async(_url,init)=>{authorization=init.headers.Authorization;return Response.json({choices:[{message:{role:'assistant',content:'已读取当前工作区。'}}]})};
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'概览当前工作区'}]}),env,principal,{workspaceId:workspace,fetcher});
assert.equal(result.status,200);const chat=await result.json();assert.equal(chat.message.content,'已读取当前工作区。');assert.equal(authorization,'Bearer '+secret);assert.ok(!JSON.stringify(chat).includes(secret));

result=await aiAPI(request('/api/ai/config','DELETE'),env,{...principal,authenticatedAt:0});assert.equal(result.status,403);assert.equal((await result.json()).error,'reauthentication_required');
result=await aiAPI(request('/api/ai/config','DELETE'),env,principal);assert.equal(result.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM account_ai_credentials').get().n,0);
for(const value of ['07'.repeat(32),'12345678901234567890123456789012','random-secret-material-'.repeat(12).slice(0,256)]){env.AI_CREDENTIAL_KEY=value;result=await aiAPI(request('/api/ai/config','PUT',{provider:'openai',model:'gpt-4.1-mini',apiKey:secret}),env,principal);assert.equal(result.status,200);await env.DB.prepare('DELETE FROM account_ai_credentials').run()}
sqlite.close();console.log('PASS BYOK encryption, account sync metadata, workspace authorization and provider isolation');

