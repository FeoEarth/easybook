import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';

const indexedDB=new IDBFactory(),store=new WebStore(indexedDB);await store.open();
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),doc=(a,b)=>({schemaVersion:1,doc:{type:'doc',content:[paragraph(a),paragraph(b)]}}),base={id:crypto.randomUUID(),title:'标题',document:doc('A','B'),icon:'📄',pinned:0,favorite:0,deleted:0,purged:0,folder_id:'',version:4,mutation:crypto.randomUUID(),updated:1};
const sourceKey='a'.repeat(64),targetKey='b'.repeat(64),emptyKey='c'.repeat(64);
const sourceConflict={id:crypto.randomUUID(),sourceId:base.id,copyId:base.id,status:'open'},targetNote={...base,id:crypto.randomUUID(),title:'目标空间笔记'},legacyNote={...base,id:crypto.randomUUID(),title:'旧版已同步笔记'},targetConflict={...sourceConflict,id:crypto.randomUUID(),sourceId:targetNote.id,copyId:targetNote.id};
const sourceData={notes:[base],folders:[],inflight:{},cursor:0,bases:{[base.id]:base},conflicts:[sourceConflict]},targetData={notes:[targetNote,legacyNote],folders:[],inflight:{},cursor:0,bases:{[targetNote.id]:targetNote},conflicts:[targetConflict]};
for(const [key,data]of [[sourceKey,sourceData],[targetKey,targetData]]){await store.load(key);await store.save(key,data)}
await store.setActiveCredential(sourceKey);

const html=readFileSync('app/src/main/assets/index.html','utf8'),page=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true});
page.window.TextEncoder=TextEncoder;page.window.indexedDB=indexedDB;page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};page.window.HTMLDialogElement.prototype.close=function(){this.open=false};page.window.scrollTo=()=>{};Object.defineProperty(page.window,'crypto',{value:crypto});Object.defineProperty(page.window.navigator,'onLine',{value:false});
page.window.eval(readFileSync('app/src/main/assets/editor.js','utf8'));page.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
async function waitFor(condition,message){const deadline=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<deadline,message);await new Promise(r=>setTimeout(r,10))}}
await waitFor(()=>page.window.easybookRich,'merge runtime boots');
let local={...base,title:'本机标题',document:doc('A 本机','B')},remote={...base,document:doc('A','B 云端'),version:5,mutation:crypto.randomUUID()};
let result=page.window.easybookThreeWayMerge(base,local,remote);assert.equal(result.merged.title,'本机标题');assert.equal(result.merged.document.doc.content[0].content[0].text,'A 本机');assert.equal(result.merged.document.doc.content[1].content[0].text,'B 云端');assert.equal(result.merged.version,5);assert.equal(result.merged.dirty,true);
remote={...remote,document:doc('A 云端','B')};assert.equal(page.window.easybookThreeWayMerge(base,local,remote),null,'overlapping paragraph edits stay explicit conflicts');
remote={...remote,purged:1};assert.equal(page.window.easybookThreeWayMerge(base,local,remote).terminal.purged,1,'permanent deletion remains terminal');

async function switchWorkspace(key){
 const get=id=>page.window.document.getElementById(id);
 get('pairDialog').showModal();get('pairKey').value=key;await get('join').onclick();
 assert.equal(get('confirmDialog').open,true);get('confirmAccept').click();
 await waitFor(async()=>await store.activeCredential()===key&&!get('pairDialog').open,'workspace switch completes');
 const previous=(await store.load(key)).revision||0;page.window.persistNow();
 await waitFor(async()=>(await store.load(key)).revision>previous,'new workspace snapshot is saved');
 return store.load(key);
}
let saved=await switchWorkspace(targetKey);
assert.deepEqual(saved.conflicts,[targetConflict],'switch restores the target workspace conflict records');
assert.deepEqual(saved.bases,{[targetNote.id]:targetNote,[legacyNote.id]:legacyNote},'switch restores target merge bases and seeds synced legacy notes');
assert.equal(page.window.document.querySelector('#conflictCenterList [data-conflict]').dataset.conflict,targetConflict.id,'conflict center refreshes to the target workspace');
saved=await switchWorkspace(emptyKey);
assert.deepEqual(saved.bases,{},'new workspace starts with no merge bases from the previous workspace');
assert.deepEqual(saved.conflicts,[],'new workspace starts with no conflicts from the previous workspace');
assert.equal(page.window.document.getElementById('conflictCenterOpen').hidden,true);
assert.deepEqual((await store.load(sourceKey)).conflicts,[sourceConflict],'switch preserves source workspace conflicts');
assert.deepEqual((await store.load(sourceKey)).bases,sourceData.bases,'switch preserves source workspace merge bases');
page.window.close();store.db.close();console.log('PASS note merge: independent fields/nodes merge, overlaps remain conflicts, purge stays terminal; workspace switches preserve isolated merge bases and conflicts.');
