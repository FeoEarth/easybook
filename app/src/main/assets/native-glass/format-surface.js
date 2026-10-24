// Geometry + faithful content projection only. The original DOM owns every command.
(()=>{
 const panel=document.getElementById('formatDialog');if(!panel)return;
 const skin=document.createElement('style');skin.textContent='#formatDialog.native-format-mounted{visibility:hidden!important}';document.head.append(skin);
 const tokens=new WeakMap(),targets=new Map();let next=0,revision=0,signature='',last='',mounted=false,disabled=false,queued=false,until=0;
 let content=null,contentDirty=true;
 function describe(){
  const clone=panel.cloneNode(true),original=[...panel.querySelectorAll('button,summary')],copies=[...clone.querySelectorAll('button,summary')];
  original.forEach((el,i)=>{let token=tokens.get(el);if(!token){token='f-'+(++next);tokens.set(el,token);targets.set(token,el)}copies[i].dataset.formatToken=token});
  clone.classList.remove('native-format-mounted');
  const theme=document.documentElement.dataset.theme||'auto';
  return {html:clone.innerHTML,css:[...document.querySelectorAll('style')].filter(el=>el!==skin).map(el=>el.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(el=>el.outerHTML).join(''),rootStyle:['--ink','--muted','--accent','--bg','--paper','--border','--line','--control-fill','--on-accent','--danger'].map(name=>name+':'+getComputedStyle(document.documentElement).getPropertyValue(name)+';').join(''),bodyClass:document.body.className,panel:panel.dataset.panel||'all',theme};
 }
 function hide(){
  mounted=false;panel.classList.remove('native-format-mounted');
  if(last!=='closed'){last='closed';window.NativeStore.call('ui.glass.format',{visible:false}).catch(()=>{})}
 }
 window.easybookFormatSurfaceFallback=()=>{disabled=true;hide()};
 window.easybookFormatSurfaceReady=value=>{
  if(disabled||!panel.open||value!==revision)return;
  mounted=true;panel.classList.add('native-format-mounted');last='';sync();
 };
 window.easybookFormatSurfaceClick=token=>{
  const element=targets.get(token);if(disabled||!panel.open||!element?.isConnected||element.disabled)return;
  // Existing onclick/default summary behavior, no duplicate format-command map.
  element.click();schedule();
 };
 function sync(){
  if(disabled)return;
  const rect=panel.getBoundingClientRect(),css=getComputedStyle(panel),viewport=window.visualViewport;
  const blocked=document.documentElement.dataset.glass==='reduced'||matchMedia('(prefers-reduced-transparency:reduce)').matches;
  if(!panel.open||rect.width<1||rect.height<1||blocked||Math.abs((viewport?.scale||1)-1)>.01||document.querySelector('.native-glass-source')){hide();return}
  let changed=false;
  if(contentDirty||!content){const data=describe(),sig=JSON.stringify(data);changed=sig!==signature;contentDirty=false;if(changed){signature=sig;content=data;revision++}}
  const data=content;
  const dark=data.theme==='dark'||data.theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches;
  // getBoundingClientRect is CSS viewport space. Native converts once into its
  // current WebView pixel viewport, then applies the WebView-to-root offset.
  const params={visible:true,left:rect.left-(viewport?.offsetLeft||0),top:rect.top-(viewport?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:viewport?.width||document.documentElement.clientWidth,dark,opacity:Math.max(0,Math.min(1,Number(css.opacity))),corner:parseFloat(css.borderTopLeftRadius)||0,mounted,revision};
  const key=JSON.stringify(params);if(key===last&&!changed)return;last=key;
  if(changed||!mounted)params.content=content;
  window.NativeStore.call('ui.glass.format',params).then(result=>{if(!result.accepted)window.easybookFormatSurfaceFallback()}).catch(window.easybookFormatSurfaceFallback);
 }
 function tick(){queued=false;sync();if(panel.open&&performance.now()<until){queued=true;requestAnimationFrame(tick)}}
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(tick)}
 function track(){until=Math.max(until,performance.now()+500);schedule()}
 window.easybookSyncFormatSurface=schedule;
 new MutationObserver(records=>{
  for(const record of records){
   const target=record.target;
   if(panel.contains(target)&&!(target===panel&&['class','style'].includes(record.attributeName))||target===document.documentElement&&record.attributeName==='data-theme'||target===document.body&&record.attributeName==='class'||target.nodeType===1&&target.closest('style')||[...record.addedNodes].some(node=>node.nodeName==='STYLE'))contentDirty=true;
  }
  if(records.some(r=>r.target===panel&&r.attributeName==='open'))track();else schedule();
 }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(panel);
 for(const type of ['transitionrun','animationstart'])panel.addEventListener(type,track);
 for(const type of ['transitionend','transitioncancel','animationend','close'])panel.addEventListener(type,schedule);
 for(const type of ['resize','scroll']){window.addEventListener(type,schedule,true);window.visualViewport?.addEventListener(type,track)}
 matchMedia('(prefers-color-scheme:dark)').addEventListener('change',schedule);
})();
