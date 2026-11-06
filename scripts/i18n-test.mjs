import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const html=await readFile('app/src/main/assets/index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
const source=scripts.find(script=>script.includes("const STORAGE='easybook-language'"));
assert.ok(source,'runtime localization script is present');

const dom=new JSDOM(`<!doctype html><html lang="zh-CN"><body>
  <button id="settingsButton" aria-label="设置">设置</button>
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

const dynamic=document.createElement('p');
dynamic.textContent='同步活动';
document.body.append(dynamic);
await new Promise(resolve=>dom.window.setTimeout(resolve,0));
assert.equal(dynamic.textContent,'Sync Activity');

assert.equal(EasybookI18n.set('zh-CN'),true);
assert.equal(document.documentElement.lang,'zh-CN');
assert.equal(document.getElementById('settingsButton').textContent,'设置');
assert.equal(dynamic.textContent,'同步活动');
assert.equal(document.getElementById('languageSelect').value,'zh-CN');
assert.equal(EasybookI18n.set('unsupported'),false);

dom.window.close();
console.log('Runtime localization, dynamic content, attributes, and language switching verified');
