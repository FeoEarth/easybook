import {JSDOM} from 'jsdom';
import {createCanvas,DOMMatrix,Path2D,ImageData} from '@napi-rs/canvas';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dom=new JSDOM('<dialog open id="dialog"><div id="stage"></div></dialog>',{url:'https://appassets.androidplatform.net/',pretendToBeVisual:true});
for(const k of ['window','document','navigator','HTMLElement','HTMLDivElement','HTMLButtonElement','HTMLCanvasElement','Element','Node','MutationObserver','getComputedStyle','localStorage','location'])Object.defineProperty(globalThis,k,{value:k==='getComputedStyle'?dom.window[k].bind(dom.window):dom.window[k],configurable:true});
Object.assign(globalThis,{DOMMatrix,Path2D,ImageData,AbortController:dom.window.AbortController,AbortSignal:dom.window.AbortSignal,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
window.matchMedia=globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.ResizeObserver=class {observe(){}unobserve(){}disconnect(){}};
window.HTMLElement.prototype.scrollTo=function(x,y){this.scrollLeft=x;this.scrollTop=y};window.HTMLElement.prototype.scrollBy=function(){};
Object.defineProperties(window.HTMLElement.prototype,{clientWidth:{get(){return 390}},clientHeight:{get(){return 700}},offsetWidth:{get(){return 390}},offsetHeight:{get(){return this.classList.contains('page')?550:700}},offsetParent:{get(){return this.parentElement}}});
const canvases=new WeakMap();function canvas(el){let c=canvases.get(el);if(!c||c.width!==el.width||c.height!==el.height){c=createCanvas(el.width,el.height);canvases.set(el,c)}return c}
window.HTMLCanvasElement.prototype.getContext=function(type){return canvas(this).getContext(type)};window.HTMLCanvasElement.prototype.toDataURL=function(){return canvas(this).toDataURL()};
const style=document.createElement('style');style.textContent=await readFile(new URL('../app/src/main/assets/pdf/reader.css',import.meta.url),'utf8');document.head.append(style);
const {open,close}=await import('../app/src/main/assets/pdf/reader.mjs');
function sample(){const ops='1 0 0 rg 20 20 200 300 re f\n';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 4 0 R >>','<< /Length '+ops.length+' >>\nstream\n'+ops+'endstream'];let s='%PDF-1.7\n',offset=[0];objects.forEach((o,i)=>{offset.push(s.length);s+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});let x=s.length;s+='xref\n0 5\n0000000000 65535 f \n'+offset.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+x+'\n%%EOF';return new TextEncoder().encode(s)}
for(const native of [false,true]){
 if(native){window.NativeStore={call:async()=>({accepted:false})};globalThis.fetch=async()=>new Response(style.textContent)}else delete window.NativeStore;
 for(let i=0;i<2;i++){
  await open({loadBytes:async()=>sample(),id:'pdf-'+i,stage:document.getElementById('stage'),dialog:document.getElementById('dialog'),file:{name:'文档 '+i+'.pdf'}});
  const root=document.querySelector('.pdf-reader');assert.equal(root.querySelector('[data-pdf="filename"]').textContent,'文档 '+i+'.pdf');
  const deadline=Date.now()+10000;while(Date.now()<deadline&&!root.querySelector('[data-pdf="status"]').hidden)await new Promise(r=>setTimeout(r,20));
  assert.equal(root.querySelector('[data-pdf="status"]').hidden,true,root.querySelector('[data-pdf="status"]').textContent);
  const c=root.querySelector('.page canvas');assert.ok(c);assert.ok(canvas(c).getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i,a)=>i%4===0&&v>200&&a[i+1]<30&&a[i+2]<30),'actual red page content must be rasterized');assert.equal(root.querySelector('[data-pdf="total"]').textContent,'1');
  await close();assert.equal(document.querySelector('.pdf-reader'),null);
 }
 console.log((native?'Android adapter bridge stub':'Web')+': actual PDF.js page raster, filename, close and reopen passed');
}
await open({bytes:new Uint8Array([1,2]),id:'bad',stage:document.getElementById('stage'),dialog:document.getElementById('dialog'),file:{name:'null'}});assert.equal(document.querySelector('[data-pdf="filename"]').textContent,'PDF 文档');assert.equal(document.querySelector('[data-pdf="erroractions"]').hidden,false);await close();dom.window.close();console.log('Invalid PDF: visible failure + retry/back, fallback filename passed');
