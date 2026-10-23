import MarkdownIt from 'markdown-it';
import {validateDocument} from '../shared/document.mjs';
const md=new MarkdownIt({html:false,linkify:false,breaks:false}).disable(['table']);
md.renderer.rules.image=(tokens,index)=>{const t=tokens[index];return '<a href="'+md.utils.escapeHtml(t.attrGet('src')||'')+'">'+md.utils.escapeHtml(t.content||'图片')+'</a>'};
export function markdownHTML(text){
 if(typeof text!=='string'||text.length>200000)throw Error('Markdown 超过容量限制');
 // HTML is literal text; remote images become links rather than untrusted media nodes.
 const html=md.render(text);
 const host=document.createElement('div');host.innerHTML=html;
 host.querySelectorAll('h4,h5,h6').forEach(n=>{const h=document.createElement('h3');h.innerHTML=n.innerHTML;n.replaceWith(h)});
 host.querySelectorAll('ul').forEach(ul=>{
  const items=[...ul.children];if(!items.length||!items.every(li=>/^\[[ xX]\] /.test((li.querySelector(':scope > p')||li).textContent)))return;
  ul.dataset.type='taskList';for(const li of items){const p=li.querySelector(':scope > p')||li;const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);const t=walker.nextNode();if(!t||!/^\[[ xX]\] /.test(t.textContent))continue;li.dataset.type='taskItem';li.dataset.checked=String(/^\[[xX]\]/.test(t.textContent));t.textContent=t.textContent.slice(4)}
 });return host.innerHTML;
}
const escape=s=>s.replace(/([\\`*_{}\[\]()#+.!|>~<\-])/g,'\\$1');
const fence=s=>'`'.repeat(Math.max(3,...(s.match(/`+/g)||[]).map(x=>x.length+1)));
export function exportMarkdown(value){
 validateDocument(value);const warnings=new Set();
 function inline(n){if(n.type==='hardBreak')return '  \n';if(n.type!=='text')return '';let s=escape(n.text);const marks=n.marks||[];
  if(marks.some(m=>m.type==='code')){const ticks='`'.repeat(Math.max(1,...(n.text.match(/`+/g)||[]).map(x=>x.length+1)));const pad=/^`|`$|^ .* $/.test(n.text)?' ':'';s=ticks+pad+n.text.replace(/\n/g,' ')+pad+ticks;if(marks.length>1)warnings.add('行内代码内的其他样式在 Markdown 中省略');return s}
  for(const m of marks){if(m.type==='bold')s='**'+s+'**';else if(m.type==='italic')s='*'+s+'*';else if(m.type==='strike')s='~~'+s+'~~';else if(m.type==='link')s='['+s+']('+m.attrs.href.replace(/\(/g,'%28').replace(/\)/g,'%29')+')';else if(['underline','highlight','textColor'].includes(m.type))warnings.add('下划线、高亮和字体颜色导出为无对应样式的文本')}
  return s;
 }
 function block(n){const children=n.content||[],body=()=>children.map(inline).join('');switch(n.type){case 'doc':case 'blockquote':{const s=children.map(block).join('\n\n');return n.type==='blockquote'?s.split('\n').map(l=>'> '+l).join('\n'):s}case 'paragraph':return body();case 'heading':return '#'.repeat(n.attrs.level)+' '+body();case 'codeBlock':{const s=children.map(c=>c.text||'').join(''),f=fence(s);return f+(n.attrs?.language||'').replace(/[^\w+-]/g,'')+'\n'+s+'\n'+f}case 'horizontalRule':return '---';case 'bulletList':case 'orderedList':case 'taskList':return children.map((li,i)=>{const prefix=n.type==='orderedList'?((n.attrs?.start||1)+i)+'. ':n.type==='taskList'?'- ['+(li.attrs.checked?'x':' ')+'] ':'- ';const lines=(li.content||[]).map(block).join('\n\n').split('\n');return prefix+lines[0]+lines.slice(1).map(l=>'\n'+' '.repeat(n.type==='taskList'?2:prefix.length)+l).join('')}).join('\n');case 'image':case 'attachment':warnings.add('附件和图片仅导出名称，文件内容仍需 JSON 备份');return escape(n.attrs.name||n.attrs.alt||'图片');default:return children.map(block).join('\n\n')}}
 return {text:block(value.doc)+'\n',warnings:[...warnings]};
}
