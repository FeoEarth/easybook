import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('app/src/main/assets/index.html','utf8');
for(const native of [false,true]){
 const dom=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let online=false,fail=false,calls=0;const state={key:'a'.repeat(64),notes:[],folders:[{id:crypto.randomUUID(),name:'Pending',dirty:true,updated:1}]};
 w.TextEncoder=TextEncoder;w.indexedDB=indexedDB;w.scrollTo=w.scrollBy=()=>{};Object.defineProperty(w,'crypto',{value:crypto});Object.defineProperty(w.navigator,'onLine',{get:()=>online});w.HTMLDialogElement.prototype.close=function(){this.open=false};
 if(native)w.NativeStore={async call(m){if(m==='bootstrap'||m==='snapshot')return structuredClone(state);if(m==='sync.activity')return {tasks:[{id:'folder:'+state.folders[0].id+':1',name:'Pending',kind:'folder',direction:'up',state:fail?'failed':state.folders[0].dirty?'queued':'done',updated:Date.now(),created:1,error:fail?'network':''}]};if(m==='sync'){calls++;if(fail)throw Error('network');state.folders[0].dirty=false;return structuredClone(state)}if(m==='search')return {notes:[]};return {}}};
 w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);const wait=()=>new Promise(r=>setTimeout(r,80));await wait();const $=id=>w.document.getElementById(id);
 try{
 $('foldersButton').click();$('folderSettings').click();$('activityEntry').click();assert.equal($('syncActivity').hidden,false);assert.equal($('home').hidden,true);assert.match($('syncOverall').textContent,/等待网络/);assert.equal($('syncNow').disabled,false);
 if(native){assert.match($('syncPending').textContent,/1 个文件夹/);online=true;w.easybookActivity.tasks=[];w.easybookActivity.success();await wait();assert.match($('syncOverall').textContent,/等待同步/);fail=true;$('syncNow').click();await wait();assert.equal($('syncNow').disabled,false);assert.match($('syncOverall').textContent,/等待重试/,'native sync failure remains retryable');fail=false;$('syncNow').click();await wait();assert.equal(calls,2);assert.equal($('syncNow').disabled,false);assert.match($('syncLastSuccess').textContent,/最近成功同步/);assert.doesNotMatch($('syncLastSuccess').textContent,/尚无/);assert.match($('syncPending').textContent,/0 个文件夹/);w.easybookActivity.set('folder:'+state.folders[0].id+':0','Old folder','folder','up','waiting');await wait();assert.ok(!w.easybookActivity.tasks.some(t=>t.id.endsWith(':0')));assert.doesNotMatch($('syncOverall').textContent,/等待同步/);w.handleBack();await wait();}
 else {w.history.back();await wait();assert.equal($('settings').hidden,false);w.history.forward();await wait();assert.equal($('syncActivity').hidden,false);$('syncBack').click();await wait();}
 assert.equal($('settings').hidden,false);assert.equal($('syncActivity').hidden,true);console.log('PASS sync activity '+(native?'native bridge: offline/failure/retry/success/counts/back':'web: full page/offline/browser back and forward'));
 }finally{w.easybookRich?.editor.destroy();w.close()}
}
