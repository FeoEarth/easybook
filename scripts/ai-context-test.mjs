import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {AI_CHAT_MAX_BODY_BYTES,AI_CHAT_MAX_TEXT_CHARS,AI_CHAT_MAX_MESSAGES} from '../shared/ai-context-policy.mjs';
import {fallbackChatTitle,normalizeChatTitle,chatTitleMessages,buildChatContext,buildCloudChatContext,createChatSessionStore,recoverChatSession,createChatRun,ServerSentEventDecoder,readServerSentEvents} from '../shared/ai-chat.mjs';
const history=[{role:'user',content:'请用中文，创建三篇笔记，保留引用。'}];
for(let i=0;i<50;i++){
 history.push({role:'assistant',content:'已完成创建 '+i,receipt:{tool:'notes_create',result:{id:'note-'+i}},apiContent:'已执行 notes_create，结果 id=note-'+i});
 history.push({role:'user',content:'后续要求 '+i+'。'.repeat(1000)});
 history.push({role:'assistant',content:'分析 '+i+'。'.repeat(1000)});
}
const result=buildChatContext(history);
assert.ok(result.compressed);assert.ok(result.messages.length<=38);assert.ok(result.used<=48000);
assert.match(result.messages[0].content,/请用中文，创建三篇笔记，保留引用/);
assert.match(result.messages[0].content,/notes_create/);
assert.match(result.messages.at(-1).content,/分析 49/);
assert.deepEqual(buildChatContext([{role:'user',content:'你好'}]).messages,[{role:'user',content:'你好'}]);
const excessive=buildChatContext([{role:'user',content:'X'.repeat(100000)},...Array.from({length:80},()=>({role:'assistant',content:'Y'.repeat(1000)}))]);
assert.ok(excessive.used<=48000);assert.ok(excessive.messages.length<=38);
const manyResults=buildChatContext([{role:'user',content:'分步整理'},...Array.from({length:90},()=>({role:'assistant',content:'已完成一步'}))]);
assert.ok(manyResults.messages.length<=38,'One long Agent turn respects message-count limit');
const originalLong='最初要求'.repeat(2900)+'务必保留最后这条约束';
const longContext=buildChatContext([{role:'user',content:originalLong},...history.slice(1)]);
assert.match(longContext.messages[0].content,/务必保留最后这条约束/);
assert.deepEqual(buildChatContext([{role:'user',content:'问题'},{role:'assistant',content:'',status:'error'}]).messages,[{role:'user',content:'问题'}]);
const interrupted=recoverChatSession({messages:[{role:'assistant',content:'部分回答',streaming:true,toolEvents:[{name:'notes_search',status:'running'}]}]});
assert.equal(interrupted.messages[0].status,'stopped');assert.equal(interrupted.messages[0].toolEvents[0].status,'stopped');
const run=createChatRun('one','workspace');assert.doesNotThrow(()=>run.assertActive('workspace'));assert.throws(()=>run.assertActive('other'),{name:'AbortError'});run.stop();assert.throws(()=>run.assertActive('workspace'),{name:'AbortError'});
// Run actual upstream decoder against every possible split, including split CRLF,
// multiline data, comment heartbeats, BOM, UTF-8 Chinese and bare CR boundaries.
const input=': heartbeat\r\nevent: delta\r\nid: 7\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\nevent: done\rdata: {}\r\r';
const decode=parts=>{const decoder=new ServerSentEventDecoder();return [...parts.flatMap(s=>decoder.push(s)),...decoder.end()]};
const expected=decode([input]);assert.equal(expected.length,2);assert.equal(expected[0].data,'{"text":\n"中文"}');
for(let offset=0;offset<input.length;offset++)assert.deepEqual(decode([input.slice(0,offset),input.slice(offset)]),expected);
assert.equal(decode(['data: incomplete']).length,0);
const bytes=new TextEncoder().encode('\uFEFF'+input);
const stream=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close()}});
const events=[];for await(const event of readServerSentEvents(stream))events.push(event);assert.deepEqual(events,expected);
let cancelled=false;
const openStream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: first\n\n'))},cancel(){cancelled=true}});
for await(const event of readServerSentEvents(openStream)){assert.equal(event.data,'first');break}assert.ok(cancelled,'Early exit cancels the reader');
console.log('Chat context, interrupted recovery, run ownership and upstream SSE fragmentation/cancellation OK');

assert.equal(normalizeChatTitle('标题：“项目计划”'),'项目计划');
assert.equal(normalizeChatTitle('<tool_call>'), '');
assert.equal(normalizeChatTitle('```json\n{}\n```'), '');
assert.equal(normalizeChatTitle('标题'.repeat(100)),'');
assert.ok(chatTitleMessages([{role:'user',content:'u'.repeat(4000)},{role:'assistant',content:'a'.repeat(4000)}]).every(m=>m.content.length<=2000));

// Prefer meaningful titles over strict word counts. Existing names stay unchanged.
assert.equal(normalizeChatTitle('## “近期笔记整理”'),'近期笔记整理');
assert.equal(normalizeChatTitle('OpenAI API 配置'),'OpenAI API 配置');
assert.equal(normalizeChatTitle('Build a concise useful project planning guide'),'Build a concise useful project planning guide');
assert.equal(normalizeChatTitle('标题：输入框交互。'),'输入框交互');
assert.ok(Array.from(fallbackChatTitle('请帮我总结当前工作区最近的内容，并列出重点和待办')).length<=28);
const manualName='这是用户自己指定的完整长标题，不能擅自修改';
assert.equal(recoverChatSession({title:manualName,titleSource:'manual',messages:[]}).title,manualName);
assert.equal(recoverChatSession({title:manualName,titleSource:'ai',messages:[]}).title,manualName);

// The same history is packed differently by model and override, regardless of locale.
const longHistory=Array.from({length:120},(_,i)=>({role:i%2?'assistant':'user',content:'第'+i+'条消息 '+('原始对话内容 '.repeat(260))}));
const auto128=buildCloudChatContext(longHistory,{provider:'openai',model:'gpt-4o-2024-08-06'});
const manual256=buildCloudChatContext(longHistory,{provider:'custom',model:'gpt-4o',windowOverride:256000});
const auto1m=buildCloudChatContext(longHistory,{provider:'openai',model:'gpt-4.1-mini'});
assert.equal(auto128.window,128000);assert.equal(auto128.compressed,true);
assert.equal(manual256.window,256000);assert.ok(manual256.omitted<auto128.omitted);
assert.ok(auto1m.window>=1000000);assert.deepEqual(auto1m.messages,longHistory);
const unknown=buildCloudChatContext(longHistory,{provider:'custom',model:'gpt-4o',windowOverride:9999999});
assert.equal(unknown.window,0);assert.equal(unknown.budget,48000);
const continuation='继续上次已确认的任务。';
const withTools=buildCloudChatContext(longHistory,{provider:'openai',model:'gpt-4o',imageCount:2,externalTools:true,continuation});
assert.ok(withTools.budget<auto128.budget);assert.ok(withTools.used<=withTools.budget);assert.equal(withTools.messages.at(-1).content,continuation);
const current='当前最重要的要求'.repeat(9000);
const oversized=buildCloudChatContext([...longHistory,{role:'user',content:current}],{provider:'openai',model:'gpt-4o'});
assert.equal(oversized.messages.at(-1).content,current);
const denseWire=buildCloudChatContext([{role:'user',content:'a'.repeat(3000000)+String.fromCharCode(0).repeat(1000000)}],{windowOverride:1050000});
assert.ok(denseWire.messages.at(-1).content.length<=AI_CHAT_MAX_TEXT_CHARS);
assert.ok(denseWire.messages.length<=AI_CHAT_MAX_MESSAGES);
assert.ok(Buffer.byteLength(JSON.stringify({messages:denseWire.messages,attachments:[{data:'A'.repeat(300000)},{data:'A'.repeat(300000)},{data:'A'.repeat(300000)}]}))<AI_CHAT_MAX_BODY_BYTES);

const local=new Map([['old-space',JSON.stringify([{id:'existing',messages:history}])]]);
const storage={getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
const indexedDB=new IDBFactory();
const store=createChatSessionStore(indexedDB,storage);
assert.deepEqual(await store.load('old-space'),[{id:'existing',messages:history}]);
assert.equal(local.has('old-space'),false,'Legacy storage is removed only after migration');
const largerThanLocalStorage=[{id:'long',messages:[{role:'user',content:'a'.repeat(5500000)}]}];
await store.save('new-space',largerThanLocalStorage);
const reloaded=createChatSessionStore(indexedDB,storage);
assert.deepEqual(await reloaded.load('new-space'),largerThanLocalStorage);
assert.deepEqual(await reloaded.load('old-space'),[{id:'existing',messages:history}]);
