import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {hooks} from './fixtures/ai-hub-harness.mjs';
const html=readFileSync('app/src/main/assets/index.html','utf8');
const dom=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.indexedDB=new IDBFactory();w.AbortController=AbortController;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.scrollTo=()=>{};
w.matchMedia=()=>({matches:false,addEventListener(){}});Object.defineProperty(w,'crypto',{value:crypto});Object.defineProperty(w.navigator,'onLine',{value:false});
w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('})().catch(error=>',hooks+'\n})().catch(error=>'));
const wait=async predicate=>{const until=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<until,'App state settles');await new Promise(r=>setTimeout(r,5))}};
try{
 await wait(()=>w.aiHarness&&w.easybookRich&&w.document.getElementById('newTop').onclick);
 const app=w.aiHarness,$=id=>w.document.getElementById(id);const first=app.setup();
 assert.equal($('aiHubSend').disabled,true,'Empty composer is disabled');
 assert.equal($('aiHub').textContent.includes('Easybook AI'),false,'No brand wording in chat workspace');
 assert.ok($('aiHubConversation').closest('.ai-hub-nav'),'Original top mode control is retained');
 $('aiHubPrompt').value='第一篇草稿';$('aiHubPrompt').dispatchEvent(new w.Event('input'));
 app.files([{name:'draft.txt',type:'text',text:'draft'}]);
 const second=app.newSession().id;assert.notEqual(first,second);assert.equal($('aiHubPrompt').value,'');assert.equal($('aiHubAttachments').hidden,true);
 app.select(first);assert.equal($('aiHubPrompt').value,'第一篇草稿');assert.equal($('aiHubAttachments').hidden,false);
 let payload;
 app.cloud(async(body,events)=>{payload=body;events.progress('一段');app.render();const stable=$('aiHubMessages').querySelector('[data-message]');events.progress('回答');app.render();assert.equal($('aiHubMessages').querySelector('[data-message]'),stable,'Completed user node survives stream updates');return {message:{content:'一段回答'}}});
 await app.send('总结附件');assert.ok(payload.messages.some(m=>m.content.includes('[附件 draft.txt')));assert.equal(payload.attachments.length,0);assert.equal(app.busy(),false);assert.equal(app.session().messages.at(-1).status,'done');
 assert.equal($('aiHubAttachments').hidden,true);
 // Errors retain prompt and partial response; resumption uses execution/context history.
 app.cloud(async(body,events)=>{events.progress('保留的部分回答');throw Error('网络中断')});
 await app.send('继续分析');assert.equal(app.session().messages.at(-1).status,'error');assert.match($('aiHubMessages').textContent,/网络中断/);assert.match($('aiHubMessages').textContent,/保留的部分回答/);
 app.cloud(async(body,events)=>{events.progress('停止前的文本');app.stop();return {message:{content:'不应提交的答案'}}});
 await app.send('可以停止');assert.equal(app.session().messages.at(-1).status,'stopped');assert.match(app.session().messages.at(-1).content,/停止前/);
 const proposal={id:'proposal',tool:'notes_create',arguments:{title:'测试笔记',text:'## 内容'},expiresAt:Date.now()+60000};
 app.seed([{role:'user',content:'创建笔记'},{role:'assistant',content:'请确认',toolEvents:[{name:'notes_create',status:'approval'}]}],proposal);
 $('aiHubAgent').click();assert.equal(app.session().mode,undefined,'Pending approval prevents changing execution mode');
 let executions=0;app.execute(async()=>{executions++;return {ok:true,result:{id:'created-id'}}});
 app.cloud(async(body)=>{assert.ok(body.messages.some(m=>m.content.includes('created-id')));return {message:{content:'已完成原始任务。'}}});
 await app.approve(true);assert.equal(executions,1);assert.equal(app.session().pendingApproval,null);assert.equal(app.session().messages.at(-1).status,'done');
 assert.equal(app.session().messages[1].toolEvents[0].status,'done');
 // Finished tool traces stay open across unrelated UI updates.
 const trace=$('aiHubMessages').querySelector('.ai-tool-activity');trace.open=true;app.render();assert.equal(trace.open,true);
 $('aiHubContext').click();assert.equal($('aiContextPanel').hidden,false);assert.match($('aiContextDetail').textContent,/字符预算/);
 assert.equal($('aiHubSend').disabled,true);
 console.log('AI UI: isolated drafts, streaming DOM, attachments, error/stop recovery, approval continuation and context controls OK');
}finally{dom.window.close()}
