// Preserve the mature move Sheet DOM and its handlers; project only its foreground.
(()=>{
 const panel=document.getElementById('moveDialog');if(!panel)return;
 const skin=document.createElement('style');skin.textContent='#moveDialog.native-move-mounted{visibility:hidden!important}#moveDialog.native-move-mounted::backdrop{visibility:visible!important}';document.head.append(skin);
 const tokens=new WeakMap(),targets=new Map();let next=0,revision=0,signature='',last='',mounted=false,disabled=false,queued=false,until=0,dirty=true,content=null;
 function describe(){
  const clone=panel.cloneNode(true),original=[...panel.querySelectorAll('button')],copies=[...clone.querySelectorAll('button')];targets.clear();
  original.forEach((el,i)=>{let token=tokens.get(el);if(!token){token='m-'+(++next);tokens.set(el,token)}targets.set(token,el);copies[i].dataset.formatToken=token});
  return {html:clone.innerHTML,css:[...document.querySelectorAll('style')].filter(el=>el!==skin).map(el=>el.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(el=>el.outerHTML).join(''),rootStyle:['--ink','--muted','--accent','--bg','--paper','--border','--line','--control-fill','--on-accent','--danger'].map(name=>name+':'+getComputedStyle(document.documentElement).getPropertyValue(name)+';').join(''),bodyClass:document.body.className,panel:panel.dataset.state||'open',theme:document.documentElement.dataset.theme||'auto'};
 }
 function hide(){mounted=false;panel.classList.remove('native-move-mounted');if(last!=='closed'){last='closed';window.NativeStore.call('ui.glass.move',{visible:false}).catch(()=>{})}}
 window.easybookMoveSurfaceFallback=()=>{disabled=true;hide()};
 window.easybookMoveSurfaceReady=value=>{if(disabled||!panel.open||value!==revision)return;mounted=true;panel.classList.add('native-move-mounted');last='';schedule()};
 window.easybookMoveSurfaceClick=token=>{const element=targets.get(token);if(disabled||!mounted||!panel.open||panel.dataset.state==='closing'||!element?.isConnected||element.disabled)return;element.click();schedule()};
 window.easybookMoveSurfaceScroll=top=>{if(disabled||!panel.open||!Number.isFinite(top))return;document.getElementById('moveScroll').scrollTop=top;schedule()};
 window.easybookMoveSurfaceDrag=(phase,y,pointer)=>{
  if(disabled||!mounted||!panel.open||!['down','move','up','cancel'].includes(phase))return;
  // Replay into the existing Sheet gesture handlers, including busy/closing guards.
  document.getElementById('moveDragZone').dispatchEvent(new PointerEvent('pointer'+phase,{bubbles:true,cancelable:true,pointerId:pointer,isPrimary:true,button:0,clientY:y}));schedule();
 };
 function sync(){
  if(disabled)return;
  const rect=panel.getBoundingClientRect(),css=getComputedStyle(panel),vp=window.visualViewport;
  if(!panel.open||rect.width<1||rect.height<1||document.documentElement.dataset.glass==='reduced'||matchMedia('(prefers-reduced-transparency:reduce)').matches||Math.abs((vp?.scale||1)-1)>.01){hide();return}
  let changed=false;if(dirty||!content){const data=describe(),sig=JSON.stringify(data);dirty=false;changed=sig!==signature;if(changed){content=data;signature=sig;revision++}}
  const dark=content.theme==='dark'||content.theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches;
  const params={visible:true,left:rect.left-(vp?.offsetLeft||0),top:rect.top-(vp?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:vp?.width||document.documentElement.clientWidth,dark,opacity:Math.max(0,Math.min(1,Number(css.opacity))),corner:parseFloat(css.borderTopLeftRadius)||0,bottomCorner:parseFloat(css.borderBottomLeftRadius)||0,mounted,revision,scrollTop:document.getElementById('moveScroll').scrollTop};
  const key=JSON.stringify(params);if(key===last&&!changed)return;last=key;if(changed||!mounted)params.content=content;
  window.NativeStore.call('ui.glass.move',params).then(result=>{if(!result.accepted)window.easybookMoveSurfaceFallback()}).catch(window.easybookMoveSurfaceFallback);
 }
 function tick(){queued=false;sync();if(mounted)window.NativeStore.call('ui.glass.invalidate').catch(()=>{});if(panel.open&&performance.now()<until){queued=true;requestAnimationFrame(tick)}}
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(tick)}
 function track(){until=Math.max(until,performance.now()+500);schedule()}
 window.easybookSyncMoveSurface=schedule;
 new MutationObserver(records=>{for(const r of records){const t=r.target;if(panel.contains(t)&&!(t===panel&&['style','class'].includes(r.attributeName))||t===document.documentElement&&r.attributeName==='data-theme'||t===document.body&&r.attributeName==='class'||t.nodeType===1&&t.closest('style')||[...r.addedNodes].some(n=>n.nodeName==='STYLE'))dirty=true}schedule()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(panel);
 for(const type of ['transitionrun','animationstart'])panel.addEventListener(type,track);
 for(const type of ['transitionend','transitioncancel','animationend','close'])panel.addEventListener(type,schedule);
 document.addEventListener('scroll',schedule,true);document.addEventListener('load',schedule,true);
 for(const type of ['resize','scroll']){window.addEventListener(type,schedule,true);window.visualViewport?.addEventListener(type,track)}
 matchMedia('(prefers-color-scheme:dark)').addEventListener('change',schedule);
})();
