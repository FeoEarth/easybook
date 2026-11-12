import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';

const html=await readFile('app/src/main/assets/index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
const source=scripts.find(script=>script.includes("const STORAGE='easybook-language'"));
assert.ok(source,'runtime localization script is present');

const dom=new JSDOM(`<!doctype html><html lang="zh-CN"><body>
  <button id="settingsButton" aria-label="设置">设置</button>
  <div contenteditable="true"><p>保存</p></div>
  <div class="ProseMirror" contenteditable="false"><p>删除</p></div>
  <span translate="no" title="设置">设置</span><pre><code>删除</code></pre>
  <section id="settingsCategory-appearance">
    <div class="settings-label">外观</div><div class="settings-group"><span>颜色模式</span></div>
  </section>
</body></html>`,{url:'https://easybook.test/',runScripts:'outside-only'});
Object.defineProperty(dom.window.navigator,'language',{configurable:true,value:'en-US'});
dom.window.eval(source);
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
await new Promise(resolve=>dom.window.setTimeout(resolve,0));

const {document,EasybookI18n}=dom.window;
assert.equal(document.documentElement.lang,'en');
assert.equal(document.getElementById('settingsButton').textContent,'Settings');
assert.equal(document.getElementById('settingsButton').getAttribute('aria-label'),'Settings');
assert.equal(document.getElementById('languageSelect').value,'auto');
assert.equal(document.querySelector('[contenteditable="true"] p').textContent,'保存');
assert.equal(document.querySelector('.ProseMirror p').textContent,'删除');
assert.equal(document.querySelector('[translate="no"]').textContent,'设置');
assert.equal(document.querySelector('[translate="no"]').title,'设置');
assert.equal(document.querySelector('code').textContent,'删除');
assert.equal(EasybookI18n.translate('constructor'),'constructor');

const dynamic=document.createElement('p');
dynamic.textContent='同步活动';
document.body.append(dynamic);
await new Promise(resolve=>dom.window.setTimeout(resolve,0));
assert.equal(dynamic.textContent,'Sync Activity');

// Reused labels and attributes must follow application updates, including English.
dynamic.firstChild.data='Custom status';
const button=document.getElementById('settingsButton');
button.firstChild.data='Custom action';
button.setAttribute('aria-label','Custom label');
await new Promise(resolve=>dom.window.setTimeout(resolve,0));
assert.equal(dynamic.textContent,'Custom status');
assert.equal(button.textContent,'Custom action');
assert.equal(button.getAttribute('aria-label'),'Custom label');
button.firstChild.data='设置';
button.setAttribute('aria-label','设置');
dynamic.firstChild.data='同步活动';
await new Promise(resolve=>dom.window.setTimeout(resolve,0));
assert.equal(button.textContent,'Settings');

assert.equal(EasybookI18n.set('zh-CN'),true);
assert.equal(document.documentElement.lang,'zh-CN');
assert.equal(document.getElementById('settingsButton').textContent,'设置');
assert.equal(dynamic.textContent,'同步活动');
assert.equal(document.getElementById('languageSelect').value,'zh-CN');
assert.equal(EasybookI18n.set('unsupported'),false);

dom.window.close();

// Run the actual editor and save path with localization active: neither the
// editor's mutation observer nor the list preview may translate user content.
const app=new JSDOM(html,{url:'https://easybook.test/',runScripts:'outside-only',pretendToBeVisual:true});
app.window.TextEncoder=TextEncoder;app.window.indexedDB=indexedDB;
Object.defineProperty(app.window,'crypto',{value:crypto});
Object.defineProperty(app.window.navigator,'language',{value:'en-US'});
Object.defineProperty(app.window.navigator,'onLine',{value:false});
app.window.scrollTo=()=>{};
app.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
app.window.HTMLDialogElement.prototype.close=function(){this.open=false};
let store;
try{
  app.window.eval(await readFile('app/src/main/assets/editor.js','utf8'));
  app.window.eval(scripts.find(script=>script.includes('const webStore=')));
  app.window.eval(source);
  const deadline=Date.now()+5000;
  while(typeof app.window.document.getElementById('newTop').onclick!=='function'){
    assert.ok(Date.now()<deadline,'localized app boots');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const doc=app.window.document;
  doc.getElementById('newTop').click();
  doc.getElementById('title').value='设置';
  doc.getElementById('title').dispatchEvent(new app.window.Event('input'));
  app.window.easybookRich.editor.commands.insertContent('保存');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(app.window.easybookRich.plain(),'保存');
  await doc.getElementById('done').onclick();
  doc.getElementById('back').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(doc.querySelector('#cards .note>strong').textContent,'设置');
  assert.equal(doc.querySelector('#cards .excerpt').textContent,'保存');
  assert.equal(doc.querySelector('#cards .note').getAttribute('aria-label'),'设置');
  app.window.EasybookI18n.set('zh-CN');app.window.EasybookI18n.set('en');
  assert.equal(app.window.easybookRich.plain(),'保存');
  store=new WebStore(indexedDB);await store.open();
  const saved=await store.load(await store.activeCredential());
  assert.equal(saved.notes[0].title,'设置');
  assert.equal(app.window.RichNotes.plain(saved.notes[0].document),'保存');
}finally{app.window.close();store?.db.close()}
console.log('PASS i18n: language switching, dynamic labels, editor/user text protection, and unchanged offline save');
