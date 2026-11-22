import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the Android WebView stream bridge directly, not a mocked Web fetch.
// NativeAccount passes the full SSE "done" JSON object as event.result.
const html=readFileSync('app/src/main/assets/index.html','utf8');
const start=html.indexOf('const aiNativeStreams=new Map();');
const end=html.indexOf('async function refreshAiPreferences()',start);
assert.ok(start>=0&&end>start,'Android SSE bridge implementation found');
const window={},calls=[];
const native={call:async(method,args)=>{calls.push({method,args});return {accepted:true}}};
const scope={window,native,workspaceCurrent:'f'.repeat(64),uuid:()=> 'f3f6c03d-1144-4444-8888-000000000001',aiErrorMessage:code=>code};
runInNewContext(html.slice(start,end)+'\nthis.requestForTest=aiStreamRequest;',scope);
const response=scope.requestForTest({credentialId:'fixture',messages:[{role:'user',content:'Search two topics'}],mode:'agent'},{
 onTool(){throw Error('Unexpected tool event')},
});
assert.equal(calls.length,1);
assert.equal(calls[0].method,'ai.stream.start');
const checkpoint={message:{role:'assistant',content:'Completed two searches'},webSearches:[
 {arguments:{query:'first'},result:{results:[{title:'First',url:'https://example.org/first'}]}},
 {arguments:{query:'second'},result:{results:[{title:'Second',url:'https://example.org/second'}]}}
],partial:true,continuationRequired:true};
window.easybookByokEvent({id:calls[0].args.id,type:'done',result:checkpoint});
const result=await response;
assert.equal(result.continuationRequired,true,'Android must preserve continuationRequired from SSE');
assert.equal(result.webSearches.length,2);
assert.equal(result.message.content,'Completed two searches');
console.log('PASS Android SSE bridge preserves continuation markers and search receipts');
