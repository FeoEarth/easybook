import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as aiChat from '../shared/ai-chat.mjs';
const html=readFileSync('app/src/main/assets/index.html','utf8');
const contextSource=html.slice(html.indexOf('function aiHubContextModel('),html.indexOf('function renderAiHubContext('));
const source=contextSource+html.slice(html.indexOf('let aiHubStreamAbort=null'),html.indexOf('function localAiMarkdownDocument('));
async function scenario({local=false,accept=true,toolError=false,networkError=false,generationError=false,nextApproval=false}={}){
 const pending={id:'approval-1',tool:'notes_create',arguments:{title:'First'},local};
 const session={id:'session',profileId:local?'__local__':'cloud',model:'model',mode:'agent',messages:[{role:'user',content:'创建两篇笔记并总结'}],pendingApproval:pending};
 let executions=0,generations=0,payload;
 const prompt={value:'尚未发送的草稿',style:{height:'50px'}};
 const files=[{name:'draft.txt',type:'text',text:'unsent'}];
 const context={session,aiBusy:false,aiHubRuns:new Map(),aiHubExecutions:new Set(),aiHubBusy:false,aiHubFiles:files,aiConfigured:true,aiProfiles:[],aiLocalStatus:{models:[{id:'model',state:'installed'}]},AbortController,DOMException,window:{EasybookAiChat:aiChat},localSpace:'workspace',aiHubCurrent:'session',aiHubDraftFiles:new Map(),uuid:()=>crypto.randomUUID(),aiToolLabel:name=>name,renderAiHubSessions(){},generateAiHubTitle:async()=>{},
  currentAiHubSession:()=>session,setAiHubBusy:value=>{context.aiHubBusy=value},saveAiHubSessions(){},renderAiHub(){},toast(){},
  $:id=>id==='aiHubPrompt'?prompt:{},requestAnimationFrame:()=>1,cancelAnimationFrame(){},compactAiMessages:messages=>messages,
  refreshAiLocal:async()=>{},activateAiHubModel:async()=>{},recordAiToolEvent(){},clearAiHubFiles:()=>{files.length=0},
  sandboxSessionActive:()=>false,browserAvailable:()=>false,autoRememberAi:async()=>{},
 };
 const execute=async()=>{executions++;if(networkError)throw Error('network');return toolError?{ok:false,error:{code:'CONFLICT'}}:{ok:true,result:{id:'created-note'}}};
 const generate=async messages=>{generations++;payload=messages;assert.equal(context.aiHubBusy,true);if(generationError)throw Error('provider unavailable');return {message:{content:'任务继续'},...(nextApproval?{approval:{id:'approval-2',tool:'notes_create'}}:{})}};
 context.syncAiHubRun=()=>{context.aiHubBusy=context.aiHubRuns.has(session.id)||context.aiHubExecutions.has(session.id)};context.updateAiHubComposer=context.syncAiHubRun;
 context.aiRequest=execute;context.executeLocalAiApproval=execute;
 context.aiStreamRequest=async body=>{assert.equal(body.attachments.length,0);return generate(body.messages)};
 context.aiLocalGenerate=async(model,messages)=>generate(messages);
 vm.createContext(context);vm.runInContext(source,context);
 await context.confirmAiHubAction(accept);
 assert.equal(executions,accept?1:0);
 assert.equal(generations,accept&&!networkError?1:0);
 assert.equal(context.aiHubBusy,false);
 if(generationError)assert.equal(session.messages.at(-1).status,'error');
 assert.equal(prompt.value,'尚未发送的草稿');assert.equal(files.length,1);
 assert.equal(session.messages.filter(m=>m.role==='user').length,1,'No synthetic user turn is saved');
 if(generations){
  assert.match(payload.at(-1).content,/继续完成原始任务/);
  assert.ok(payload.some(m=>m.content.includes(toolError?'CONFLICT':'created-note')),'Actual execution outcome is supplied');
 }
 assert.equal(session.pendingApproval?.id,networkError?'approval-1':nextApproval?'approval-2':undefined);
}
for(const local of [false,true]){
 await scenario({local});await scenario({local,accept:false});await scenario({local,toolError:true});
 await scenario({local,networkError:true});await scenario({local,generationError:true});await scenario({local,nextApproval:true});
}
console.log('AI approval continuation: cloud/local, cancellation, failures and next approval OK');

// The preset is captured from the Android UI, and its page evidence stays in the live request.
{
 const session={id:'browser-chat',profileId:'cloud',model:'model',mode:'agent',messages:[]};
 const calls=[], snapshot={status:'ok',url:'https://example.org/docs',text:'Transient browser excerpt'};
 const action={id:crypto.randomUUID(),name:'browser_search',arguments:{query:'public docs'}};
 const context={AbortController,DOMException,window:{EasybookAiChat:aiChat},localSpace:'workspace',tab:'ai-hub',
  aiHubCurrent:session.id,aiHubRuns:new Map(),aiHubExecutions:new Set(),aiConfigured:true,aiHubFiles:[],aiHubDraftFiles:new Map(),
  aiProfiles:[],aiBrowserPresets:new Map([[session.id,'search']]),browserAvailable:()=>true,sandboxSessionActive:()=>false,
  currentAiHubSession:()=>session,uuid:()=>crypto.randomUUID(),requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  $:()=>({style:{},scrollHeight:0}),renderAiHub(){},renderAiHubSessions(){},recordAiToolEvent(){},saveAiHubSessions(){},
  syncAiHubRun(){},updateAiHubComposer(){},clearAiHubFiles(){},activateAiHubModel:async()=>{},generateAiHubTitle:async()=>{},autoRememberAi:async()=>{},
  native:{async call(method,args){
   calls.push([method,args]);
   if(method==='browser.begin')return {status:'ready'};
   if(method==='browser.step')return snapshot;
   return {status:'closed'};
  }},
  async aiStreamRequest(body){
   assert.equal(body.localBrowser,true);
   assert.equal(body.browserPreset,'search');
   if(!body.browserHistory.length)return {browserAction:action};
   assert.equal(body.browserHistory[0].result,snapshot);
   return {message:{content:'[Docs](https://example.org/docs)'}};
  }
 };
 vm.createContext(context);vm.runInContext(source,context);
 await context.sendAiHubMessage('查阅公开文档');
 assert.deepEqual(calls.map(([method])=>method),['browser.begin','browser.step','browser.end']);
 assert.equal(calls[0][1].preset,'search');
 assert.equal(calls[0][1].token,calls[2][1].token);
 assert.equal(session.messages.at(-1).status,'done');
 assert.match(session.messages.at(-1).content,/https:\/\/example\.org\/docs/);
 assert.doesNotMatch(JSON.stringify(session),/Transient browser excerpt/);
 assert.match(readFileSync('mcp-oauth/src/index.mjs','utf8'),/localBrowser:true,browserPreset:input\.browserPreset,browserHistory:input\.browserHistory/);
}

// A native browser result can resume only the originating live search card.
{
 const searchSource=html.slice(html.indexOf('let aiSearchHandoff=null;'),html.indexOf('function aiWebSearchReceipt('));
 const message={id:'receipt',receipt:{tool:'web_search',arguments:{query:'public docs'},result:{browserSearch:true}}};
 const session={id:'chat',messages:[message]};
 let token,requests=0;
 const state={window:{EasybookAiChat:aiChat},URL,localSpace:'workspace-a',aiHubBusy:false,currentAiHubSession:()=>session,
  native:{async call(method,args){assert.equal(method,'ai.web.search.assist');token=args.token}},
  uuid:()=>crypto.randomUUID(),saveAiHubSessions(){},renderAiHub(){},renderAiHubSessions(){},
  sendAiHubMessage(content,origin,options){assert.equal(origin,session);assert.equal(options.searchResume,true);requests++}
 };
 vm.createContext(state);vm.runInContext(searchSource,state);
 const results=JSON.stringify([{url:'https://example.com/docs',title:'Docs'},{url:'javascript:alert(1)',title:'Script'}]);
 await state.openManualWebSearch(session,message);
 const first=token;
 await state.openManualWebSearch(session,message);assert.equal(token,first);
 state.window.easybookWebSearchResult(first,null);
 assert.equal(requests,0);
 await state.openManualWebSearch(session,message);
 state.localSpace='workspace-b';
 state.window.easybookWebSearchResult(token,results);assert.equal(requests,0);
 state.localSpace='workspace-a';
 await state.openManualWebSearch(session,message);
 state.window.easybookWebSearchResult(first,results);assert.equal(requests,0);
 state.window.easybookWebSearchResult(token,results);
 assert.equal(requests,1);assert.equal(message.receipt.result.results.length,1);
 assert.match(message.apiContent,/https:\/\/example.com\/docs/);
 state.window.easybookWebSearchResult(token,results);assert.equal(requests,1);
}
