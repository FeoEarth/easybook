// Android-only semantic adapter. Business handlers, editor selection and data stay in WebView.
(()=>{
 const $=id=>document.getElementById(id),button=$('listMore');if(!button)return;
 let bypass=false,queued=false,source=null,active=false,serial=0,actions=new Map(),acting=false,anchorKey='',fallbackSource=null,fallbackKey='';
 const blocked=new WeakSet();
 const style=document.createElement('style');style.textContent='.native-glass-source{visibility:hidden!important}.native-glass-source::backdrop{background:transparent!important}.native-anchored-menu{position:fixed!important;right:auto!important;bottom:auto!important;margin:0!important;overflow:auto!important;width:min(292px,calc(100vw - 24px))!important}';document.head.append(style);
 // Protected historical format layout is never flattened into native menu items.
 const managed=['linkDialog','menuDialog','contextDialog','folderMenu','folderMoveDialog','moveDialog','nativeAttachmentMenu','nativeHighlightPalette'];
 const restore=()=>{if(source)source.classList.remove('native-glass-source')};
 const options=rect=>{
  const theme=document.documentElement.dataset.theme;
  return {right:Math.max(0,Math.min(document.documentElement.clientWidth,rect.right)),bottom:Math.max(0,rect.bottom),viewportWidth:document.documentElement.clientWidth,dark:theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches,layout:$('cards').classList.contains('grid')?'grid':'list',sort:localStorage.getItem('easybook-note-sort')||'updated'};
 };
 const dirty=()=>{if(active||$('formatDialog').open)window.NativeStore.call('ui.glass.invalidate').catch(()=>{})};
 const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;window.easybookSyncFormatSurface?.();dirty();if(!acting)discover();reanchor();if(fallbackSource?.open){const bounds=anchor(fallbackSource),key=JSON.stringify(bounds);if(bounds&&key!==fallbackKey){fallbackKey=key;positionFallback(fallbackSource,bounds)}}else fallbackSource=null})};
 const trigger=dialog=>dialog?.id==='menuDialog'?$('moreButton'):dialog?.id==='nativeAttachmentMenu'?$('attachmentButton'):dialog?.id==='nativeHighlightPalette'?$('quickHighlight'):null;
 function anchor(dialog){
  const button=trigger(dialog);if(!button)return null;
  const rect=button.getBoundingClientRect(),vp=window.visualViewport,width=vp?.width||document.documentElement.clientWidth,height=vp?.height||innerHeight,x=vp?.offsetLeft||0,y=vp?.offsetTop||0;
  return {anchorLeft:Math.max(0,Math.min(width,rect.left-x)),anchorTop:Math.max(0,Math.min(height,rect.top-y)),anchorRight:Math.max(0,Math.min(width,rect.right-x)),anchorBottom:Math.max(0,Math.min(height,rect.bottom-y)),viewportWidth:width,viewportHeight:height,placement:['nativeAttachmentMenu','nativeHighlightPalette'].includes(dialog.id)?'above':'below'};
 }
 function positionFallback(dialog,bounds){
  dialog.classList.add('native-anchored-menu');
  const vp=window.visualViewport,left=vp?.offsetLeft||0,top=vp?.offsetTop||0;
  const width=Math.min(dialog.id==='nativeHighlightPalette'?280:292,bounds.viewportWidth-24),natural=dialog.scrollHeight;
  const above=Math.max(0,bounds.anchorTop-20),below=Math.max(0,bounds.viewportHeight-bounds.anchorBottom-20);
  const up=bounds.placement==='above'?(above>=natural||above>=below):below<natural&&above>below;
  const height=Math.max(1,Math.min(natural,up?above:below));
  dialog.style.maxHeight=height+'px';dialog.style.left=left+Math.max(12,Math.min(bounds.viewportWidth-width-12,(dialog.id==='nativeHighlightPalette'?(bounds.anchorLeft+bounds.anchorRight-width)/2:bounds.anchorRight-width)))+'px';
  dialog.style.top=top+Math.max(12,Math.min(bounds.viewportHeight-height-12,up?bounds.anchorTop-height-8:bounds.anchorBottom+8))+'px';
 }
 function reanchor(){
  if(!source?.open||!active)return;
  const bounds=anchor(source);if(!bounds)return;
  const key=JSON.stringify(bounds);if(key===anchorKey)return;anchorKey=key;
  positionFallback(source,bounds);
  const {placement,...geometry}=bounds;
  window.NativeStore.call('ui.glass.anchor',geometry).catch(()=>{});
 }
 window.easybookNativeGlassReanchor=()=>{anchorKey='';schedule()};
 const visible=element=>element.getClientRects().length&&!element.closest('[hidden]');
 const describe=dialog=>{
  const elements=[...dialog.querySelectorAll('button,summary')].filter(visible).filter(b=>!b.matches('[data-close],#moveCancel'));
  if(!elements.length||elements.length>96)return null;
  const generation=++serial%10000;actions=new Map();
  return elements.map((el,index)=>{
   const id=`panel-${generation}-${index}`;actions.set(id,el);
   const label=(el.getAttribute('aria-label')||el.textContent||'操作').trim().replace(/\s+/g,' ').slice(0,120);
   return {id,label,disabled:!!el.disabled,checked:el.getAttribute('aria-pressed')==='true'||el.getAttribute('aria-checked')==='true',danger:el.classList.contains('danger'),color:/^#[0-9a-f]{6}$/i.test(el.dataset.color||'')?el.dataset.color:''};
  });
 };
 function discover(){
  for(const id of managed){const d=$(id);if(d&&!d.open)blocked.delete(d)}
  if(source){if(!source.open){restore();source=null;actions.clear();window.NativeStore.call('ui.glass.dismiss').catch(()=>{});}return}
  if(active)return;
  const dialog=managed.map($).filter(d=>d?.open&&d.dataset.state!=='closing'&&!blocked.has(d)).at(-1);if(!dialog)return;
  const items=describe(dialog);if(!items)return;
  source=dialog;anchorKey='';const bounds=anchor(dialog);if(bounds)positionFallback(dialog,bounds);const rect=(dialog.id==='contextDialog'?$('contextSurface'):dialog).getBoundingClientRect();
  const kind=dialog.id==='linkDialog'?'link':dialog.id==='moveDialog'||dialog.id==='folderMoveDialog'?'move':dialog.id==='nativeAttachmentMenu'?'attachment':dialog.id==='nativeHighlightPalette'?'palette':'actions';
  const title=(dialog.querySelector('h2')?.textContent||(dialog.id==='contextDialog'?$('contextTitle').textContent:'操作')).slice(0,120);
  // Hide only the duplicated container, retaining its DOM, modal lifetime and handlers.
  dialog.classList.add('native-glass-source');active=true;
  window.NativeStore.call('ui.glass.menu',{...options(rect),...(bounds?{...bounds,right:bounds.anchorRight,bottom:bounds.anchorBottom}:{}),kind,title,items,value:kind==='link'?$('linkUrl').value:''}).then(r=>{if(!r.accepted)window.easybookNativeGlassFallback()}).catch(window.easybookNativeGlassFallback);
 }
 window.easybookNativeGlassFallback=()=>{
  active=false;
  if(source){blocked.add(source);fallbackSource=source;fallbackKey='';restore();source=null;actions.clear();schedule();return}
  bypass=true;button.click();bypass=false;
 };
 window.easybookNativeGlassClosed=command=>{
  active=false;
  if(command)return;
  const previous=source;restore();source=null;actions.clear();
  if(previous?.id==='nativeAttachmentMenu')window.easybookRich?.releaseSelection();
  if(previous?.open){blocked.add(previous);if(previous.id==='moveDialog')$('moveCancel').click();else previous.close()}
 };
 const commands={layout:'viewToggle',select:'selectNotes',checklist:'template'};
 window.easybookNativeGlassCommand=(id,value)=>{
  active=false;acting=true;
  const previous=source;restore();source=null;
  if(previous?.id==='linkDialog')$('linkUrl').value=value||'';
  const element=actions.get(id)||(commands[id]?$(commands[id]):id==='sort-title'?document.querySelector('[data-note-sort="title"]'):id==='sort-updated'?document.querySelector('[data-note-sort="updated"]'):null);
  actions.clear();if(element?.isConnected&&!element.disabled)element.click();button.setAttribute('aria-expanded','false');
  acting=false;schedule();
 };
 button.addEventListener('click',event=>{
  if(bypass||document.body.classList.contains('editing')||document.body.classList.contains('selecting'))return;
  event.preventDefault();event.stopImmediatePropagation();active=true;
  window.NativeStore.call('ui.glass.menu',options(button.getBoundingClientRect())).then(r=>{if(!r.accepted)window.easybookNativeGlassFallback()}).catch(window.easybookNativeGlassFallback);
 },true);
 // Attachment insertion uses the existing picker; the other entries reuse editor controls.
 const attachment=document.createElement('dialog');attachment.id='nativeAttachmentMenu';attachment.className='ui-material';
 const title=document.createElement('h2');title.textContent='添加附件与内容';attachment.append(title);
 for(const [label,id]of [['图片或文件','attachmentButton'],['添加链接','toolbarLink'],['待办清单',null]]){
  const item=document.createElement('button');item.textContent=label;item.onclick=()=>{attachment.close();bypass=true;try{if(id)$(id).click();else document.querySelector('#formatTrack [data-command="toggleTaskList"]').click()}finally{bypass=false}};attachment.append(item);
 }
 const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=()=>attachment.close();attachment.append(cancel);document.body.append(attachment);
 $('attachmentButton').addEventListener('click',event=>{if(bypass||window.easybookRich?.isComposing())return;event.preventDefault();event.stopImmediatePropagation();window.easybookRich?.captureSelection();attachment.showModal()},true);
 new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 document.addEventListener('load',schedule,true);document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
})();
