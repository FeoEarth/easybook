import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';
const indexedDB=new IDBFactory(),store=new WebStore(indexedDB);await store.open();
const key='a'.repeat(64),a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID();
const empty={schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}};
const notes=[0,1,2,3].map((i)=>({id:crypto.randomUUID(),title:'笔记'+i,document:empty,folder_id:'',icon:'📄',favorite:0,pinned:i<2?1:0,deleted:0,version:1,mutation:crypto.randomUUID(),updated:100-i,dirty:false}));
await store.load(key);await store.save(key,{notes,folders:[a,b,c].map((id,i)=>({id,name:'文件夹'+i,updated:1,deleted:0})),inflight:{},cursor:0});
const html=readFileSync('app/src/main/assets/index.html','utf8'),dom=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.localStorage.setItem('easybook-key',key);w.TextEncoder=TextEncoder;w.indexedDB=indexedDB;w.scrollTo=w.scrollBy=()=>{};Object.defineProperty(w,'crypto',{value:crypto});Object.defineProperty(w.navigator,'onLine',{value:false});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const wait=()=>new Promise(r=>setTimeout(r,60));await wait();const $=id=>w.document.getElementById(id);
try{
 $('foldersButton').click();await wait();assert.equal(w.document.querySelector('[data-manage-folder]'),null);
 let row=()=>w.document.querySelector('[data-folder-id="'+b+'"] button');row().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}));await wait();assert.equal(w.document.querySelector('[data-folder-id="'+b+'"]').dataset.depth,'1');
 row().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ContextMenu',bubbles:true}));assert.equal($('folderMenu').open,true);assert.match($('folderMenu').textContent,/移动文件夹/);$('folderMenu').close();
 row().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}));await wait();assert.equal(w.document.querySelector('[data-folder-id="'+b+'"]').dataset.depth,'0');
 // Actual pointer handlers: hold/release opens menu; hold/move nests and cancels clicks.
 const pointer=(el,type,x,y)=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(e,{isPrimary:{value:true},pointerId:{value:1}});el.dispatchEvent(e)};
 pointer(row(),'pointerdown',20,20);await new Promise(r=>setTimeout(r,450));pointer(row(),'pointerup',20,20);assert.equal($('folderMenu').open,true);$('folderMenu').close();
 const target=w.document.querySelector('[data-folder-id="'+a+'"]');target.getBoundingClientRect=()=>({top:50,bottom:110,left:0,width:300,height:60});w.document.elementFromPoint=()=>target;
 pointer(row(),'pointerdown',20,20);await new Promise(r=>setTimeout(r,450));pointer(row(),'pointermove',80,80);await wait();assert.ok(w.document.querySelector('.placement-ghost'));pointer(row(),'pointerup',80,80);await wait();assert.equal(w.document.querySelector('[data-folder-id="'+b+'"]').dataset.depth,'1');assert.equal(w.document.body.dataset.page,'folders');
 $('foldersButton').hidden=false;w.document.querySelector('[data-tab="all"]').click();await wait();$('noteSort').value='custom';$('noteSort').dispatchEvent(new w.Event('change'));await wait();
 const card=()=>w.document.querySelector('.note[data-id="'+notes[1].id+'"]');card().dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));await wait();let ids=[...w.document.querySelectorAll('.note[data-id]')].map(el=>el.dataset.id);assert.equal(ids[0],notes[1].id);assert.deepEqual(ids.slice(2),notes.slice(2).map(n=>n.id));
 $('viewToggle').click();await wait();assert.deepEqual([...w.document.querySelectorAll('.note[data-id]')].map(el=>el.dataset.id),ids,'list/gallery parity');
 await store.load(key);const persisted=await store.load(key);assert.ok(persisted.management.pending.length>=7);assert.deepEqual(persisted.notes.map(n=>[n.id,n.document,n.pinned,n.mutation]),notes.map(n=>[n.id,n.document,n.pinned,n.mutation]));
 // Simulate old Web client replacing its known workspace fields: metadata has a separate key.
 const legacy=new WebStore(indexedDB);await legacy.open();await legacy.load(key);await legacy.save(key,{notes,folders:persisted.folders,inflight:{},cursor:0});assert.deepEqual((await legacy.load(key)).management,persisted.management);
 console.log('PASS placement UI/storage: no folder ellipsis, keyboard nest/promote/menu, separate pinned sorting, list/gallery parity, persistent pending ops, unchanged content/flags, old Web snapshot isolation');
}finally{w.close();store.db.close()}
