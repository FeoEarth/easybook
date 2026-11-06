import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {aiAPI} from '../worker/ai.mjs';
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','worker/migrations/0010-workspace-identity.sql'])sqlite.exec(readFileSync(file,'utf8'));
const DB={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}},async run(){return statement.run(...args)}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const migration=readFileSync('worker/migrations/0021-ai-profiles.sql','utf8');sqlite.exec(migration);sqlite.exec(migration);const account='11111111-1111-4111-8111-111111111111',workspace='a'.repeat(64),now=Date.now();sqlite.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').run(account,'AI test',now);sqlite.prepare("INSERT INTO workspaces(id,name,mode,manager_account_id,created_at) VALUES(?,?,'personal',?,?)").run(workspace,'AI workspace',account,now);
const env={DB,AI_CREDENTIAL_KEY:Buffer.alloc(32,7).toString('base64')},principal={kind:'account',accountId:account,authenticatedAt:now},secret='sk-test-this-value-must-never-be-returned';const request=(path,method='GET',body)=>new Request('https://easybook.test'+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
let result=await aiAPI(request('/api/ai/config','PUT',{label:'Primary',provider:'openai',model:'gpt-4.1-mini',apiKey:secret}),env,principal);assert.equal(result.status,200);let saved=await result.json(),openaiId=saved.id;assert.equal(saved.configured,true);let stored=sqlite.prepare('SELECT * FROM account_ai_profiles WHERE id=?').get(openaiId);assert.ok(!JSON.stringify(stored).includes(secret));assert.notEqual(stored.key_ciphertext,secret);
result=await aiAPI(request('/api/ai/config'),env,principal);let config=await result.json();assert.equal(config.profiles.length,1);assert.equal(config.activeId,openaiId);assert.equal(config.profiles[0].provider,'openai');assert.ok(!JSON.stringify(config).includes(secret));
const ciphertext=stored.key_ciphertext;result=await aiAPI(request('/api/ai/config','PUT',{credentialId:openaiId,label:'Primary renamed',provider:'openai',model:'gpt-4.1'}),env,{...principal,authenticatedAt:0});assert.equal(result.status,200,'metadata-only Android edits do not require fresh authentication');stored=sqlite.prepare('SELECT * FROM account_ai_profiles WHERE id=?').get(openaiId);assert.equal(stored.key_ciphertext,ciphertext);assert.equal(stored.label,'Primary renamed');result=await aiAPI(request('/api/ai/config','PUT',{credentialId:openaiId,label:'Unsafe retarget',provider:'custom',providerName:'Other',baseUrl:'https://other.example/v1',model:'model',apiKey:''}),env,{...principal,authenticatedAt:0});assert.equal(result.status,403,'changing the secret destination still requires fresh authentication');
let authorization='',upstreamUrl='',redirect='',upstreamBody,upstreamHeaders;const fetcher=async(url,init={})=>{upstreamUrl=url;authorization=init.headers?.Authorization;redirect=init.redirect;upstreamBody=init.body&&JSON.parse(init.body);upstreamHeaders=init.headers;if(url.endsWith('/models'))return Response.json({data:[{id:'gpt-4.1-mini'},{id:'gpt-4.1'}]});return Response.json({choices:[{message:{role:'assistant',content:'已读取当前工作区。'}}]})};
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'概览当前工作区'}]}),env,principal,{workspaceId:workspace,fetcher});assert.equal(result.status,200);assert.equal((await result.json()).message.content,'已读取当前工作区。');assert.equal(authorization,'Bearer '+secret);assert.equal(upstreamUrl,'https://api.openai.com/v1/chat/completions');assert.equal(redirect,'manual');result=await aiAPI(request('/api/ai/models?credentialId='+openaiId),env,principal,{fetcher});assert.deepEqual((await result.json()).models,['gpt-4.1','gpt-4.1-mini']);
result=await aiAPI(request('/api/ai/config','PUT',{label:'Claude',provider:'anthropic',model:'claude-sonnet-4-5',apiKey:secret}),env,principal);assert.equal(result.status,200);const anthropicId=(await result.json()).id;const anthropicFetcher=async(url,init)=>{upstreamUrl=url;upstreamBody=JSON.parse(init.body);upstreamHeaders=init.headers;return Response.json({content:[{type:'text',text:'Anthropic 正常'}]})};result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'测试 Anthropic'}]}),env,principal,{workspaceId:workspace,fetcher:anthropicFetcher});assert.equal(result.status,200);assert.equal((await result.json()).message.content,'Anthropic 正常');assert.equal(upstreamUrl,'https://api.anthropic.com/v1/messages');assert.equal(upstreamHeaders['x-api-key'],secret);assert.equal(upstreamBody.model,'claude-sonnet-4-5');assert.ok(Array.isArray(upstreamBody.tools));
const aiImage={type:'image',name:'photo.jpg',mime:'image/jpeg',data:Buffer.from('demo-image-content').toString('base64')};
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'这张图片是什么？'}],attachments:[aiImage]}),env,principal,{workspaceId:workspace,fetcher:anthropicFetcher});
assert.equal(result.status,200);assert.equal(upstreamBody.messages.at(-1).content[1].type,'image');assert.equal(upstreamBody.messages.at(-1).content[1].source.media_type,'image/jpeg');
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'总结附件'}],attachments:[{type:'text',name:'notes.md',text:'# Hello'}]}),env,principal,{workspaceId:workspace,fetcher:anthropicFetcher});
assert.equal(result.status,200);assert.match(upstreamBody.messages.at(-1).content,/Hello/);
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'bad'}],attachments:[{type:'image',name:'evil.svg',mime:'image/svg+xml',data:'YWJj'}]}),env,principal,{workspaceId:workspace,fetcher:anthropicFetcher});
assert.equal(result.status,400,'Unsupported attachment MIME is rejected');
result=await aiAPI(request('/api/ai/select','POST',{credentialId:openaiId}),env,principal);assert.equal(result.status,200);result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'Describe the photo'}],attachments:[aiImage]}),env,principal,{workspaceId:workspace,fetcher});
assert.equal(result.status,200);assert.equal(upstreamBody.messages.at(-1).content[1].type,'image_url');assert.ok(upstreamBody.messages.at(-1).content[1].image_url.url.startsWith('data:image/jpeg;base64,'));
config=await (await aiAPI(request('/api/ai/config'),env,principal)).json();assert.equal(config.activeId,openaiId);assert.equal(config.profiles.length,2);for(const [provider,base] of [['gemini','https://generativelanguage.googleapis.com/v1beta/openai'],['deepseek','https://api.deepseek.com'],['kimi','https://api.moonshot.cn/v1']]){result=await aiAPI(request('/api/ai/config','PUT',{label:provider,provider,model:'model-test',apiKey:secret}),env,principal);assert.equal(result.status,200);assert.equal((await result.json()).baseUrl,base)}
for(const baseUrl of ['http://ai.example.net/v1','https://127.0.0.1/v1','https://localhost/v1','https://user:pass@ai.example.net/v1','https://ai.example.net:8443/v1']){result=await aiAPI(request('/api/ai/config','PUT',{provider:'custom',providerName:'Unsafe',baseUrl,model:'example-chat',apiKey:secret}),env,principal);assert.equal(result.status,400);assert.equal((await result.json()).error,'invalid_provider_url')}
result=await aiAPI(request('/api/ai/config','DELETE',{credentialId:anthropicId}),env,{...principal,authenticatedAt:0});assert.equal(result.status,403);result=await aiAPI(request('/api/ai/config','DELETE',{credentialId:anthropicId}),env,principal);assert.equal(result.status,200);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM account_ai_profiles WHERE id=?').get(anthropicId).n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM account_ai_profiles').get().n,4);
const agentTools=[];
const agentFetcher=async(url,init={})=>{
 const body=JSON.parse(init.body||'{}');
 agentTools.push((body.tools||[]).map(tool=>tool.function?.name));
 if(!(body.tools||[]).some(tool=>tool.function?.name==='notes_create'))return Response.json({choices:[{message:{role:'assistant',content:'对话模式只读'}}]});
 return Response.json({choices:[{message:{role:'assistant',content:'',tool_calls:[{id:'call-create-1',type:'function',function:{name:'notes_create',arguments:JSON.stringify({title:'AI approval test',text:'Pending confirmation'})}}]}}]});
};
result=await aiAPI(request('/api/ai/chat','POST',{mode:'conversation',messages:[{role:'user',content:'创建测试笔记'}]}),env,principal,{workspaceId:workspace,fetcher:agentFetcher});
assert.equal(result.status,200);assert.ok(!agentTools.at(-1).includes('notes_create'),'Conversation never exposes writing tools');
result=await aiAPI(request('/api/ai/chat','POST',{mode:'agent',messages:[{role:'user',content:'创建测试笔记'}]}),env,principal,{workspaceId:workspace,fetcher:agentFetcher});
assert.equal(result.status,200);const proposal=await result.json();
assert.equal(proposal.approval.tool,'notes_create');assert.ok(agentTools.at(-1).includes('notes_create'),'Agent can propose writing tools');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ai_agent_approvals WHERE id=? AND consumed_at IS NULL').get(proposal.approval.id).n,1,'Writing requires approval');
result=await aiAPI(request('/api/ai/execute','POST',{approvalId:proposal.approval.id}),env,principal,{workspaceId:workspace});
assert.equal(result.status,200,'A valid single-use user approval is accepted');
result=await aiAPI(request('/api/ai/execute','POST',{approvalId:proposal.approval.id}),env,principal,{workspaceId:workspace});
assert.equal(result.status,409,'Approval cannot be replayed');
// BYOK streaming must remain opt-in, work across both provider wire formats,
// and preserve the same Agent confirmation boundary as JSON completions.
const sseBody=events=>new ReadableStream({start(controller){const bytes=new TextEncoder().encode(events);for(let offset=0;offset<bytes.length;offset+=17)controller.enqueue(bytes.slice(offset,offset+17));controller.close()}});
const streamResponse=events=>new Response(sseBody(events),{headers:{'Content-Type':'text/event-stream'}});
const readEvents=async response=>{assert.equal(response.headers.get('Content-Type')?.startsWith('text/event-stream'),true);const raw=await response.text();return [...raw.matchAll(/event: ([^\n]+)\ndata: ([^\n]+)\n\n/g)].map(([,type,data])=>({type,data:JSON.parse(data)}))};
await aiAPI(request('/api/ai/select','POST',{credentialId:openaiId}),env,principal);
let streamRequested=false;
const streamedOpenai=async(url,init)=>{streamRequested=JSON.parse(init.body).stream===true;return streamResponse('data: '+JSON.stringify({choices:[{delta:{content:'你好'}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{content:'，世界'}}]})+'\n\n'+'data: [DONE]\n\n')};
let streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'你好'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:streamedOpenai}));
assert.equal(streamRequested,true);assert.deepEqual(streamEvents.map(event=>event.type),['delta','delta','done']);assert.equal(streamEvents.at(-1).data.message.content,'你好，世界');
const streamedTool=async()=>streamResponse([
 {choices:[{delta:{tool_calls:[{index:0,id:'stream-create',function:{name:'notes_create',arguments:'{"title":"'}}]}}]},
 {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'审批测试"}'}}]}}]}
].map(item=>'data: '+JSON.stringify(item)+'\n\n').join('')+'data: [DONE]\n\n');
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{mode:'agent',messages:[{role:'user',content:'创建'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:streamedTool}));
assert.deepEqual(streamEvents.map(event=>event.type),['reset','tool_start','tool_end','done']);
assert.equal(streamEvents[1].data.name,'notes_create');assert.equal(streamEvents[2].data.status,'approval');
assert.equal(streamEvents.at(-1).data.approval.tool,'notes_create');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ai_agent_approvals WHERE id=? AND consumed_at IS NULL').get(streamEvents.at(-1).data.approval.id).n,1);
let readToolTurn=0;
const streamedReadTool=async()=>{
 if(readToolTurn++>0)return Response.json({choices:[{message:{role:'assistant',content:'检索结束'}}]});
 return streamResponse('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'read-1',function:{name:'notes_list',arguments:'{}'}}]}}]})+'\n\n'+'data: [DONE]\n\n');
};
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{mode:'conversation',messages:[{role:'user',content:'列出笔记'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:streamedReadTool}));
assert.deepEqual(streamEvents.map(event=>event.type),['reset','tool_start','tool_end','done']);
assert.equal(streamEvents[1].data.name,'notes_list');assert.equal(streamEvents[2].data.status,'done');
assert.equal(streamEvents.at(-1).data.message.content,'检索结束');
await aiAPI(request('/api/ai/config','PUT',{label:'Claude Stream',provider:'anthropic',model:'claude-test',apiKey:secret}),env,principal);
const streamedAnthropic=async(url,init)=>{assert.equal(JSON.parse(init.body).stream,true);return streamResponse('event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'逐字'}})+'\n\n'+'event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'输出'}})+'\n\n')};
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'测试'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:streamedAnthropic}));
assert.equal(streamEvents.at(-1).data.message.content,'逐字输出');
assert.deepEqual(streamEvents.map(event=>event.type),['delta','delta','done']);
const jsonFallback=async()=>Response.json({content:[{type:'text',text:'兼容非流式提供商'}]});
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'测试'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:jsonFallback}));
assert.equal(streamEvents.at(-1).data.message.content,'兼容非流式提供商');
sqlite.close();console.log('PASS multi-BYOK encryption, provider presets, model discovery, active switching, Anthropic protocol and workspace authorization');
