import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('app/src/main/assets/index.html','utf8');
for(const native of [false,true]){
 const dom=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let online=false,fail=false,calls=0;const state={key:'a'.repeat(64),notes:[],folders:[{id:crypto.randomUUID(),name:'Pending',dirty:true,updated:1}]};
 w.TextEncoder=TextEncoder;w.indexedDB=indexedDB;w.scrollTo=w.scrollBy=()=>{};Object.defineProperty(w,'crypto',{value:crypto});Object.defineProperty(w.navigator,'onLine',{get:()=>online});w.HTMLDialogElement.prototype.close=function(){this.open=false};
 if(native)w.NativeStore={async call(m){if(m==='bootstrap'||m==='snapshot')return structuredClone(state);if(m==='sync'){calls++;if(fail)throw Error('network');state.folders[0].dirty=false;return structuredClone(state)}if(m==='search')return {notes:[]};return {}}};
 w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);const wait=()=>new Promise(r=>setTimeout(r,80));await wait();const $=id=>w.document.getElementById(id);
 try{
 $('openSyncActivity').click();assert.equal($('syncActivityPage').hidden,false);assert.equal($('home').hidden,true);assert.match($('syncActivityState').textContent,/离线/);assert.equal($('syncActivityNow').disabled,false);
 if(native){assert.match($('syncActivityPending').textContent,/1 个文件夹/);online=true;fail=true;$('syncActivityNow').click();await wait();assert.equal($('syncActivityNow').disabled,false);assert.match($('syncActivityState').textContent,/未连接/);fail=false;$('syncActivityNow').click();await wait();assert.equal(calls,2);assert.equal($('syncActivityNow').disabled,false);assert.match($('syncActivityUpdated').textContent,/最近同步：/);assert.doesNotMatch($('syncActivityUpdated').textContent,/尚无/);assert.match($('syncActivityPending').textContent,/0 个文件夹/);w.handleBack();}
 else {w.history.back();await wait();assert.equal($('settings').hidden,false);w.history.forward();await wait();assert.equal($('syncActivityPage').hidden,false);$('syncActivityBack').click();await wait();}
 assert.equal($('settings').hidden,false);assert.equal($('syncActivityPage').hidden,true);console.log('PASS sync activity '+(native?'native bridge: offline/failure/retry/success/counts/back':'web: full page/offline/browser back and forward'));
 }finally{w.easybookRich?.editor.destroy();w.close()}
}
