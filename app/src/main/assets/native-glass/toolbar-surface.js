// Native QWEA0 toolbar shell; original toolbar nodes remain the action authority.
(()=>{
 const panel=document.getElementById('formatbar'),track=document.getElementById('formatTrack');if(!panel||!track)return;
 const skin=document.createElement('style');skin.textContent='#formatbar.native-toolbar-mounted{visibility:hidden!important}';document.head.append(skin);
 const tokens=new WeakMap(),targets=new Map();let serial=0,revision=0,signature='',last='',mounted=false,disabled=false,queued=false,dirty=true,content=null,gesturing=false;
 function describe(){
  const clone=panel.cloneNode(true),original=[...panel.querySelectorAll('button')],copies=[...clone.querySelectorAll('button')];
  original.forEach((element,index)=>{let token=tokens.get(element);if(!token){token='t-'+(++serial);tokens.set(element,token);targets.set(token,element)}copies[index].dataset.formatToken=token});
  return {html:clone.innerHTML,css:[...document.querySelectorAll('style')].filter(element=>element!==skin).map(element=>element.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(element=>element.outerHTML).join(''),rootStyle:['--ink','--muted','--accent','--bg','--paper','--border','--line','--control-fill','--on-accent','--danger'].map(name=>name+':'+getComputedStyle(document.documentElement).getPropertyValue(name)+';').join(''),bodyClass:document.body.className,panel:'toolbar',theme:document.documentElement.dataset.theme||'auto'};
 }
 function hide(){if(gesturing){gesturing=false;window.dispatchEvent(new CustomEvent('easybook-native-toolbar-gesture',{detail:false}))}mounted=false;panel.classList.remove('native-toolbar-mounted');if(last!=='closed'){last='closed';window.NativeStore.call('ui.glass.toolbar',{visible:false}).catch(()=>{})}}
 window.easybookToolbarSurfaceFallback=()=>{disabled=true;hide();window.easybookToolbarSurfaceGesture(false)};
 window.easybookToolbarSurfaceReady=value=>{if(disabled||panel.hidden||value!==revision)return;mounted=true;panel.classList.add('native-toolbar-mounted');last='';sync()};
 window.easybookToolbarSurfaceClick=token=>{const element=targets.get(token),rich=window.easybookRich;if(disabled||panel.hidden||!element?.isConnected||element.disabled||!rich||rich.isComposing())return;rich.captureSelection();element.click();schedule()};
 window.easybookToolbarSurfaceGesture=active=>{gesturing=active;if(active&&!window.easybookRich?.isComposing())window.easybookRich?.captureSelection();window.dispatchEvent(new CustomEvent('easybook-native-toolbar-gesture',{detail:active}));if(!active)schedule()};
 window.easybookToolbarSurfaceScroll=left=>{if(Number.isFinite(left)){track.scrollLeft=left;schedule()}};
 function sync(){
  if(disabled)return;const rect=panel.getBoundingClientRect(),css=getComputedStyle(panel),viewport=window.visualViewport;
  if(panel.hidden||!document.body.classList.contains('editing')||rect.width<1||rect.height<1||document.documentElement.dataset.glass==='reduced'||matchMedia('(prefers-reduced-transparency:reduce)').matches||Math.abs((viewport?.scale||1)-1)>.01){hide();return}
  let changed=false;if((dirty&&!gesturing)||!content){const next=describe(),sig=JSON.stringify(next);dirty=false;if(sig!==signature){signature=sig;content=next;revision++;changed=true}}
  const theme=content.theme,params={visible:true,left:rect.left-(viewport?.offsetLeft||0),top:rect.top-(viewport?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:viewport?.width||document.documentElement.clientWidth,dark:theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches,opacity:Math.max(0,Math.min(1,Number(css.opacity))),corner:Math.min(parseFloat(css.borderTopLeftRadius)||rect.height/2,rect.width/2,rect.height/2),mounted,revision,scrollLeft:track.scrollLeft};
  const key=JSON.stringify(params);if(key===last&&!changed)return;last=key;if(changed||!mounted)params.content=content;
  window.NativeStore.call('ui.glass.toolbar',params).then(result=>{if(!result.accepted)window.easybookToolbarSurfaceFallback()}).catch(window.easybookToolbarSurfaceFallback);
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync()})}
 window.easybookSyncToolbarSurface=schedule;
 new MutationObserver(records=>{for(const record of records){const target=record.target;if(panel.contains(target)&&!(target===panel&&['class','style','hidden'].includes(record.attributeName))||target===document.documentElement&&record.attributeName==='data-theme'||target===document.body&&record.attributeName==='class'||target.nodeType===1&&target.closest('style')||[...record.addedNodes].some(node=>node.nodeName==='STYLE'))dirty=true}schedule()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(panel);
 for(const event of ['resize','scroll']){window.addEventListener(event,schedule,true);window.visualViewport?.addEventListener(event,schedule)}
 matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{dirty=true;schedule()});
})();
