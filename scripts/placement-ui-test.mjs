import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';
import * as Placement from '../shared/folder-placement.mjs';
const copy=x=>JSON.parse(JSON.stringify(x)),wait=()=>new Promise(r=>setTimeout(r,70));
const a=crypto.randomUUID(),b=crypto.randomUUID(),retired=crypto.randomUUID(),opId=crypto.randomUUID();
const html=readFileSync('app/src/main/assets/index.html','utf8'),editor=readFileSync('app/src/main/assets/editor.js','utf8');
const empty={schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}};
for(const native of [false,true]){
 const key=(native?'space:':'')+'a'.repeat(64),indexedDB=new IDBFactory(),store=new WebStore(indexedDB);await store.open();
 const state={key,notes:[{id:crypto.randomUUID(),title:'原始笔记',document:empty,folder_id:a,icon:'📄',favorite:0,pinned:1,deleted:0,version:1,mutation:crypto.randomUUID(),updated:1}],folders:[{id:a,name:'A',updated:1},{id:b,name:'B',updated:1}],management:{version:0,items:{['n:'+retired]:{rank:1}},pending:[{id:opId,key:'n:'+retired,parent:'',rank:2}]}};
 const original=copy(state.notes);await store.load(key);await store.save(key,{...state,inflight:{},cursor:0});let commits=0;
 async function open(){const dom=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.localStorage.setItem('easybook-key',key);w.localStorage.setItem('easybook-note-sort','custom');w.TextEncoder=TextEncoder;w.indexedDB=indexedDB;w.scrollTo=w.scrollBy=()=>{};Object.defineProperty(w,'crypto',{value:crypto});Object.defineProperty(w.navigator,'onLine',{value:false});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 if(native)w.NativeStore={async call(method,args){if(method==='bootstrap'||method==='snapshot'){state.management=Placement.clean(state.management);return copy(state)}if(method==='search')return {notes:copy(state.notes)};if(method==='commit'){assert.deepEqual(Object.keys(args.changes).sort(),['folders','notes','placements']);assert.equal(args.changes.notes.length,0);const ops=args.changes.placements.map(Placement.wire);commits++;state.management=Placement.clean(state.management);for(const op of ops)if(!state.management.pending.some(p=>p.id===op.id))state.management.pending.push(op);return {notes:[],folders:[],mappings:{},management:copy(state.management)}}return {}}};
 w.eval(editor);w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);await wait();return w;}
 let w=await open(),$=id=>w.document.getElementById(id);
 try{
 assert.equal($('noteSort'),null);assert.equal(w.localStorage.getItem('easybook-note-sort'),'updated');assert.equal(w.document.querySelector('[data-note-sort="custom"]'),null);
 $('listMore').click();assert.equal($('listDialog').open,true);assert.equal($('listDialog').querySelector('select'),null);$('listSortOpen').click();w.document.querySelector('[data-note-sort="title"]').click();assert.equal($('listDialog').open,false);assert.equal(w.document.querySelector('[data-note-sort="title"]').getAttribute('aria-checked'),'true');
 $('foldersButton').click();await wait();const row=()=>w.document.querySelector('[data-folder-id="'+b+'"] button');
 const pointer=(el,type,x,y)=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(e,{isPrimary:{value:true},pointerId:{value:1}});el.dispatchEvent(e)};
 const target=w.document.querySelector('[data-folder-id="'+a+'"]');target.getBoundingClientRect=()=>({top:50,bottom:110,left:0,width:300,height:60});w.document.elementFromPoint=()=>target;
 pointer(row(),'pointerdown',20,20);await new Promise(r=>setTimeout(r,450));pointer(row(),'pointermove',80,80);await wait();pointer(row(),'pointerup',80,80);await wait();if(native)await w.flushNative();
 assert.equal(w.document.querySelector('[data-folder-id="'+b+'"]').dataset.depth,'1');assert.doesNotMatch($('toastText').textContent,/保存失败|搜索暂未完成/);
 let persisted=native?copy(state):(await store.load(key));assert.deepEqual(persisted.notes,original);assert.ok(persisted.management.pending.length);assert.ok(persisted.management.pending.every(p=>p.key.startsWith('f:')));
 const wanted=copy(persisted.management);w.close();w=await open();$=id=>w.document.getElementById(id);$('foldersButton').click();await wait();assert.equal(w.document.querySelector('[data-folder-id="'+b+'"]').dataset.depth,'1');if(native)assert.ok(commits>0);
 assert.equal(wanted.pending.at(-1).parent,a);console.log('PASS '+(native?'native bridge contract mock':'Web IndexedDB')+': pointer drag/save, serialized restart order, retired note task repair, unchanged notes, direct sort menu; actual Android DB/device not exercised');
 }finally{w.close();store.db.close()}
}
const op={id:crypto.randomUUID(),key:'f:'+a,parent:'',rank:1};for(let i=0;i<3;i++)Placement.failure(op,0);assert.equal(op.blocked,true);assert.deepEqual(Object.keys(Placement.wire(op)),['id','key','parent','rank']);assert.equal(Placement.retry({pending:[op]}).pending[0].blocked,undefined);op.reason='invalid';assert.equal(Placement.retry({pending:[op]}).pending[0].blocked,true);
console.log('PASS persistent placement retry suspension and canonical wire payload');
