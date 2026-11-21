import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const workerCode=readFileSync('app/src/main/assets/agent-sandbox-worker.js','utf8');
new vm.Script(workerCode);
new vm.Script(readFileSync('app/src/main/assets/index.html','utf8').match(/<script>([\\s\\S]*?)<\\/script>/)[1]);
const source=readFileSync('shared/local-ai-protocol.mjs','utf8');
assert.match(source,/sandbox_execute/);
assert.match(readFileSync('worker/ai.mjs','utf8'),/localSandbox: true|localSandbox:true/);
assert.match(readFileSync('mcp-oauth/src/index.mjs','utf8'),/localSandbox:input.localSandbox===true/);

async function run(code,files={}){
 const events=[],self={postMessage:e=>events.push(e)};
 vm.runInNewContext(workerCode,{self,Map,Promise,Object,JSON,String,Array,Error,Number,RegExp});
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
events=await run("return typeof NativeStore + ',' + typeof window");
assert.equal(events.at(-1).value,'undefined,undefined','worker must not inherit native bridge or DOM');
console.log('Agent sandbox worker boundaries and tool protocol OK');
