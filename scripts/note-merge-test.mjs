import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

const html=readFileSync('app/src/main/assets/index.html','utf8'),page=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true});
page.window.TextEncoder=TextEncoder;page.window.indexedDB=indexedDB;page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};page.window.HTMLDialogElement.prototype.close=function(){this.open=false};page.window.scrollTo=()=>{};Object.defineProperty(page.window,'crypto',{value:crypto});Object.defineProperty(page.window.navigator,'onLine',{value:false});
page.window.eval(readFileSync('app/src/main/assets/editor.js','utf8'));page.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const deadline=Date.now()+5000;while(typeof page.window.easybookThreeWayMerge!=='function'){assert.ok(Date.now()<deadline,'merge runtime boots');await new Promise(r=>setTimeout(r,10))}
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),doc=(a,b)=>({schemaVersion:1,doc:{type:'doc',content:[paragraph(a),paragraph(b)]}}),base={id:crypto.randomUUID(),title:'标题',document:doc('A','B'),icon:'📄',pinned:0,favorite:0,deleted:0,purged:0,folder_id:'',version:4,mutation:crypto.randomUUID(),updated:1};
let local={...base,title:'本机标题',document:doc('A 本机','B')},remote={...base,document:doc('A','B 云端'),version:5,mutation:crypto.randomUUID()};
let result=page.window.easybookThreeWayMerge(base,local,remote);assert.equal(result.merged.title,'本机标题');assert.equal(result.merged.document.doc.content[0].content[0].text,'A 本机');assert.equal(result.merged.document.doc.content[1].content[0].text,'B 云端');assert.equal(result.merged.version,5);assert.equal(result.merged.dirty,true);
remote={...remote,document:doc('A 云端','B')};assert.equal(page.window.easybookThreeWayMerge(base,local,remote),null,'overlapping paragraph edits stay explicit conflicts');
remote={...remote,purged:1};assert.equal(page.window.easybookThreeWayMerge(base,local,remote).terminal.purged,1,'permanent deletion remains terminal');
page.window.close();console.log('PASS note merge: independent fields/nodes merge, overlaps remain conflicts, purge stays terminal.');
