import assert from 'node:assert/strict';
import {normalizeChatTitle,chatTitleMessages,buildChatContext,recoverChatSession,createChatRun,ServerSentEventDecoder,readServerSentEvents} from '../shared/ai-chat.mjs';
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
assert.equal(Array.from(normalizeChatTitle('标题'.repeat(100))).length,40);
assert.ok(chatTitleMessages([{role:'user',content:'u'.repeat(4000)},{role:'assistant',content:'a'.repeat(4000)}]).every(m=>m.content.length<=2000));
