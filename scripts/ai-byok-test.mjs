import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {aiAPI,aiMcpOAuthPage} from '../worker/ai.mjs';
import {webSearchQuota} from '../worker/ai-web-search.mjs';
import {runParallelMcpSearch,parallelSearchResults} from '../worker/ai-parallel-search.mjs';
import worker from '../worker/index.mjs';
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['worker/schema.sql','mcp-oauth/migrations/0002_accounts.sql','worker/migrations/0010-workspace-identity.sql'])sqlite.exec(readFileSync(file,'utf8'));
sqlite.exec('CREATE TABLE IF NOT EXISTS account_memberships(account_id TEXT PRIMARY KEY,permanent INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL DEFAULT 0)');
const DB={prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return statement.get(...args)||null},async all(){return {results:statement.all(...args)}},async run(){return statement.run(...args)}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const migration=readFileSync('worker/migrations/0021-ai-profiles.sql','utf8');sqlite.exec(migration);sqlite.exec(migration);const account='11111111-1111-4111-8111-111111111111',workspace='a'.repeat(64),now=Date.now();sqlite.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').run(account,'AI test',now);sqlite.prepare("INSERT INTO workspaces(id,name,mode,manager_account_id,created_at) VALUES(?,?,'personal',?,?)").run(workspace,'AI workspace',account,now);
const env={DB,AI_CREDENTIAL_KEY:Buffer.alloc(32,7).toString('base64')},principal={kind:'account',accountId:account,authenticatedAt:now},secret='sk-test-this-value-must-never-be-returned';const request=(path,method='GET',body)=>new Request('https://easybook.test'+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
async function completeResearch(call,body,maxSegments=32){
 let data=await (await call(body)).json(),receipts=[...(data.webSearches||[])],used=[...(data.tools||[])],segments=0;
 while(data.continuationRequired&&data.agentRunId&&segments++<maxSegments){
  data=await (await call({purpose:'agent_run:'+data.agentRunId,stream:false})).json();
  receipts.push(...(data.webSearches||[]));
  used.push(...(data.tools||[]));
 }
 assert.ok(segments<maxSegments,'Research must finish without looping indefinitely');
 return {...data,...(receipts.length?{webSearches:receipts,webSearch:receipts.at(-1)}:{}),tools:used};
}

let result=await aiAPI(request('/api/ai/config','PUT',{label:'Primary',provider:'openai',model:'gpt-4.1-mini',apiKey:secret}),env,principal);assert.equal(result.status,200);let saved=await result.json(),openaiId=saved.id;assert.equal(saved.configured,true);let stored=sqlite.prepare('SELECT * FROM account_ai_profiles WHERE id=?').get(openaiId);assert.ok(!JSON.stringify(stored).includes(secret));assert.notEqual(stored.key_ciphertext,secret);
result=await aiAPI(request('/api/ai/config'),env,principal);let config=await result.json();assert.equal(config.profiles.length,1);assert.equal(config.activeId,openaiId);assert.equal(config.profiles[0].provider,'openai');assert.ok(!JSON.stringify(config).includes(secret));
const ciphertext=stored.key_ciphertext;result=await aiAPI(request('/api/ai/config','PUT',{credentialId:openaiId,label:'Primary renamed',provider:'openai',model:'gpt-4.1'}),env,{...principal,authenticatedAt:0});assert.equal(result.status,200,'metadata-only Android edits do not require fresh authentication');stored=sqlite.prepare('SELECT * FROM account_ai_profiles WHERE id=?').get(openaiId);assert.equal(stored.key_ciphertext,ciphertext);assert.equal(stored.label,'Primary renamed');result=await aiAPI(request('/api/ai/config','PUT',{credentialId:openaiId,label:'Unsafe retarget',provider:'custom',providerName:'Other',baseUrl:'https://other.example/v1',model:'model',apiKey:''}),env,{...principal,authenticatedAt:0});assert.equal(result.status,403,'changing the secret destination still requires fresh authentication');
let authorization='',upstreamUrl='',redirect='',upstreamBody,upstreamHeaders;const fetcher=async(url,init={})=>{upstreamUrl=url;authorization=init.headers?.Authorization;redirect=init.redirect;upstreamBody=init.body&&JSON.parse(init.body);upstreamHeaders=init.headers;if(url.endsWith('/models'))return Response.json({data:[{id:'gpt-4.1-mini'},{id:'gpt-4.1'}]});return Response.json({choices:[{message:{role:'assistant',content:'已读取当前工作区。'}}]})};
result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'概览当前工作区'}]}),env,principal,{workspaceId:workspace,fetcher});assert.equal(result.status,200);assert.equal((await result.json()).message.content,'已读取当前工作区。');assert.equal(authorization,'Bearer '+secret);assert.equal(upstreamUrl,'https://api.openai.com/v1/chat/completions');assert.equal(redirect,'manual');result=await aiAPI(request('/api/ai/models?credentialId='+openaiId),env,principal,{fetcher});assert.deepEqual((await result.json()).models,['gpt-4.1','gpt-4.1-mini']);
result=await aiAPI(request('/api/ai/config','PUT',{label:'Claude',provider:'anthropic',model:'claude-sonnet-4-5',apiKey:secret}),env,principal);assert.equal(result.status,200);const anthropicId=(await result.json()).id;const anthropicFetcher=async(url,init)=>{upstreamUrl=url;upstreamBody=JSON.parse(init.body);upstreamHeaders=init.headers;return Response.json({content:[{type:'text',text:'Anthropic 正常'}]})};result=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'测试 Anthropic'}]}),env,principal,{workspaceId:workspace,fetcher:anthropicFetcher});assert.equal(result.status,200);assert.equal((await result.json()).message.content,'Anthropic 正常');assert.equal(upstreamUrl,'https://api.anthropic.com/v1/messages');assert.equal(upstreamHeaders['x-api-key'],secret);assert.equal(upstreamBody.model,'claude-sonnet-4-5');assert.ok(Array.isArray(upstreamBody.tools));
// Title generation reuses the selected profile, never sends tools and stays bounded.
for(const [credentialId,protocol] of [[openaiId,'openai'],[anthropicId,'anthropic']]){
 let titleBody;
 const titleFetcher=async(url,init)=>{titleBody=JSON.parse(init.body);return protocol==='openai'?Response.json({choices:[{message:{role:'assistant',content:'“项目行动计划”'}}]}):Response.json({content:[{type:'text',text:'项目行动计划'}]})};
 const titled=await aiAPI(request('/api/ai/chat','POST',{purpose:'title',mode:'agent',credentialId,model:'title-model',messages:[{role:'user',content:'创建工作计划并执行工具'}]}),env,principal,{workspaceId:workspace,fetcher:titleFetcher});
 assert.equal(titled.status,200);assert.equal((await titled.json()).title,'项目行动计划');
 assert.equal(titleBody.tools,undefined);assert.equal(titleBody.tool_choice,undefined);assert.equal(titleBody.model,'title-model');
 assert.equal(titleBody.max_tokens||titleBody.max_completion_tokens,128);
}
const tooLongTitle=await aiAPI(request('/api/ai/chat','POST',{purpose:'title',messages:[{role:'user',content:'x'.repeat(6001)}]}),env,principal,{workspaceId:workspace,fetcher:()=>{throw Error('Must not contact provider')}});
assert.equal(tooLongTitle.status,400);
// A long chat reaches the provider, while transport and provider limits are actionable.
const longMessages=Array.from({length:80},(_,i)=>({role:i%2?'assistant':'user',content:'reading '.repeat(3000)}));
const longReply=await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,messages:longMessages}),env,principal,{workspaceId:workspace,fetcher});
assert.equal(longReply.status,200);
assert.deepEqual(upstreamBody.messages.slice(1),longMessages);
const neverFetch=()=>{throw Error('Must not contact provider')};
const oversizedChat=await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,messages:[{role:'user',content:'x'.repeat(4200001)}]}),env,principal,{workspaceId:workspace,fetcher:neverFetch});
assert.equal(oversizedChat.status,413);assert.deepEqual(await oversizedChat.json(),{error:'messages_too_large'});
const providerLimit=await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,messages:[{role:'user',content:'question'}]}),env,principal,{workspaceId:workspace,fetcher:async()=>Response.json({error:{code:'context_length_exceeded'}},{status:400})});
assert.equal(providerLimit.status,413);assert.deepEqual(await providerLimit.json(),{error:'context_length_exceeded'});
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
 // Disconnects must abort an outstanding model request without emitting to a
 // canceled SSE controller (previously a generic ai_unavailable TypeError).
 let startedBlockingFetch,wasCancelled=false;
 const blockingStarted=new Promise(resolve=>{startedBlockingFetch=resolve});
 const blockingFetcher=async(url,init)=>{
  startedBlockingFetch();
  return new Promise((resolve,reject)=>{
   const onAbort=()=>{wasCancelled=true;reject(init.signal.reason||new Error('aborted'))};
   if(init.signal.aborted)onAbort();
   else init.signal.addEventListener('abort',onAbort,{once:true});
  });
 };
 const cancellable=await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'disconnect test'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:blockingFetcher});
 await blockingStarted;
 await cancellable.body.cancel();
 assert.equal(wasCancelled,true,'Client cancellation aborts the active provider request');

const deepSeek=(await (await aiAPI(request('/api/ai/config','PUT',{label:'DeepSeek reasoning',provider:'deepseek',model:'deepseek-reasoner',apiKey:secret}),env,principal)).json()).id;
const modelFrames=items=>streamResponse(items.map(item=>'data: '+JSON.stringify(item)+'\n\n').join(''));
let reasoningRound=0;
const reasoningFetcher=async(url,init)=>{
 assert.equal(url,'https://api.deepseek.com/chat/completions');
 const payload=JSON.parse(init.body);
 if(reasoningRound++===0)return modelFrames([
  {choices:[{delta:{reasoning_content:'先查找笔记'}}]},
  {choices:[{delta:{tool_calls:[{index:0,id:'reasoning-read',function:{name:'notes_list',arguments:'{}'}}]}}]}
 ]);
 assert.equal(payload.messages.at(-2).reasoning_content,'先查找笔记');
 assert.equal(payload.messages.at(-1).role,'tool');
 return modelFrames([
  {choices:[{delta:{reasoning_content:'整理已找到的笔记'}}]},
  {choices:[{delta:{content:'这是最终答复。'}}]}
 ]);
};
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{credentialId:deepSeek,messages:[{role:'user',content:'汇总'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:reasoningFetcher}));
assert.deepEqual(streamEvents.map(event=>event.type),['reasoning','reset','tool_start','tool_end','reasoning','delta','done']);
assert.deepEqual(streamEvents.at(-1).data.message,{role:'assistant',content:'这是最终答复。',reasoning:'先查找笔记\n\n整理已找到的笔记'});
await aiAPI(request('/api/ai/select','POST',{credentialId:openaiId}),env,principal);
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
const jsonFallback=async()=>Response.json({content:[{type:'thinking',thinking:'供应商提供的摘要',signature:'internal-signature'},{type:'redacted_thinking',data:'opaque'},{type:'text',text:'兼容非流式提供商'}]});
streamEvents=await readEvents(await aiAPI(request('/api/ai/chat','POST',{messages:[{role:'user',content:'测试'}],stream:true}),env,principal,{workspaceId:workspace,fetcher:jsonFallback}));
assert.equal(streamEvents.at(-1).data.message.content,'兼容非流式提供商');
assert.deepEqual(streamEvents.map(event=>event.type),['reasoning','done']);
assert.equal(streamEvents.at(-1).data.message.reasoning,'供应商提供的摘要');
assert.ok(!JSON.stringify(streamEvents).includes('internal-signature'));
// One credential owns multiple models; per-chat selection never edits account defaults.
const catalogSaved=await aiAPI(request('/api/ai/config','PUT',{credentialId:openaiId,label:'Multiple models',provider:'openai',model:'gpt-4.1',models:['gpt-4.1','vendor/reasoning-model']}),env,principal);
assert.equal(catalogSaved.status,200);assert.deepEqual((await catalogSaved.json()).models,['gpt-4.1','vendor/reasoning-model']);
const beforeSelection=sqlite.prepare('SELECT model,active FROM account_ai_profiles WHERE id=?').get(openaiId);
let selectedModel;
const selectedReply=await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,model:'vendor/reasoning-model',messages:[{role:'user',content:'测试独立选模'}]}),env,principal,{workspaceId:workspace,fetcher:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');selectedModel=JSON.parse(init.body).model;return Response.json({choices:[{message:{role:'assistant',content:'正常'}}]})}});
assert.equal(selectedReply.status,200);assert.equal(selectedModel,'vendor/reasoning-model');assert.deepEqual(sqlite.prepare('SELECT model,active FROM account_ai_profiles WHERE id=?').get(openaiId),beforeSelection);
let discoveryCalls=0;const discover=async()=>{discoveryCalls++;return Response.json({data:[{id:'vendor/discovered-model'},{id:'vendor/discovered-model'},{id:'bad id'}]})};
const catalogRequest=()=>aiAPI(request('/api/ai/models?credentialId='+openaiId),env,principal,{fetcher:discover});
let discovered=await (await catalogRequest()).json();assert.ok(discovered.models.includes('vendor/discovered-model'));assert.ok(discovered.models.includes('vendor/reasoning-model'));
await catalogRequest();assert.equal(discoveryCalls,1,'Discovery is cached per profile');
await aiAPI(request('/api/ai/models?credentialId='+openaiId+'&refresh=1'),env,principal,{fetcher:discover});assert.equal(discoveryCalls,2,'Explicit refresh bypasses cache');
const invalidSelection=await aiAPI(request('/api/ai/chat','POST',{credentialId:'foreign-account-profile',model:'vendor/reasoning-model',messages:[{role:'user',content:'不可用配置'}]}),env,principal,{workspaceId:workspace,fetcher:()=>{throw Error('Must not call provider')}});assert.equal(invalidSelection.status,409);
const autoSaved=await aiAPI(request('/api/ai/config','PUT',{label:'Auto-detected API',provider:'custom',providerName:'Test gateway',baseUrl:'https://gateway.example/v1',apiKey:secret,model:''}),env,principal,{fetcher:async()=>Response.json({data:[{id:'vendor/fast'},{id:'vendor/reasoning'}]})});
assert.equal(autoSaved.status,200);const automatic=await autoSaved.json();assert.equal(automatic.model,'vendor/fast');assert.equal(automatic.models.length,2);
const defaultless=await aiAPI(request('/api/ai/config','PUT',{label:'Manual API',provider:'custom',providerName:'No models',baseUrl:'https://gateway.example/v1',apiKey:secret,model:''}),env,principal,{fetcher:async()=>new Response('',{status:404})});assert.equal(defaultless.status,400);assert.equal((await defaultless.json()).error,'model_required');
// Account preferences synchronize independently of provider credentials and use CAS.
let prefs=await (await aiAPI(request('/api/ai/preferences'),env,principal)).json();assert.equal(prefs.version,0);
const otherAccount='22222222-2222-4222-8222-222222222222';sqlite.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').run(otherAccount,'Other',now);
const prefRequest=body=>aiAPI(request('/api/ai/preferences','PUT',body),env,principal);
prefs=await (await prefRequest({...prefs,instructions:'默认先给结论',memories:[{id:'memory1',text:'偏好中文简洁回复',source:'manual'}]})).json();assert.equal(prefs.version,1);
assert.equal((await prefRequest({...prefs,version:0,instructions:'stale overwrite'})).status,409);
assert.equal((await (await aiAPI(request('/api/ai/preferences'),env,{...principal,accountId:otherAccount})).json()).memories.length,0,'Memory is private to the account');
let preferencePrompt='';
result=await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,messages:[{role:'user',content:'介绍一下'}]}),env,principal,{workspaceId:workspace,fetcher:async(url,init)=>{const b=JSON.parse(init.body);preferencePrompt=b.messages[0].content;return Response.json({choices:[{message:{content:'好'}}]})}});
assert.equal(result.status,200);assert.match(preferencePrompt,/默认先给结论/);assert.match(preferencePrompt,/偏好中文简洁回复/);assert.match(preferencePrompt,/当前 UTC 时间：\d{4}-\d{2}-\d{2}T[\d:.]+Z/);assert.match(preferencePrompt,/当前工作区角色：工作区管理员/);
let memoryCalls=0;
const extract=()=>aiAPI(request('/api/ai/chat','POST',{purpose:'memory',credentialId:openaiId,messages:[{role:'user',content:'以后请用中文回答我'}]}),env,principal,{workspaceId:workspace,fetcher:async(url,init)=>{memoryCalls++;const b=JSON.parse(init.body);assert.equal(b.tools,undefined,'Memory extraction has no workspace tools');assert.equal(b.max_completion_tokens,512);return Response.json({choices:[{message:{content:'["偏好中文回答","sk-sensitiveabcdefghijklmnop"]'}}]})}});
assert.deepEqual((await (await extract()).json()).memories,['偏好中文回答']);
// Deleting from another device makes an in-flight memory save stale.
const oldVersion=prefs.version;
prefs=await (await prefRequest({...prefs,memories:[],autoMemory:false,useMemory:false})).json();
assert.equal((await prefRequest({...prefs,version:oldVersion,memories:[{id:'late',text:'deleted memory'}]})).status,409);
assert.deepEqual((await (await extract()).json()).memories,[]);assert.equal(memoryCalls,1,'Disabled automatic memory makes no provider request');
assert.equal((await aiAPI(request('/api/ai/preferences'),env,{kind:'anonymous'})).status,403);

// UTC calendar months roll over at midnight on the first, not at a rolling 30-day mark.
const monthEnd=Date.UTC(2026,10,30,23,59,59),monthStart=Date.UTC(2026,11,1);
const nov=webSearchQuota(monthEnd,{permanent:0,expires_at:monthStart+86400000});
const dec=webSearchQuota(monthStart,{permanent:0,expires_at:monthStart+86400000});
assert.equal(nov.kind,'member');assert.equal(nov.limit,1000);assert.equal(nov.period,'2026-11');assert.equal(nov.expiresAt,monthStart);
assert.equal(dec.period,'2026-12');assert.notEqual(nov.period,dec.period);
assert.equal(webSearchQuota(monthStart,null).limit,15);
assert.equal(webSearchQuota(monthStart,{expires_at:monthStart}).kind,'free','Expiry at the boundary is not active');
assert.equal(webSearchQuota(monthStart,{permanent:1,expires_at:0}).kind,'member');

// DuckDuckGo can expand multiple batches without another model call or quota
// charge, rather than silently treating the first visible page as all results.
{
 const {expandDuckDuckGoResults,WEB_SEARCH_MAX_RESULTS}=await import('../worker/ai-web-search.mjs');
 let count=2,clicks=0;
 const page={
  async evaluate(fn,args){
   if(!args){clicks++;return true}
   return {status:'results',entries:Array.from({length:count},(_,i)=>({url:'https://example.org/page-'+i,title:'Document '+i,description:'Relevant excerpt'}))};
  },
  async waitForFunction(){count+=9}
 };
 const initial={status:'results',raw:count,results:[{url:'https://example.org/page-0',title:'Document 0'},{url:'https://example.org/page-1',title:'Document 1'}]};
 const expanded=await expandDuckDuckGoResults(page,initial,WEB_SEARCH_MAX_RESULTS,new AbortController().signal,Date.now()+10000);
 assert.equal(expanded.loads,3);
 assert.equal(clicks,3);
 assert.equal(expanded.results.length,29,'Search more than 10 entries by loading additional batches');
}

// The search plugin shares the approval flow and works independently of third-party MCP.
{
 let searches=0,closed=0,contextsOpened=0,contextsClosed=0,exposed=false,primary='blocked',backup='no_results',query='current public docs';
 const visits=[],profiles=[];
 const binding={},searchEnv={...env,WEB_SEARCH_BROWSER:binding};
 const launchSearchBrowser=async actual=>{
  assert.equal(actual,binding);
  searches++;
  return {
   async close(){closed++},
   async version(){return 'HeadlessChrome/144.0.7339.0'},
   async createBrowserContext(){
    contextsOpened++;
    const browser=this;
    return {newPage:()=>browser.newPage(),async close(){contextsClosed++}};
   },
   async newPage(){
    let address,site,phase,onRequest;
    return {
     async createCDPSession(){return {async send(method,params){profiles.push({method,params})}}},
     async setRequestInterception(enabled){assert.equal(enabled,true)},
     on(event,handler){assert.equal(event,'request');onRequest=handler},
     async goto(url,options){
      address=url;
      const target=new URL(url);
      site=target.hostname==='wiby.me'?'wiby':'duckduckgo';visits.push(site);
      const continued=[],blocked=[];
      for(const address of [target.origin+'/search-font.woff2','https://example.com/track']){
       onRequest({url:()=>address,resourceType:()=>address.endsWith('.woff2')?'font':'fetch',
        async continue(){continued.push(address)},async abort(){blocked.push(address)}});
      }
      assert.deepEqual(continued,[target.origin+'/search-font.woff2']);
      assert.deepEqual(blocked,['https://example.com/track']);
      assert.equal(target.searchParams.get('q'),query);
      assert.equal(options.waitUntil,'domcontentloaded');
      phase=site==='wiby'?backup:primary;
      if(phase==='timeout')throw Object.assign(Error('navigation timeout'),{name:'TimeoutError'});
      return {ok:()=>true,status:()=>phase==='blocked'?202:200};
     },
     url:()=>address,
     async waitForSelector(selector){assert.match(selector,/result|tlink/)},
     async evaluate(){return {status:phase,entries:phase==='results'?[{
      url:'https://example.com/docs',title:site==='wiby'?'Public docs':'Docs',description:'Search snippet'
     }]:[]}}
    };
   }
  };
 };
 const modelFetcher=async(url,init)=>{
  assert.equal(new URL(url).hostname,'api.openai.com');
  const payload=JSON.parse(init.body);
  if(payload.messages.at(-1)?.role==='tool')return Response.json({choices:[{message:{role:'assistant',content:'已使用来源'}}]});
  exposed=payload.tools.some(tool=>tool.function.name==='web_search');
  return Response.json({choices:[{message:exposed?{role:'assistant',tool_calls:[{id:'search-call',type:'function',function:{name:'web_search',arguments:JSON.stringify({query})}}]}:{role:'assistant',content:'No web search'}}]});
 };
 const api=(path,method,body,p=principal)=>aiAPI(request('/api/ai/'+path,method,body),searchEnv,p,{workspaceId:workspace,fetcher:modelFetcher,launchSearchBrowser});
 const chat=async(mode='conversation')=>Response.json(await completeResearch(body=>api('chat','POST',body),{credentialId:openaiId,mode,messages:[{role:'user',content:'请联网搜索'}]}));
 const initialUsage=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(initialUsage.tier,'free');assert.equal(initialUsage.period,'day');
 assert.equal(initialUsage.limit,15);assert.equal(initialUsage.used,0);assert.equal(initialUsage.remaining,15);
 assert.ok(initialUsage.resetAt>Date.now());
 const builtins=await (await api('mcp','GET')).json();
 assert.deepEqual(builtins.webSearch,{available:true,enabled:false,approval:'ask'});
 assert.deepEqual({available:builtins.parallelSearch.available,enabled:builtins.parallelSearch.enabled,approval:builtins.parallelSearch.approval,url:builtins.parallelSearch.url,mode:builtins.parallelSearch.mode,connected:builtins.parallelSearch.connected},{available:true,enabled:true,approval:'ask',url:'https://mcp.parallel.ai/mcp',mode:'anonymous',connected:false});
 assert.equal((await api('mcp','PUT',{parallelSearch:false})).status,200,'Existing browser-only search behavior can be selected independently');
 await chat();assert.equal(exposed,false);
 assert.equal((await api('mcp','PUT',{webSearch:true})).status,200);
 assert.deepEqual((await (await api('mcp','GET',undefined,{...principal,accountId:otherAccount})).json()).webSearch,{available:true,enabled:false,approval:'ask'});
 await chat(null);assert.equal(exposed,false,'The note writing request does not expose an approval it cannot display');
 const proposal=(await (await chat()).json()).approval;
 assert.equal(proposal.tool,'web_search');assert.equal(searches,0);
 assert.equal((await api('execute','POST',{approvalId:proposal.id},{...principal,accountId:otherAccount})).status,403);
 const execution=await api('execute','POST',{approvalId:proposal.id});
 const failedSearch=await execution.json();
 assert.equal(failedSearch.ok,false);assert.equal(failedSearch.result.browserSearch,true);assert.equal(failedSearch.result.reason,'blocked');
 assert.deepEqual(visits.splice(0),['duckduckgo','wiby']);
 assert.equal(searches,1);assert.equal(closed,1,'Browser closes after an unsuccessful search');
 assert.equal((await api('execute','POST',{approvalId:proposal.id})).status,409);
 const pending=(await (await chat()).json()).approval;
 assert.equal((await api('mcp','PUT',{webSearch:false})).status,200);
 const revoked=await (await api('execute','POST',{approvalId:pending.id})).json();
 assert.equal(revoked.ok,false);
 assert.equal(revoked.error.code,'web_search_unavailable');
 assert.equal(searches,1);
 assert.equal((await api('mcp','PUT',{webSearch:true})).status,200);
 primary='results';
 const match=(await (await chat()).json()).approval;
 const matched=await (await api('execute','POST',{approvalId:match.id})).json();
 assert.equal(matched.ok,true);
 assert.equal(matched.tool,'web_search');
 assert.equal(matched.result.source,'duckduckgo');
 assert.deepEqual(matched.result.results[0],{url:'https://example.com/docs',title:'Docs',description:'Search snippet',source:'duckduckgo'});
 assert.equal(closed,2,'Browser closes after reading successful results');
 assert.deepEqual(visits.splice(0),['duckduckgo','wiby'],'When DuckDuckGo is short, the browser checks Wiby before returning');
 assert.deepEqual(profiles.slice(0,3).map(step=>step.method),['Emulation.setDeviceMetricsOverride','Emulation.setTouchEmulationEnabled','Emulation.setUserAgentOverride']);
 assert.match(profiles[2].params.userAgent,/Chrome\/144\.0\.7339\.0 Mobile/);
 assert.equal(profiles[2].params.userAgentMetadata.mobile,true);
 const searchOnce=async()=>{
  const approval=(await (await chat()).json()).approval;
  return (await api('execute','POST',{approvalId:approval.id})).json();
 };
 primary='timeout';backup='results';
 assert.equal((await searchOnce()).result.source,'wiby');
 assert.deepEqual(visits.splice(0),['duckduckgo','wiby']);
 primary='no_results';query='Cloudflare Workers documentation';
 assert.equal((await searchOnce()).result.reason,'no_results','Unrelated backup results are withheld');
 assert.deepEqual(visits.splice(0),['duckduckgo','wiby']);
 primary='parse_failed';query='人工智能';
 assert.equal((await searchOnce()).result.reason,'parse_failed');
 assert.deepEqual(visits.splice(0),['duckduckgo'],'Skip Wiby for non-English queries');
 assert.match(profiles.at(-1).params.acceptLanguage,/^zh-CN/);
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:%'").get().count,5,'One quota charge per approved query');
 const usedFive=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(usedFive.used,5);assert.equal(usedFive.remaining,10,'Reading usage must not deduct quota');
 assert.equal((await api('mcp','PUT',{webSearchApproval:'always'})).status,200);
 assert.equal((await (await api('mcp','GET')).json()).webSearch.approval,'always');
 assert.equal((await (await api('mcp','GET',undefined,{...principal,accountId:otherAccount})).json()).webSearch.approval,'ask');
 primary='results';
 const automatic=await (await chat()).json();
 assert.equal(automatic.approval,undefined);
 assert.equal(automatic.message.content,'已使用来源');
 assert.equal(automatic.webSearch.result.results[0].url,'https://example.com/docs');
 primary='blocked';query='人工智能';
 const handoff=await (await chat()).json();
 assert.equal(handoff.approval,undefined);
 assert.equal(handoff.webSearch.result.browserSearch,true);
 assert.equal(searches,7);
 const pendingWrite=await (await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,mode:'agent',messages:[{role:'user',content:'新建笔记'}]}),searchEnv,principal,{workspaceId:workspace,fetcher:async()=>Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'write',type:'function',function:{name:'notes_create',arguments:'{"title":"Safety check"}'}}]}}]})})).json();
 assert.equal(pendingWrite.approval.tool,'notes_create','Always allow does not authorize writes');
 assert.equal((await api('mcp','PUT',{webSearchApproval:'ask'})).status,200);
 assert.equal((await (await chat()).json()).approval.tool,'web_search');
 // Free users keep their existing daily bucket, but the limit is now 15.
 sqlite.prepare("UPDATE account_rate_limits SET count=15 WHERE bucket LIKE 'ai-web-search:%'").run();
 const fullFreeUsage=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(fullFreeUsage.used,15);assert.equal(fullFreeUsage.remaining,0);
 const capped=(await (await chat()).json()).approval;
 assert.equal((await (await api('execute','POST',{approvalId:capped.id})).json()).error.code,'web_search_limit');
 assert.equal(searches,7,'Free daily quota is enforced before launching the browser');

 // A newly active subscriber gets a distinct calendar-month quota and NO daily cap.
 sqlite.prepare('INSERT INTO account_memberships(account_id,permanent,expires_at) VALUES(?,?,?)').run(account,0,Date.now()+86400000);
 primary='results';
 assert.equal((await searchOnce()).result.source,'duckduckgo');
 assert.equal(searches,8,'Membership bypasses an exhausted daily quota');
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count,1);
 const memberUsage=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(memberUsage.tier,'member');assert.equal(memberUsage.period,'month');
 assert.equal(memberUsage.limit,1000);assert.equal(memberUsage.used,1);assert.equal(memberUsage.remaining,999);
 sqlite.prepare("UPDATE account_rate_limits SET count=999 WHERE bucket LIKE 'ai-web-search:month:%'").run();
 assert.equal((await searchOnce()).result.source,'duckduckgo','The 1000th monthly search is allowed');
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count,1000);
 const memberFull=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(memberFull.used,1000);assert.equal(memberFull.remaining,0);
 const memberCap=await searchOnce();
 assert.equal(memberCap.error.code,'web_search_limit');
 assert.match(memberCap.error.message,/本月/);
 assert.equal(searches,9,'Monthly cap does not start the browser');

 // Expired members must immediately return to their free daily allowance.
 sqlite.prepare('UPDATE account_memberships SET expires_at=? WHERE account_id=?').run(Date.now()-1,account);
 const expiredCap=await searchOnce();
 assert.equal(expiredCap.error.code,'web_search_limit');
 assert.match(expiredCap.error.message,/今日/);
 const expiredUsage=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(expiredUsage.tier,'free');assert.equal(expiredUsage.remaining,0);
 assert.equal(searches,9);

 // A permanent membership is also entitled even without a future expiry.
 sqlite.prepare('UPDATE account_memberships SET permanent=1,expires_at=0 WHERE account_id=?').run(account);
 sqlite.prepare("UPDATE account_rate_limits SET count=999 WHERE bucket LIKE 'ai-web-search:month:%'").run();
 assert.equal((await searchOnce()).result.source,'duckduckgo');
 assert.equal(searches,10);
 const permanentUsage=(await (await api('mcp','GET')).json()).usage.webSearch;
 assert.equal(permanentUsage.tier,'member');assert.equal(permanentUsage.used,1000);assert.equal(permanentUsage.remaining,0);
 // Keep one Cloudflare browser alive through successive queries in a single AI run.
 // Launching a new browser for every model tool call can hit Browser Run's
 // new-instance rate limit even when each individual query works.
 const {runWebSearch}=await import('../worker/ai-web-search.mjs');
 const lease={browser:null},beforeSearches=searches,beforeClosed=closed;
 primary='results';query='public docs';
 for(let i=0;i<2;i++){
  const result=await runWebSearch(searchEnv,'reuse-search-fixture',{query,maxResults:3},undefined,launchSearchBrowser,lease);
  assert.equal(result.results.length,1);
 }
 assert.equal(searches,beforeSearches+1,'Repeated searches in one run reuse the browser');
 assert.equal(closed,beforeClosed,'Browser stays open between searches');
 await lease.browser.close();lease.browser=null;
 assert.equal(closed,beforeClosed+1,'Browser is closed when the run ends');
 const concurrentLease={browser:null},beforeConcurrent=searches,beforeContexts=contextsOpened,beforeContextCloses=contextsClosed;
 const concurrentResults=await Promise.all(Array.from({length:3},()=>runWebSearch(searchEnv,'concurrent-search-fixture',{query,maxResults:3},undefined,launchSearchBrowser,concurrentLease)));
 assert.deepEqual(concurrentResults.map(item=>item.results.length),[1,1,1]);
 assert.equal(searches,beforeConcurrent+1,'Concurrent searches share one browser launch');
 assert.equal(contextsOpened-beforeContexts,3,'Each concurrent query has an isolated browser context');
 assert.equal(contextsClosed-beforeContextCloses,3,'Each query closes only its own context');
 await concurrentLease.browser.close();
 assert.equal(closed,beforeClosed+2);
 const rejected=await runWebSearch(searchEnv,'launch-failure-fixture',{query,maxResults:3},undefined,async()=>{throw Object.assign(Error('429 Too many browser instances'),{status:429})});
 assert.equal(rejected.error.code,'web_search_rate_limited');
 assert.equal((await (await import('../worker/ai-web-search.mjs')).webSearchUsage(searchEnv,'launch-failure-fixture')).used,0,'Rejected launches must not use customer quota');
 const rejectedLease={browser:null};let rejectedLaunches=0;
 const denyLaunch=async()=>{rejectedLaunches++;throw Object.assign(Error('429 Too many browser instances'),{status:429})};
 const refused=await Promise.all(Array.from({length:3},()=>runWebSearch(searchEnv,'shared-failed-launch',{query,maxResults:3},undefined,denyLaunch,rejectedLease)));
 assert.ok(refused.every(result=>result.error.code==='web_search_rate_limited'));
 assert.equal(rejectedLaunches,2,'Concurrent rate-limited queries share one initial launch and one bounded retry');
 await runWebSearch(searchEnv,'shared-failed-launch',{query,maxResults:3},undefined,denyLaunch,rejectedLease);
 assert.equal(rejectedLaunches,2,'A rejected launch does not cause later queries to retry in a storm');
 assert.equal((await (await import('../worker/ai-web-search.mjs')).webSearchUsage(searchEnv,'shared-failed-launch')).used,0);
 await api('mcp','PUT',{webSearch:false});
}

// The preset uses the anonymous Parallel MCP endpoint. Its searches remain
// available after Easybook's own Browser Rendering quota is exhausted.
{
 const endpoint='https://mcp.parallel.ai/mcp',searchQuery='APEC 2026',source='https://example.org/parallel',queries=[];
 let parallelCalls=0,rateLimited=false;
 const parallelFetcher=async(url,init={})=>{
  const target=new URL(url),headers=new Headers(init.headers);
  if(target.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
  if(target.href===endpoint){
   assert.equal(headers.get('Authorization'),null,'Anonymous preset never forwards Easybook credentials');
   if(init.method==='DELETE')return new Response(null,{status:204});
   const payload=JSON.parse(init.body);
   if(payload.method==='initialize')return Response.json({jsonrpc:'2.0',id:payload.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
   if(payload.method==='notifications/initialized')return new Response(null,{status:202});
   if(payload.method==='tools/call'){
    assert.equal(payload.params.name,'web_search');
    assert.deepEqual(payload.params.arguments,{objective:searchQuery,search_queries:[searchQuery]});
    queries.push(payload.params.arguments);
    parallelCalls++;
    if(rateLimited)return Response.json({error:'Rate limit exceeded'},{status:429});
    return Response.json({jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:JSON.stringify({results:[{url:source,title:'Parallel official result',publish_date:'2026-11-21',excerpts:['Evidence found']},{url:'javascript:alert(1)',title:'Unsafe link',excerpts:['ignore']}]})}]}});
   }
   throw Error('Unexpected Parallel RPC');
  }
  assert.equal(target.hostname,'api.openai.com');
  const request=JSON.parse(init.body);
  if(request.messages.at(-1)?.role==='tool')return Response.json({choices:[{message:{role:'assistant',content:'已使用进阶搜索来源。'}}]});
  if(!request.tools?.some(tool=>tool.function.name==='web_search'))return Response.json({choices:[{message:{role:'assistant',content:'No web search'}}]});
  return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'parallel-search',type:'function',function:{name:'web_search',arguments:JSON.stringify({query:searchQuery})}}]}}]});
 };
 assert.deepEqual(parallelSearchResults({results:[{url:source,title:'Result',excerpts:['text']},{url:'file:///private',title:'Bad'}]}).map(x=>x.url),[source]);
 const direct=await runParallelMcpSearch(searchQuery,undefined,parallelFetcher);
 assert.equal(direct.results[0].url,source);
 assert.equal(direct.results[0].description,'Evidence found');
 assert.equal(direct.results[0].publishedAt,'2026-11-21');
 assert.equal(direct.results.length,1);
 const call=(path,method,body)=>aiAPI(request('/api/ai/'+path,method,body),env,principal,{workspaceId:workspace,fetcher:parallelFetcher});
 const chat=async()=>Response.json(await completeResearch(body=>call('chat','POST',body),{mode:'conversation',credentialId:openaiId,messages:[{role:'user',content:'搜索 APEC 2026'}]}));
 assert.equal((await call('mcp','PUT',{parallelSearch:true})).status,200);
 const listed=(await (await call('mcp','GET')).json()).parallelSearch;
 assert.equal(listed.enabled,true);assert.equal(listed.approval,'ask');
 const proposal=(await chat()).json();
 const approval=(await proposal).approval;
 assert.equal(approval.tool,'web_search');
 assert.deepEqual(approval.providers,{primary:false,parallel:true});
 const before=sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count;
 const executed=await (await call('execute','POST',{approvalId:approval.id})).json();
 assert.equal(executed.ok,true);
 assert.equal(executed.result.source,'parallel');
 assert.equal(executed.result.results[0].url,source);
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count,before,'Parallel uses no Easybook quota');
 assert.equal((await call('mcp','PUT',{parallelSearchApproval:'always'})).status,200);
 const automatic=await (await chat()).json();
 assert.equal(automatic.approval,undefined);
 assert.equal(automatic.webSearch.result.source,'parallel');
 assert.equal(automatic.message.content,'已使用进阶搜索来源。');
 rateLimited=true;
 const limited=await (await chat()).json();
 assert.equal(limited.webSearch.result.browserSearch,true);
 assert.equal(limited.webSearch.result.error.code,'parallel_rate_limited');
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count,before);
 assert.equal((await call('mcp','PUT',{parallelSearch:false})).status,200);
 const unavailable=await (await chat()).json();
 assert.equal(unavailable.approval,undefined);
 assert.equal(unavailable.message.content,'No web search','No search tool is offered once both providers are disabled');
 assert.ok(parallelCalls>=4);
}

// Dynamic research can request different result counts and search repeatedly
// in a single AI answer, while preserving independent Parallel and account quotas.
{
 const all=Array.from({length:28},(_,i)=>({url:'https://example.org/research/'+i,title:'Source '+i,excerpts:['Public evidence '+i]}));
 let modelRounds=0,parallelQueries=[];
 const fetcher=async(url,init={})=>{
  const target=new URL(url);
  if(target.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
  if(target.hostname==='mcp.parallel.ai'){
   if(init.method==='DELETE')return new Response(null,{status:204});
   const rpc=JSON.parse(init.body);
   if(rpc.method==='initialize')return Response.json({jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
   if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
   assert.equal(rpc.method,'tools/call');
   parallelQueries.push(rpc.params.arguments.objective);
   return Response.json({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify({results:all})}]}});
  }
  assert.equal(target.hostname,'api.openai.com');
  const payload=JSON.parse(init.body),last=payload.messages.at(-1),turn=++modelRounds;
  if(turn===1||turn===2){
   assert.equal(last.role,turn===1?'user':'tool');
   return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'research-'+turn,type:'function',function:{name:'web_search',arguments:JSON.stringify({query:turn===1?'APEC Shenzhen':'APEC meetings',maxResults:turn===1?4:22})}}]}}]});
  }
  return Response.json({choices:[{message:{role:'assistant',content:'已综合不同查询结果与来源。'}}]});
 };
 const api=(path,method,body)=>aiAPI(request('/api/ai/'+path,method,body),env,principal,{workspaceId:workspace,fetcher});
 assert.equal((await api('mcp','PUT',{parallelSearch:true})).status,200);
 assert.equal((await api('mcp','GET')).status,200);
 const usedBefore=sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count;
 const result=await completeResearch(body=>api('chat','POST',body),{credentialId:openaiId,mode:'conversation',messages:[{role:'user',content:'比较 APEC 的多方资料'}]});
 assert.equal(result.approval,undefined);
 assert.equal(result.message.content,'已综合不同查询结果与来源。');
 assert.equal(result.webSearches.length,2,'Research continues after the first search without starting a new reply');
 assert.deepEqual(result.webSearches.map(item=>item.result.results.length),[4,22],'Each search has its own model-selected result count');
 assert.deepEqual(parallelQueries,['APEC Shenzhen','APEC meetings']);
 assert.equal(result.webSearch.result.results.length,22,'Legacy search receipt remains available');
 assert.equal(sqlite.prepare("SELECT count FROM account_rate_limits WHERE bucket LIKE 'ai-web-search:month:%'").get().count,usedBefore,'Parallel research uses no Easybook browser quota');
 // An oversized research task is split across responses instead of allowing
 // one Worker invocation to exhaust the 30s default CPU budget.
 modelRounds=0;
 const segmented=(await (await aiAPI(request('/api/ai/chat','POST',{credentialId:openaiId,mode:'conversation',messages:[{role:'user',content:'长任务，继续搜集证据'}]}),{...env,AI_SEARCH_SEGMENT_MS:1},principal,{workspaceId:workspace,fetcher})).json());
 assert.equal(segmented.continuationRequired,true,'Long research returns a resumable segment');
 assert.equal(segmented.partial,true);
 assert.equal(segmented.webSearches.length,1,'Completed search receipt is preserved before continuing');
 assert.match(segmented.agentRunId,/^[a-f0-9-]{36}$/,'A checkpoint saves the original model context in D1');
 const resumed=await completeResearch(body=>aiAPI(request('/api/ai/chat','POST',body),{...env,AI_SEARCH_SEGMENT_MS:1},principal,{workspaceId:workspace,fetcher}),{purpose:'agent_run:'+segmented.agentRunId});
 assert.equal(resumed.message.content,'已综合不同查询结果与来源。');
 assert.equal((await api('mcp','PUT',{parallelSearch:false})).status,200);
}

// Free Workers keep each invocation small, but the same user task can
// continue for ten or more searches across requests; pairs still run in parallel.
{
 let mode='serial',modelRounds=0,networkCalls=0,inFlight=0,peakInFlight=0;
 const fetcher=async(url,init={})=>{
  const target=new URL(url);
  if(target.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
  if(target.hostname==='mcp.parallel.ai'){
   if(init.method==='DELETE')return new Response(null,{status:204});
   const rpc=JSON.parse(init.body);
   if(rpc.method==='initialize')return Response.json({jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
   if(rpc.method==='notifications/initialized')return new Response(null,{status:202});
   assert.equal(rpc.method,'tools/call');
   networkCalls++;inFlight++;peakInFlight=Math.max(inFlight,peakInFlight);
   await new Promise(resolve=>setTimeout(resolve,10));
   inFlight--;
   const phrase=rpc.params.arguments.objective;
   return Response.json({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify({results:[{url:'https://example.org/q/'+encodeURIComponent(phrase),title:'Found '+phrase,excerpts:['Public information']}]})}]}});
  }
  assert.equal(target.hostname,'api.openai.com');
  const payload=JSON.parse(init.body),seen=payload.messages.filter(x=>x.role==='tool').length;
  modelRounds++;
  if(mode==='failure'&&seen>=1)return Response.json({error:{message:'upstream failed'}},{status:503});
  const count=mode==='serial'?(networkCalls<10?1:0):mode==='batch'?(seen?0:Math.max(0,10-networkCalls)):(seen?0:1);
  const calls=Array.from({length:count},(_,i)=>({id:mode+'-'+seen+'-'+i,type:'function',
   function:{name:'web_search',arguments:JSON.stringify({query:'independent topic '+(mode==='serial'?networkCalls:networkCalls+i),maxResults:3})}}));
  return Response.json({choices:[{message:calls.length?{role:'assistant',content:'',tool_calls:calls}:{role:'assistant',content:'已综合搜索结果。'}}]});
 };
 const api=(path,method,body)=>aiAPI(request('/api/ai/'+path,method,body),env,principal,{workspaceId:workspace,fetcher});
 assert.equal((await api('mcp','PUT',{parallelSearch:true})).status,200);
 assert.equal((await api('mcp','PUT',{parallelSearchApproval:'always'})).status,200);
 assert.equal((await api('mcp','PUT',{parallelMode:'anonymous'})).status,200);
 const chat=async()=> (await api('chat','POST',{credentialId:openaiId,mode:'conversation',messages:[{role:'user',content:'检索10个独立主题'}]})).json();
 const serialQueries=[];
 for(let segment=0;networkCalls<10&&segment<10;segment++){
  const step=await chat();
  assert.ok(step.webSearches.length>=1&&step.webSearches.length<=2,'Each free-tier segment stays small');
  assert.ok(step.webSearches.every(item=>item.result.results.length===1));
  serialQueries.push(...step.webSearches.map(item=>item.arguments.query));
  if(networkCalls<10)assert.equal(step.continuationRequired,true);
 }
 assert.equal(networkCalls,10);
 assert.deepEqual(serialQueries,Array.from({length:10},(_,i)=>'independent topic '+i));
 assert.equal(networkCalls,10);assert.equal(peakInFlight,1);
 mode='batch';modelRounds=0;networkCalls=0;inFlight=0;peakInFlight=0;
 const batchedQueries=[];
 for(let segment=0;networkCalls<10&&segment<10;segment++){
  const step=await chat();
  assert.ok(step.webSearches.length>=1&&step.webSearches.length<=2,'At most two searches execute per Worker request');
  batchedQueries.push(...step.webSearches.map(item=>item.arguments.query));
  if(networkCalls<10)assert.equal(step.continuationRequired,true);
 }
 assert.equal(networkCalls,10);
 assert.ok(peakInFlight>=2,'Independent searches still execute concurrently');
 assert.deepEqual(batchedQueries,Array.from({length:10},(_,i)=>'independent topic '+i));
 mode='failure';modelRounds=0;networkCalls=0;
 const partial=await chat();
 assert.equal(partial.partial,true,'A provider failure after research must not erase results');
 assert.equal(partial.webSearches.length,1);
 assert.match(partial.message.content,/已保留检索结果/);
 assert.equal((await api('mcp','PUT',{parallelSearch:false})).status,200);
}

// Third-party MCP is opt-in and always sends arguments only after approval.
{
 const endpoint='https://mcp.example.net/tools',token='fixture-mcp-secret-token',remoteName='lookup';
 let remoteCalls=0,privateDns=false,redirected=false;
 const mcpFetcher=async(url,init)=>{
  const target=new URL(url),headers=new Headers(init.headers);
  if(target.hostname==='cloudflare-dns.com'){
   assert.equal(headers.has('Authorization'),false);
   const type=target.searchParams.get('type');
   return Response.json({Status:0,Answer:type==='A'?[{type:1,data:privateDns?'127.0.0.1':'8.8.8.8'}]:[]});
  }
  if(target.href===endpoint){
   assert.equal(init.redirect,'manual');
   assert.equal(headers.get('Authorization'),'Bearer '+token);
   if(redirected)return new Response(null,{status:302,headers:{Location:'https://other.example.net'}});
   if(init.method==='DELETE')return new Response(null,{status:204});
   const payload=JSON.parse(init.body);
   if(payload.method==='initialize')return Response.json({jsonrpc:'2.0',id:payload.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}},{headers:{'Mcp-Session-Id':'fixture-id'}});
   assert.equal(headers.get('Mcp-Session-Id'),'fixture-id');
   assert.equal(headers.get('MCP-Protocol-Version'),'2025-06-18');
   if(payload.method==='notifications/initialized')return new Response(null,{status:202});
   if(payload.method==='tools/list'){
    const event={jsonrpc:'2.0',id:payload.id,result:{tools:[{name:remoteName,inputSchema:{type:'object',properties:{query:{type:'string'}}}}]}};
    return new Response('event: message\r\ndata: '+JSON.stringify(event)+'\r\n\r\n',{headers:{'Content-Type':'text/event-stream'}});
   }
   assert.equal(payload.method,'tools/call');
   assert.deepEqual(payload.params,{name:remoteName,arguments:{query:'test'}});
   remoteCalls++;
   return Response.json({jsonrpc:'2.0',id:payload.id,result:{content:[{type:'text',text:'found '+token}]}});
  }
  assert.equal(target.hostname,'api.openai.com');
  const modelRequest=JSON.parse(init.body);
  assert.ok(!init.body.includes(token));
  const tool=modelRequest.tools?.find(t=>t.function.name.startsWith('mcp_'));
  return Response.json({choices:[{message:tool?{role:'assistant',tool_calls:[{id:'remote-call',type:'function',function:{name:tool.function.name,arguments:'{"query":"test"}'}}]}:{role:'assistant',content:'no external tools'}}]});
 };
 const call=(path,method,body,p=principal,workspaceId=workspace)=>aiAPI(request('/api/ai/'+path,method,body),env,p,{workspaceId,fetcher:mcpFetcher});
 const save=()=>call('mcp','PUT',{url:endpoint,label:'查找工具',token});
 privateDns=true;assert.equal((await save()).status,400);privateDns=false;
 redirected=true;assert.equal((await save()).status,502);redirected=false;
 assert.equal((await save()).status,200);
 const listed=await (await call('mcp','GET')).json(),server=listed.servers[0];
 assert.deepEqual(server.tools,[remoteName]);assert.ok(!JSON.stringify(listed).includes(token));
 assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM account_ai_mcp_servers').all()).includes(token));
 const foreignMcp=await (await call('mcp','GET',undefined,{...principal,accountId:'another-account'})).json();
 assert.deepEqual({servers:foreignMcp.servers,webSearch:foreignMcp.webSearch},{servers:[],webSearch:{available:false,enabled:false,approval:'ask'}});
 assert.deepEqual({tier:foreignMcp.usage.webSearch.tier,used:foreignMcp.usage.webSearch.used,remaining:foreignMcp.usage.webSearch.remaining},{tier:'free',used:0,remaining:15},'Usage is isolated by authenticated account');
 const chat=(externalTools,mode='conversation')=>call('chat','POST',{credentialId:openaiId,messages:[{role:'user',content:'查找'}],externalTools,mode});
 assert.equal((await (await chat(false)).json()).message.content,'no external tools');
 const approved=await (await chat(true)).json();
 assert.deepEqual(approved.approval.external,{server:'查找工具',tool:remoteName,host:'mcp.example.net'});
 assert.equal(remoteCalls,0);
 const execute=approvalId=>call('execute','POST',{approvalId});
 const executed=await (await execute(approved.approval.id)).json();
 assert.deepEqual(executed.result,{text:'found [redacted]'});
 assert.equal((await execute(approved.approval.id)).status,409);
 assert.equal(remoteCalls,1);
 const second=await (await chat(true,'agent')).json();
 assert.equal((await call('mcp','PUT',{id:server.id,enabled:false})).status,200);
 assert.equal((await execute(second.approval.id)).status,403);
 assert.equal(remoteCalls,1);
 assert.equal((await call('mcp','DELETE',{id:server.id})).status,200);
 console.log('PASS external MCP discovery, session headers, private addresses, single-use approval, credential redaction and config revocation');
}

{
 const resource='https://tools.example.net/mcp',issuer='https://login.example.net/auth';
 const callback='/api/ai/mcp/oauth/callback';
 const access='oauth-access-secret',refreshed='oauth-access-refreshed',refresh='oauth-refresh-secret';
 let registered=0,downloads=0,refreshes=0,challenge='',privateTokenEndpoint=false,redirectTokenEndpoint=false;
 const fetcher=async(input,init)=>{
  const url=new URL(input);
  assert.equal(init.redirect,'manual');
  if(url.hostname==='cloudflare-dns.com'){
   const privateHost=privateTokenEndpoint&&url.searchParams.get('name')==='token.example.net';
   return Response.json({Status:0,Answer:[{type:1,data:privateHost?'10.0.0.1':'93.184.216.34'}]});
  }
  if(url.href===resource){
   const body=JSON.parse(init.body),token=init.headers.get?.('Authorization');
   if(!token)return new Response(null,{status:401,headers:{'WWW-Authenticate':'Bearer resource_metadata="https://tools.example.net/.well-known/oauth-protected-resource/mcp", scope="read write"'}});
   assert.equal(token,'Bearer '+(refreshes?refreshed:access));
   const result=body.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}}}:
    body.method==='tools/list'?{tools:[{name:'lookup',inputSchema:{type:'object'}}]}:null;
   return result?Response.json({jsonrpc:'2.0',id:body.id,result}):new Response(null,{status:202});
  }
  if(url.pathname==='/.well-known/oauth-protected-resource/mcp')return Response.json({resource,authorization_servers:[issuer],scopes_supported:['read']});
  if(url.pathname==='/.well-known/oauth-authorization-server/auth')return Response.json({
   issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:'https://token.example.net/token',
   registration_endpoint:issuer+'/register',code_challenge_methods_supported:['S256'],authorization_response_iss_parameter_supported:true
  });
  if(url.pathname==='/auth/register'){
   registered++;
   const body=JSON.parse(init.body);
   assert.deepEqual(body.redirect_uris,['https://easybook.test'+callback]);
   assert.equal(body.token_endpoint_auth_method,'none');
   return Response.json({client_id:'dynamic-client',token_endpoint_auth_method:'none',client_secret:'registrar-ignored-secret'});
  }
  if(url.pathname==='/token'){
   if(redirectTokenEndpoint)return new Response(null,{status:307,headers:{Location:'https://other.example.net/token'}});
   const body=new URLSearchParams(init.body);
   assert.equal(body.get('resource'),resource);
   assert.equal(body.get('client_secret'),null,'a public registration never sends an unused vendor secret');
   if(body.get('grant_type')==='refresh_token'){
    refreshes++;
    assert.equal(body.get('refresh_token'),refresh);
    return Response.json({access_token:refreshed,token_type:'Bearer',expires_in:3600});
   }
   downloads++;
   assert.equal(body.get('code'),'code-from-provider');
   const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
   assert.equal(digest,challenge);
   return Response.json({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:1});
  }
  throw Error('Unexpected OAuth request: '+url);
 };
 const config=(body,who=principal)=>aiAPI(request('/api/ai/mcp',body?'PUT':'GET',body),env,who,{fetcher});
 const start=clientId=>config({oauth:true,label:'OAuth MCP',url:resource,clientId});
 const useCallback=(state,params={code:'code-from-provider',iss:issuer})=>aiMcpOAuthPage(request(callback+'?'+new URLSearchParams({state,...params})),env,{fetcher});
 const pending=await (await start()).json();
 assert.match(pending.state,/^[a-f0-9]{64}$/);
 assert.equal(registered,1);
 assert.equal((await config({oauthState:pending.state},{...principal,accountId:'another-account'})).status,400);
 const redirect=await aiMcpOAuthPage(new Request(pending.authorizationUrl),env,{fetcher});
 assert.equal(redirect.status,303);
 const authorization=new URL(redirect.headers.get('Location'));
 assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
 assert.equal(authorization.searchParams.get('scope'),'read');
 challenge=authorization.searchParams.get('code_challenge');
 assert.equal((await useCallback(pending.state)).status,200);
 assert.equal((await useCallback(pending.state)).status,400,'an authorization code callback is single use');
 assert.equal(downloads,1);
 assert.deepEqual(await (await config({oauthState:pending.state})).json(),{status:'connected'});
 const {servers}=await (await config()).json();
 assert.equal(servers.length,1);
 assert.deepEqual(servers[0].tools,['lookup']);
 assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM account_ai_mcp_servers').all()).includes(refresh));
 assert.equal((await config({id:servers[0].id,refresh:true})).status,200);
 assert.equal(refreshes,1);
 assert.equal((await config({id:servers[0].id,refresh:true})).status,200);
 assert.equal(refreshes,1,'a valid refreshed token is reused');
 const cancelled=await (await start('manual-public-client')).json();
 assert.equal(registered,1,'manual client ID bypasses registration');
 assert.equal((await useCallback(cancelled.state,{error:'access_denied',iss:issuer})).status,400);
 assert.deepEqual(await (await config({oauthState:cancelled.state})).json(),{status:'denied'});
 const blocked=await (await start('manual-public-client')).json();
 privateTokenEndpoint=true;
 assert.equal((await useCallback(blocked.state)).status,400);
 assert.equal(downloads,1,'the token endpoint is checked for public addresses before exchanging the code');
 privateTokenEndpoint=false;
 const redirectedFlow=await (await start('manual-public-client')).json();
 redirectTokenEndpoint=true;
 assert.equal((await useCallback(redirectedFlow.state)).status,400,'OAuth token endpoints may not redirect');
 assert.deepEqual(await (await config({oauthState:redirectedFlow.state})).json(),{status:'mcp_oauth_token_failed'});
 redirectTokenEndpoint=false;
 assert.equal((await config({label:'Second connection',url:resource,token:refreshed})).status,200);
 assert.equal((await (await config()).json()).servers.length,2,'multiple connections to the same MCP endpoint can coexist');
 const canonical='https://easybook.loonxy.com';
 const identityEnv={...env,AI_CREDENTIAL_KEY:Buffer.alloc(32,11).toString('base64')};
 const native=await aiAPI(new Request(canonical+'/api/ai/mcp',{
  method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({oauth:true,label:'Native MCP',url:resource,clientId:'manual-public-client'})
 }),identityEnv,principal,{fetcher,identityWorker:true});
 const nativeFlow=await native.json();
 let routed=0;
 const webEnv={...env,WORKSPACE_IDENTITY_V2:'true',PUBLIC_ORIGIN:canonical,IDENTITY_SERVICE:{fetch(req){
  routed++;return aiMcpOAuthPage(req,identityEnv,{fetcher});
 }}};
 const nativeRedirect=await worker.fetch(new Request(nativeFlow.authorizationUrl),webEnv);
 assert.equal(nativeRedirect.status,303,'Android launch is handled by the Worker that encrypted the flow');
 assert.equal((await worker.fetch(new Request(canonical+callback+'?state='+nativeFlow.state+'&error=access_denied'),webEnv)).status,400);
 assert.equal(routed,2,'both launch and callback use the identity Worker');
 console.log('PASS MCP OAuth discovery, least-privilege scope, public client registration, PKCE, account-bound status, callback replay, encrypted refresh, private endpoint rejection and native Worker affinity');
}

// Optional Parallel OAuth is bound to the Easybook account, hidden from
// third-party MCP catalogs, stored encrypted, and only used when selected.
{
 const base='https://mcp.parallel.ai/mcp',login=base+'?login',issuer='https://platform.parallel.ai';
 const metadataUrl='https://mcp.parallel.ai/.well-known/oauth-protected-resource/mcp?login';
 const callback='/api/ai/mcp/oauth/callback';
 const token='parallel-login-secret-token';
 let registered=0,protectedCalls=0,anonymousCalls=0,clientCalls=0,modelRounds=0;
 let anonymousLoginProbe=false;
 const parallelFetcher=async(input,init={})=>{
  const u=new URL(input),headers=new Headers(init.headers);
  if(u.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
  if(u.href===login){
   assert.equal(init.method,'POST');
   if(anonymousLoginProbe)return Response.json({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
   return new Response(null,{status:401,headers:{'WWW-Authenticate':'Bearer resource_metadata="'+metadataUrl+'"'}});
  }
  if(u.href===metadataUrl)
   return Response.json({resource:login,authorization_servers:[issuer],scopes_supported:['key:read']});
  if(u.href===issuer+'/.well-known/oauth-authorization-server')
   return Response.json({issuer,authorization_endpoint:issuer+'/getKeys/authorize',token_endpoint:issuer+'/getKeys/token',
    registration_endpoint:issuer+'/getKeys/register',code_challenge_methods_supported:['S256'],
    grant_types_supported:['authorization_code','urn:ietf:params:oauth:grant-type:device_code'],
    token_endpoint_auth_methods_supported:['none']});
  if(u.href===issuer+'/getKeys/register'){
   registered++;
   const requestBody=JSON.parse(init.body);
   assert.deepEqual(requestBody.redirect_uris,['https://easybook.test'+callback]);
   assert.equal(requestBody.application_type,'web');
   assert.deepEqual(requestBody.grant_types,['authorization_code'],'Do not request unadvertised refresh-token grants');
   return Response.json({client_id:'parallel-public-client',token_endpoint_auth_method:'none'});
  }
  if(u.href===issuer+'/getKeys/token'){
   assert.equal(new URLSearchParams(init.body).get('resource'),login);
   return Response.json({access_token:token,token_type:'Bearer',expires_in:3600,refresh_token:'parallel-refresh-secret'});
  }
  if(u.href===base){
   if(init.method==='DELETE')return new Response(null,{status:204});
   const authenticated=headers.get('Authorization')==='Bearer '+token;
   if(authenticated){
    protectedCalls++;
    const config=JSON.parse(headers.get('x-parallel-mcp-config'));
    assert.equal(config.web_search.override.advanced_settings.max_results,22);
   }else{anonymousCalls++;assert.equal(headers.has('x-parallel-mcp-config'),false)}
   const body=JSON.parse(init.body);
   if(body.method==='initialize')return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
   if(body.method==='notifications/initialized')return new Response(null,{status:202});
   assert.equal(body.method,'tools/call');
   clientCalls++;
   return Response.json({jsonrpc:'2.0',id:body.id,result:{content:[{type:'text',text:JSON.stringify({results:Array.from({length:authenticated?26:10},(_,i)=>({
    url:'https://example.com/parallel-'+i,title:'Parallel source '+i,excerpts:['Public evidence'] }))})}]}});
  }
  if(u.hostname==='api.openai.com'){
   const requestBody=JSON.parse(init.body);
   if(requestBody.messages.at(-1)?.role==='tool')return Response.json({choices:[{message:{role:'assistant',content:'Sources collected.'}}]});
   modelRounds++;
   return Response.json({choices:[{message:{role:'assistant',tool_calls:[{id:'parallel-model-'+modelRounds,type:'function',function:{name:'web_search',arguments:JSON.stringify({query:'Parallel authenticated 2026',maxResults:22})}}]}}]});
  }
  throw Error('Unexpected Parallel OAuth URL '+u.href);
 };
 const config=(body,method='PUT')=>aiAPI(request('/api/ai/mcp',body?method:'GET',body),env,principal,{fetcher:parallelFetcher});
 assert.equal((await config()).status,200);
 assert.equal((await (await config()).json()).parallelSearch.connected,false);
 const start=await (await config({parallelLogin:true})).json();
 assert.match(start.state,/^[a-f0-9]{64}$/);
 assert.equal(registered,1);
 // Some servers answer an anonymous MCP initialize even on an explicit-login
 // endpoint. OAuth discovery must still use the verified resource metadata.
 anonymousLoginProbe=true;
 const fallback=await config({parallelLogin:true});
 assert.equal(fallback.status,200);
 assert.match((await fallback.json()).state,/^[a-f0-9]{64}$/);
 assert.equal(registered,2);
 anonymousLoginProbe=false;
 const launch=await aiMcpOAuthPage(new Request(start.authorizationUrl),env,{fetcher:parallelFetcher});
 assert.equal(launch.status,303);
 const destination=new URL(launch.headers.get('Location'));
 assert.equal(destination.searchParams.get('redirect_uri'),'https://easybook.test'+callback);
 assert.equal((await aiMcpOAuthPage(request(callback+'?state='+start.state+'&code=parallel-auth-code'),env,{fetcher:parallelFetcher})).status,200);
 assert.deepEqual(await (await config({oauthState:start.state})).json(),{status:'connected'});
 // Auth server and protected-resource metadata must both match the real Parallel response.
 assert.equal(destination.searchParams.get('resource'),login);
 assert.equal(destination.searchParams.get('scope'),'key:read');
 const view=await (await config()).json();
 assert.equal(view.parallelSearch.connected,true);assert.equal(view.parallelSearch.mode,'account');
 assert.equal(view.servers.some(row=>row.label.includes('Parallel 登录')),false,'Built-in OAuth is not a duplicate external MCP');
 const stored=sqlite.prepare("SELECT key_ciphertext FROM account_ai_mcp_servers WHERE url=?").get(login);
 assert.ok(stored?.key_ciphertext);
 assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM account_ai_mcp_servers WHERE url=?").get(login)).includes(token));
 const call=(body)=>aiAPI(request('/api/ai/chat','POST',body),env,principal,{workspaceId:workspace,fetcher:parallelFetcher});
 assert.equal((await config({parallelSearch:true})).status,200);
 assert.equal((await config({parallelSearchApproval:'always'})).status,200);
 const args={credentialId:openaiId,mode:'conversation',messages:[{role:'user',content:'Search public sources'}]};
 const accountSearch=await (await call(args)).json();
 assert.equal(accountSearch.webSearch.result.results.length,22);
 assert.equal(accountSearch.webSearch.result.diagnostics.parallel.mode,'account');
 assert.ok(protectedCalls>0);
 assert.equal((await config({parallelMode:'anonymous'})).status,200);
 const anonSearch=await (await call(args)).json();
 assert.equal(anonSearch.webSearch.result.results.length,10);
 assert.equal(anonSearch.webSearch.result.diagnostics.parallel.mode,'anonymous');
 assert.ok(anonymousCalls>0);
 assert.equal((await config({parallelMode:'account'})).status,200);
 assert.equal((await config({parallelLogout:true})).status,200);
 const disconnected=await (await config()).json();
 assert.equal(disconnected.parallelSearch.connected,false);
 assert.equal(disconnected.parallelSearch.mode,'anonymous');
 assert.equal((await config({parallelMode:'account'})).status,401);
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM account_ai_mcp_servers WHERE url=?").get(login).total,0);
 assert.ok(clientCalls>=2);
 console.log('PASS Parallel optional OAuth login, encrypted account tokens, billing-mode selection, result override and logout');
}

sqlite.close();console.log('PASS multi-BYOK encryption, provider presets, model discovery, active switching, Anthropic protocol and workspace authorization');
