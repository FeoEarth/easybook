// Sync-only foreground projection; settings/queue operations remain in the main WebView.
(()=>{
 const panel=document.getElementById('syncSurfaceDialog');if(!panel)return;
 const tokens=new WeakMap(),targets=new Map();let next=0,revision=0,signature='',last='',mounted=false,disabled=false,queued=false,until=0,dirty=true,content=null;
 function describe(){
  const clone=panel.cloneNode(true),original=[...panel.querySelectorAll('button')],copies=[...clone.querySelectorAll('button')];targets.clear();
  original.forEach((el,i)=>{let token=tokens.get(el);if(!token){token='s-'+(++next);tokens.set(el,token)}targets.set(token,el);copies[i].dataset.formatToken=token});
  clone.classList.remove('sync-native-mounted');
  return {html:clone.innerHTML,css:[...document.querySelectorAll('style')].map(el=>el.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(el=>el.outerHTML).join(''),rootStyle:['--ink','--muted','--accent','--bg','--paper','--border','--line','--control-fill','--on-accent','--danger'].map(n=>n+':'+getComputedStyle(document.documentElement).getPropertyValue(n)+';').join(''),bodyClass:document.body.className,panel:'sync',theme:document.documentElement.dataset.theme||'auto'};
 }
 function hide(){mounted=false;panel.classList.remove('sync-native-mounted');if(last!=='closed'){last='closed';window.NativeStore.call('ui.glass.sync',{visible:false}).catch(()=>{})}}
 window.easybookSyncSurfaceFallback=()=>{disabled=true;hide()};
 window.easybookSyncSurfaceReady=value=>{if(disabled||!panel.open||value!==revision)return;mounted=true;panel.classList.add('sync-native-mounted');last='';schedule()};
 window.easybookSyncSurfaceClick=token=>{const el=targets.get(token);if(!disabled&&mounted&&panel.open&&el?.isConnected&&!el.disabled){el.click();schedule()}};
 window.easybookSyncSurfaceScroll=top=>{if(!disabled&&panel.open&&Number.isFinite(top)){panel.scrollTop=top;schedule()}};
 window.easybookSyncSurfaceClose=()=>{if(panel.open)panel.close()};
 function sync(){
  if(disabled)return;const rect=panel.getBoundingClientRect(),css=getComputedStyle(panel),v=visualViewport;
  if(!panel.open||rect.width<1||rect.height<1||Math.abs((v?.scale||1)-1)>.01){hide();return}
  let changed=false;if(dirty||!content){const data=describe(),sig=JSON.stringify(data);dirty=false;if(sig!==signature){signature=sig;content=data;revision++;changed=true}}
  const theme=content.theme,params={visible:true,left:rect.left-(v?.offsetLeft||0),top:rect.top-(v?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:v?.width||document.documentElement.clientWidth,dark:theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches,opacity:Math.max(0,Math.min(1,Number(css.opacity))),corner:parseFloat(css.borderTopLeftRadius)||0,bottomCorner:parseFloat(css.borderBottomLeftRadius)||0,scrollTop:panel.scrollTop,mounted,revision};
  const key=JSON.stringify(params);if(key===last&&!changed)return;last=key;if(changed||!mounted)params.content=content;
  window.NativeStore.call('ui.glass.sync',params).then(r=>{if(!r.accepted)window.easybookSyncSurfaceFallback()}).catch(window.easybookSyncSurfaceFallback);
 }
 function tick(){queued=false;sync();if(panel.open&&performance.now()<until){queued=true;requestAnimationFrame(tick)}}
 function schedule(){if(!queued){queued=true;requestAnimationFrame(tick)}}
 function track(){until=Math.max(until,performance.now()+400);schedule()}
 window.easybookSyncSyncSurface=schedule;
 new MutationObserver(records=>{if(records.some(r=>panel.contains(r.target)&&!(r.target===panel&&['class','style'].includes(r.attributeName))||r.target===document.documentElement&&r.attributeName==='data-theme'||r.target.nodeType===1&&r.target.closest('style')))dirty=true;if(records.some(r=>r.target===panel&&r.attributeName==='open'))track();else schedule()}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 new ResizeObserver(schedule).observe(panel);panel.addEventListener('scroll',schedule,{passive:true});for(const type of ['animationstart','transitionrun'])panel.addEventListener(type,track);for(const type of ['close','animationend','transitionend'])panel.addEventListener(type,schedule);for(const type of ['resize','scroll']){window.addEventListener(type,track,true);visualViewport?.addEventListener(type,track)}matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{dirty=true;schedule()});
})();
