import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {fixture} from './document-test.mjs';
const dom=new JSDOM('<!doctype html><body><div id="editor"></div></body>',{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true});
dom.window.TextEncoder=TextEncoder;dom.window.eval(readFileSync('app/src/main/assets/editor.js','utf8'));
const R=dom.window.RichNotes;let saved;const rich=R.create(dom.window.document.getElementById('editor'),v=>saved=v,()=>{});
rich.load(fixture);const value=rich.value();assert.equal(R.plain(value),R.plain(fixture));assert.equal(rich.tasks().total,2);assert.equal(rich.tasks().done,1);
// ProseMirror normalizes default attributes; loading serialized editor output must be stable.
rich.load(JSON.parse(R.serialize(value)));assert.deepEqual(rich.value(),value);
for(const type of ['bold','italic','underline','strike','highlight','textColor','link','code'])assert.ok(JSON.stringify(value).includes('"type":"'+type+'"'));
assert.throws(()=>rich.load('<p>unsupported</p>'));assert.deepEqual(rich.value(),value);
rich.editor.commands.setTextSelection(2);rich.editor.commands.insertContent('输入');assert.ok(saved.doc);assert.ok(!('body' in saved));
rich.attachment('c'.repeat(64),'文件.pdf','application/pdf',123);assert.ok(R.assetRefs(rich.value()).has('c'.repeat(64)));
const clean=R.sanitize('<p onclick="x">safe<script>alert(1)</script><a href="javascript:x">bad</a></p>');assert.ok(!/onclick|<script|javascript:/.test(clean));rich.editor.destroy();dom.window.close();
const page=new JSDOM(readFileSync('app/src/main/assets/index.html','utf8'),{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true});
page.window.TextEncoder=TextEncoder;page.window.indexedDB=indexedDB;page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};page.window.HTMLDialogElement.prototype.close=function(){this.open=false};page.window.scrollTo=()=>{};Object.defineProperty(page.window,'crypto',{value:crypto});Object.defineProperty(page.window.navigator,'onLine',{value:false});page.window.eval(readFileSync('app/src/main/assets/editor.js','utf8'));page.window.eval(readFileSync('app/src/main/assets/index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);
// Wait for app readiness, then use the actual save/flush completion. Fixed 100ms
// sleeps race module loading and IndexedDB on shared CI runners.
const deadline=Date.now()+5000;
while(!page.window.easybookRich||typeof page.window.document.getElementById('newTop').onclick!=='function'){assert.ok(Date.now()<deadline,'app boots within 5s');await new Promise(r=>setTimeout(r,10))}
page.window.document.getElementById('newTop').click();page.window.easybookRich.editor.commands.insertContent('离线保存');page.window.easybookRich.flushInput();await page.window.document.getElementById('done').onclick();
const {WebStore}=await import('../shared/web-store.mjs');const store=new WebStore(indexedDB);await store.open();const data=await store.load(page.window.localStorage.getItem('easybook-key'));assert.ok(R.plain(data.notes[0].document).includes('离线保存'));assert.equal(data.notes[0].dirty,true);assert.equal(data.notes[0].body,undefined);page.window.close();store.db.close();
console.log('PASS editor: all nodes/marks stable JSON restore, invalid load keeps document, tasks/media, paste safety, app offline IndexedDB save');

