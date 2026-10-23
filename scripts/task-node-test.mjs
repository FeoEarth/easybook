import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const w=new JSDOM('<div id="editor"></div>',{runScripts:'outside-only',pretendToBeVisual:true}).window;
w.TextEncoder=TextEncoder;w.scrollBy=()=>{};w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));
const r=w.RichNotes.create(w.document.getElementById('editor'),()=>{},()=>{});
const item=text=>({type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',...(text?{content:[{type:'text',text}]}:{})}]});
const items=[item('第一项'),item('第二项'),item('第三项长文字'.repeat(20)),item('')];items[1].content.push({type:'taskList',content:[item('嵌套')]});items[0].content[0].content[0].marks=['bold','italic','underline','strike'].map(type=>({type})).concat([{type:'highlight',attrs:{color:'#fff1a8'}}]);
r.load({schemaVersion:1,doc:{type:'doc',content:[{type:'taskList',content:items}]}});
const css=readFileSync('app/src/main/assets/index.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1];const style=w.document.createElement('style');style.textContent=css;w.document.head.append(style);r.editor.view.dom.classList.add('rich-content');
const all=()=>[...w.document.querySelectorAll('li')];
assert.equal(all().length,5);for(const li of all()){assert.equal(li.dataset.type,'taskItem');assert.equal(w.getComputedStyle(li).display,'flex');assert.equal(w.getComputedStyle(li.children[1].firstChild).marginBottom,'0px');assert.equal(li.children[0].tagName,'LABEL');assert.equal(li.children[1].tagName,'DIV')}
const input=all()[0].querySelector('input');for(const checked of [true,false]){input.checked=checked;input.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(all()[0].dataset.checked,String(checked));assert.equal(all()[0].dataset.type,'taskItem')}
const saved=w.RichNotes.serialize(r.value());r.load(JSON.parse(saved));assert.equal(w.RichNotes.serialize(r.value()),saved);
const key=key=>{const event=new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});r.editor.view.dom.dispatchEvent(event)};
r.editor.commands.setTextSelection(r.editor.state.doc.content.size-3);r.editor.commands.insertContent('abc');key('Enter');assert.equal(all().length,6);key('Enter');assert.equal(all().length,5);assert.equal(r.editor.state.selection.$from.parent.type.name,'paragraph');assert.equal(r.editor.isActive('taskItem'),false);
r.command('toggleTaskList');assert.equal(all().length,6);key('Backspace');assert.equal(all().length,5);
console.log('PASS task nodes: live DOM attributes/structure, nested+empty items, combined marks, checkbox transactions, JSON reopen, actual Enter split/exit and Backspace exit');w.close();
