import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const workerCode=readFileSync('app/src/main/assets/agent-sandbox-worker.js','utf8');
new vm.Script(workerCode);
const html=readFileSync('app/src/main/assets/index.html','utf8');
new vm.Script(html.split('<script>')[1].split('</script>')[0]);
const source=readFileSync('shared/local-ai-protocol.mjs','utf8');
const java=readFileSync('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8');
const client=readFileSync('app/src/main/assets/agent-sandbox-client.mjs','utf8');
assert.match(java,/agent-sandbox\\.easybook\\.invalid/);
assert.match(client,/frameOrigin='https:\\/\\/agent-sandbox\\.easybook\\.invalid'/);
assert.doesNotMatch(client,/new Worker\\('/,'main app origin must not create code execution worker');
assert.match(source,/sandbox_execute/);
assert.match(readFileSync('worker/ai.mjs','utf8'),/localSandbox: true|localSandbox:true/);
assert.match(readFileSync('mcp-oauth/src/index.mjs','utf8'),/localSandbox:input.localSandbox===true/);

async function run(code,files={}){
 const events=[],self={postMessage:e=>events.push(e)};
 vm.runInNewContext(workerCode,{self,Map,Promise,Object,JSON,String,Array,Error,Number,RegExp,TextEncoder});
 await self.onmessage({data:{type:'execute',id:'test',code,files}});
 return events;
}
let events=await run("sandbox.writeFile('report/output.txt','ok');print('completed');return sandbox.readFile('report/output.txt')");
assert.equal(events.at(-1).ok,true);
assert.equal(events.at(-1).files['report/output.txt'],'ok');
assert.equal(events.at(-1).output,'completed');
assert.equal(events.at(-1).value,'ok');
events=await run("sandbox.writeFile('../private','bad')");
assert.equal(events.at(-1).ok,false,'path traversal must be rejected');
events=await run("sandbox.writeFile('huge.txt','a'.repeat(131073))");
assert.equal(events.at(-1).ok,false,'oversized files must be rejected');
events=await run("sandbox.writeFile('unicode.txt','你'.repeat(50000))");
assert.equal(events.at(-1).ok,false,'UTF-8 byte quota must be enforced');
events=await run("return typeof NativeStore + ',' + typeof window");
assert.equal(events.at(-1).value,'undefined,undefined','worker must not inherit native bridge or DOM');
console.log('Agent sandbox worker boundaries and tool protocol OK');
