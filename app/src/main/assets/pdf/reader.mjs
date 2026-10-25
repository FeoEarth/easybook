// Mozilla PDF.js component viewer, shared unchanged by Web and Android WebView.
const BASE=new URL('./',import.meta.url),VERSION='6.4.299';
let libraries,active=null,epoch=0,closing=Promise.resolve();
const $=(root,id)=>root.querySelector('[data-pdf="'+id+'"]');
function librariesReady(){return libraries||=import(new URL('vendor/pdf.mjs',BASE)).then(async lib=>{if(lib.version!==VERSION)throw Error('PDF.js 资源版本不一致');globalThis.pdfjsLib=lib;lib.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',BASE).href;const viewer=await import(new URL('vendor/pdf_viewer.mjs',BASE));return {lib,...viewer}}).catch(error=>{libraries=null;throw error})}
function remembered(id){try{return JSON.parse(localStorage.getItem('easybook-pdf:'+id)||'null')}catch{return null}}
function save(session){if(!session.viewer?.pdfDocument||!session.position)return;try{const p=session.position;localStorage.setItem('easybook-pdf:'+session.id,JSON.stringify({page:p.pageNumber,left:p.left,top:p.top,scale:session.fit?'page-width':session.viewer.currentScale}));const keys=Object.keys(localStorage).filter(k=>k.startsWith('easybook-pdf:'));for(const key of keys.slice(0,Math.max(0,keys.length-32)))if(key!=='easybook-pdf:'+session.id)localStorage.removeItem(key)}catch{}}
function dispose(){const s=active;active=null;if(!s)return closing;save(s);clearTimeout(s.saveTimer);s.abort.abort();s.resize?.disconnect();s.viewer?.setDocument(null);s.find?.setDocument(null);s.link?.setDocument(null);s.root.remove();s.dialog.classList.remove('pdf-mode','pdf-controls-hidden');const task=s.task;s.task=null;s.doc=null;closing=closing.catch(()=>{}).then(()=>task?.destroy()).catch(()=>{});return closing}
export function close(){epoch++;return dispose()}
export async function open({bytes,id,stage,dialog}){
 const ticket=++epoch;await dispose();if(ticket!==epoch)return;
 const root=document.createElement('section');root.className='pdf-reader';root.setAttribute('aria-label','PDF 阅读器');
 root.innerHTML=`<div class="pdf-tools" role="toolbar" aria-label="PDF 阅读工具"><input data-pdf="page" type="number" inputmode="numeric" min="1" value="1" aria-label="页码"><span class="pdf-total" data-pdf="total">/ …</span><button data-pdf="back" disabled>上一位置</button><button data-pdf="out" aria-label="缩小">−</button><button data-pdf="in" aria-label="放大">＋</button><button data-pdf="fit">适应宽度</button><button data-pdf="search">搜索</button><button class="pdf-toggle" data-pdf="hide" aria-label="隐藏阅读控件">收起</button></div><div class="pdf-find" data-pdf="findbar" hidden><input data-pdf="query" type="search" placeholder="搜索 PDF 文字" aria-label="搜索 PDF 文字"><button data-pdf="prev" aria-label="上一个结果">↑</button><button data-pdf="next" aria-label="下一个结果">↓</button><output data-pdf="matches" aria-live="polite"></output><button data-pdf="findclose" aria-label="关闭搜索">×</button></div><div class="pdf-status" data-pdf="status" role="status">正在加载 PDF…</div><form class="pdf-password" data-pdf="passwordform" hidden><label data-pdf="passwordlabel">此 PDF 已加密，请输入密码</label><input data-pdf="password" type="password" autocomplete="off" aria-label="PDF 密码"><button type="submit">解锁</button></form><div class="pdf-viewport"><div class="pdf-container" data-pdf="container" tabindex="0" aria-label="PDF 页面"><div class="pdfViewer" data-pdf="pages"></div></div></div>`;
 stage.append(root);dialog.classList.add('pdf-mode');
 const s=active={id,root,dialog,abort:new AbortController(),fit:true,position:null,returnTo:null,pointers:new Map()};const signal=s.abort.signal;
 const on=(el,type,fn,options={})=>el.addEventListener(type,fn,{...options,signal});
 const status=message=>{$(root,'status').textContent=message;$(root,'status').hidden=!message};
 try{
  if(!(bytes instanceof Uint8Array)||bytes.length>5*1024*1024||!/%PDF-\d\.\d/.test(new TextDecoder('latin1').decode(bytes.subarray(0,1024))))throw Error('文件内容不是有效的 PDF，或超过现有 5 MB 附件上限');
  const {lib,PDFViewer,EventBus,PDFLinkService,PDFFindController}=await librariesReady();if(ticket!==epoch)return;
  const container=$(root,'container'),bus=new EventBus(),link=s.link=new PDFLinkService({eventBus:bus}),find=s.find=new PDFFindController({eventBus:bus,linkService:link});link.externalLinkEnabled=false;
  const l10n={getLanguage:async()=> 'zh-CN',getDirection:async()=> 'ltr',get:async(id,args,fallback)=>fallback||id,translate:async()=>{},pause(){},resume(){}};
  const viewer=s.viewer=new PDFViewer({container,viewer:$(root,'pages'),eventBus:bus,linkService:link,findController:find,l10n,annotationMode:lib.AnnotationMode.DISABLE,annotationEditorMode:lib.AnnotationEditorType.DISABLE,enableAutoLinking:false,enableScripting:false,scriptingManager:null,maxCanvasPixels:2*1024*1024,maxCanvasDim:4096,enableDetailCanvas:false,abortSignal:signal});link.setViewer(viewer);
  const listen=(event,fn)=>bus.on(event,fn,{signal});
  const restore=remembered(id);
  function jump(page){if(!s.doc)return;s.returnTo=s.position?{...s.position,scale:viewer.currentScale}:null;$(root,'back').disabled=!s.returnTo;viewer.currentPageNumber=Math.max(1,Math.min(s.doc.numPages,Math.floor(page)));container.focus({preventScroll:true})}
  function zoom(factor,origin,pan){s.fit=false;const next=Math.max(.25,Math.min(8,viewer.currentScale*factor));viewer.updateScale({scaleFactor:next/viewer.currentScale,origin,pan,drawingDelay:150})}
  function search(again=false,previous=false){bus.dispatch('find',{source:root,type:again?'again':'',query:$(root,'query').value,phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous,matchDiacritics:false})}
  listen('pagesinit',()=>{viewer.currentScaleValue=restore?.scale==='page-width'?'page-width':Number.isFinite(restore?.scale)?Math.max(.25,Math.min(8,restore.scale)):'page-width';s.fit=!restore||restore.scale==='page-width';if(restore&&Number.isInteger(restore.page))viewer.scrollPageIntoView({pageNumber:Math.max(1,Math.min(s.doc.numPages,restore.page)),destArray:[null,{name:'XYZ'},Number(restore.left)||0,Number(restore.top)||0,null]});});
  listen('pagerendered',event=>{if(event.error)status('此页部分内容无法渲染，请尝试保存后查看');else status('')});
  listen('pagechanging',event=>{$(root,'page').value=event.pageNumber});
  listen('updateviewarea',event=>{s.position={...event.location};clearTimeout(s.saveTimer);s.saveTimer=setTimeout(()=>save(s),400)});
  listen('updatefindmatchescount',event=>{const m=event.matchesCount;$(root,'matches').textContent=m.total?m.current+' / '+m.total:'无结果（扫描件可能没有文本）'});
  listen('updatefindcontrolstate',event=>{if(event.state===1)$(root,'matches').textContent='无结果（扫描件可能没有文本）'});
  on($(root,'page'),'change',()=>jump(Number($(root,'page').value)||1));
  on($(root,'back'),'click',()=>{const p=s.returnTo;if(!p)return;viewer.currentScaleValue=p.scale;viewer.scrollPageIntoView({pageNumber:p.pageNumber,destArray:[null,{name:'XYZ'},p.left,p.top,null]});s.returnTo=null;$(root,'back').disabled=true});
  on($(root,'in'),'click',()=>zoom(1.2));on($(root,'out'),'click',()=>zoom(1/1.2));
  on($(root,'fit'),'click',()=>{s.fit=true;viewer.currentScaleValue='page-width'});
  on($(root,'search'),'click',()=>{$(root,'findbar').hidden=false;$(root,'query').focus()});
  on($(root,'findclose'),'click',()=>{$(root,'findbar').hidden=true;bus.dispatch('findbarclose',{source:root});container.focus()});
  on($(root,'query'),'input',()=>search());on($(root,'query'),'keydown',e=>{if(e.key==='Enter'){e.preventDefault();search(true,e.shiftKey)}});
  on($(root,'prev'),'click',()=>search(true,true));on($(root,'next'),'click',()=>search(true));
  on($(root,'hide'),'click',()=>dialog.classList.add('pdf-controls-hidden'));
  let down=null,lastTap=0,tapTimer;
  new lib.TouchManager({container,signal,onPinchStart:()=>{down=null;lastTap=0;clearTimeout(tapTimer)},onPinching:(origin,previous,distance,dx,dy)=>zoom(distance/Math.max(1,previous),origin,[dx,dy]),onPanning:(dx,dy)=>container.scrollBy(-dx,-dy)});
  on(container,'pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};},{passive:true});
  on(container,'pointercancel',()=>{down=null});
  on(container,'pointerup',e=>{const d=down;down=null;if(!d||performance.now()-d.time>300||Math.hypot(e.clientX-d.x,e.clientY-d.y)>8||window.getSelection()?.toString())return;const now=performance.now();if(now-lastTap<300){clearTimeout(tapTimer);zoom(viewer.currentScale>2?.5:2,[e.clientX,e.clientY]);lastTap=0}else{clearTimeout(tapTimer);tapTimer=setTimeout(()=>{if(!signal.aborted)dialog.classList.toggle('pdf-controls-hidden')},300);lastTap=now}});
  on(container,'dblclick',e=>e.preventDefault());
  on(container,'wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1,[e.clientX,e.clientY])}},{passive:false});
  on(root,'keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();$(root,'findbar').hidden=false;$(root,'query').focus()}else if(e.target===container&&e.key==='PageDown'){e.preventDefault();jump(viewer.currentPageNumber+1)}else if(e.target===container&&e.key==='PageUp'){e.preventDefault();jump(viewer.currentPageNumber-1)}});
  s.resize=new ResizeObserver(()=>{if(s.fit&&viewer.pdfDocument)viewer.currentScaleValue='page-width';viewer.update()});s.resize.observe(container);
  s.task=lib.getDocument({data:bytes,cMapUrl:new URL('vendor/cmaps/',BASE).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/standard_fonts/',BASE).href,wasmUrl:new URL('vendor/wasm/',BASE).href,isEvalSupported:false,enableXfa:false,useSystemFonts:true,disableAutoFetch:true,stopAtErrors:true,maxImageSize:16*1024*1024,canvasMaxAreaInBytes:16*1024*1024});
  s.task.onProgress=event=>status(event.total?'正在加载 '+Math.round(event.loaded/event.total*100)+'%':'正在解析 PDF…');
  s.task.onPassword=(update,reason)=>{const form=$(root,'passwordform'),input=$(root,'password');form.hidden=false;$(root,'passwordlabel').textContent=reason===lib.PasswordResponses.INCORRECT_PASSWORD?'密码不正确，请重试':'此 PDF 已加密，请输入密码';form.onsubmit=e=>{e.preventDefault();const value=input.value;input.value='';form.hidden=true;status('正在解锁 PDF…');update(value)};input.focus()};
  s.doc=await s.task.promise;if(ticket!==epoch){await s.task?.destroy();return}$(root,'page').max=s.doc.numPages;$(root,'total').textContent='/ '+s.doc.numPages;find.setDocument(s.doc);link.setDocument(s.doc);viewer.setDocument(s.doc);
 }catch(error){if(ticket!==epoch)return;status(error.name==='PasswordException'?'无法解锁此 PDF':error.name==='InvalidPDFException'?'PDF 已损坏或格式不支持':'PDF 无法加载：'+(error.message||'请保存后重试'));}
}
window.EasybookPDF={open,close};
// Cache only public application resources. Never cache attachment/API/private PDF data.
if(location.protocol==='https:'&&location.hostname!=='appassets.androidplatform.net'&&'serviceWorker'in navigator)navigator.serviceWorker.register('/pdf-sw.js',{scope:'/'}).catch(()=>{});
