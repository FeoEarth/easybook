import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync('app/src/main/assets/index.html','utf8');
const listeners={},nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',hidden:false,dataset:{},textContent:'',classList:{toggle(){},remove(){}},setAttribute(){},replaceChildren(){this.innerHTML=''},querySelector(){return {setAttribute(){}}}});return nodes.get(id)};
const noop=()=>{};
const c=vm.createContext({console,Date,Map,Set,clearTimeout,cancelAnimationFrame:noop,document:{addEventListener(type,fn){(listeners[type]??=[]).push(fn)},body:{classList:{remove:noop}},querySelectorAll:()=>[]},$:node,tab:'folders',key:'space',current:null,renderSerial:0,moveBusy:false,searchEverywhere:false,visibleRows:[],selectedIds:new Set(),layout:'list',noteSort:'updated',lastListMarkup:'old',notes:[{id:'test',title:'Test',folder_id:'',deleted:0}],folders:[{id:'empty',name:'测试文件夹'}],activeFolders(){return c.folders},closeContext:noop,resetNoteGestures:noop,clearPlacementMarks:noop,placeFolder:noop,openFolderMenu:noop,toast:noop,compareNotes:()=>0,normalizeSearch:s=>s,RichNotes:{plain:()=>''},folderName:()=>'',mergeNative:noop,observeThumbnails:noop,updateSelection:noop,renderFolders:noop,dateGroup:()=>'',noteCard:()=>'',native:null,flushNative:async()=>{}});
vm.runInContext(html.slice(html.indexOf('function inCategory('),html.indexOf('function renderFolders(')),c);
vm.runInContext(html.slice(html.indexOf('async function renderList('),html.indexOf('function animatePage(')),c);
vm.runInContext(html.slice(html.indexOf('let placementDrag=null'),html.indexOf('function updatePlacementTarget(')),c);
const calls=[];c.switchTab=id=>{calls.push(id);c.tab=id};
const gesture=mode=>{c.mode=mode;vm.runInContext("placementDrag={id:'empty',el:{classList:{remove(){}}},mode};endPlacement()",c)};
const click=()=>{let stopped=false;for(const fn of listeners.click)fn({detail:1,preventDefault(){},stopImmediatePropagation(){stopped=true}});return stopped};
// The folder remains the pointerup target. Exactly one compatibility click owns navigation.
gesture('pending');assert.equal(c.tab,'folders');assert.equal(calls.length,0);assert(click());assert.deepEqual(calls,['folder:empty']);assert(!click());
// Long press, scrolling and dragging consume their click without opening a note or folder.
for(const mode of ['armed','scroll','drag']){c.tab='folders';gesture(mode);assert(click());assert.equal(c.tab,'folders')}
// A new physical gesture replaces ownership, without a time-based tap lockout.
c.tab='folders';gesture('pending');listeners.pointerdown[0]();assert(!click());gesture('pending');assert(click());
// A navigation/workspace change before click invalidates the old folder activation.
c.tab='folders';gesture('pending');c.key='other';assert(click());assert.equal(c.tab,'folders');c.key='space';
// Native result must still belong to this folder even if the bridge returns a root note.
c.tab='folder:empty';c.native={call:async()=>({notes:c.notes})};await c.renderList();assert.equal(c.visibleRows.length,0);assert.match(node('cards').innerHTML,/没有备忘录/);
// A response completing after immediate back cannot repopulate the new page.
let complete;c.native={call:()=>new Promise(resolve=>complete=resolve)};const pending=c.renderList();await new Promise(setImmediate);assert(complete);c.tab='folders';complete({notes:c.notes});await pending;assert.equal(c.visibleRows.length,0);
// Context is checked after flush too, before dispatching a native query.
let flush,queries=0;c.flushNative=()=>new Promise(resolve=>flush=resolve);c.native={call:async()=>{queries++;return {notes:c.notes}}};const waiting=c.renderList();c.tab='folder:empty';flush();await waiting;assert.equal(queries,0);
// Explicit global search continues to permit cross-folder results.
c.flushNative=async()=>{};c.native=null;c.tab='folder:empty';c.searchEverywhere=true;node('search').value='Test';await c.renderList();assert.equal(c.visibleRows.length,1);
// Exercise the actual card click handler: folder context blocks a stale root card,
// while an explicit global-search result still opens normally.
c.selecting=false;c.haptic=noop;c.toggleSelected=noop;const opened=[];c.openNote=id=>opened.push(id);vm.runInContext('const suppressedNoteClicks=new Map();'+html.slice(html.indexOf("$('cards').onclick=e=>")).split('\n')[0],c);
const cardEvent={target:{closest:selector=>selector==='.note[data-id]'?{dataset:{id:'test'}}:null},preventDefault(){}};
c.searchEverywhere=false;node('search').value='';node('cards').onclick(cardEvent);assert.equal(opened.length,0);c.searchEverywhere=true;node('search').value='Test';node('cards').onclick(cardEvent);assert.deepEqual(opened,['test']);
// Both shipped clients use exactly the same source; all inline scripts must parse.
const web=(await import('../worker/ui.mjs')).default;assert.equal(web,html);for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi))if(!/\bsrc\s*=/.test(m[1]))new vm.Script(m[2]);
console.log('PASS folder gesture ownership, drag/long press/scroll, rapid gestures, empty-folder scope, stale native responses, immediate back, global search, Android/Web parity and syntax');
