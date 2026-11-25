// Independent material surfaces; original dock controls remain the only business handlers.
(()=>{
 const nav=document.getElementById('navigation'),search=document.getElementById('search');if(!nav||!search)return;
 const skin=document.createElement('style');skin.textContent='#navigation .native-dock-mounted{opacity:0!important}body.native-dock-searching #navigation :is(#createFolder,#newTop){display:none!important}';document.head.append(skin);
 const controls=[nav.querySelector('.searchbar'),document.getElementById('createFolder'),document.getElementById('newTop')],names=['DockSearch','DockFolder','DockCompose'];
 const slots=controls.map((element,slot)=>({element,slot,ready:false,mounted:false,last:'',revision:0,signature:''}));
 const darkScheme=matchMedia('(prefers-color-scheme:dark)'),reducedTransparency=matchMedia('(prefers-reduced-transparency:reduce)');
 let queued=false,dirty=true,content=null,disabled=false,group='';
 function hide(state){state.ready=false;state.mounted=false;if(state.element.classList.contains('native-dock-mounted'))state.element.classList.remove('native-dock-mounted');if(state.last!=='closed'){state.last='closed';state.signature='';window.NativeStore.call('ui.glass.dock',{slot:state.slot,visible:false}).catch(()=>{})}}
 function clearSurfaces(){group='';slots.forEach(hide)}
 function fallback(){if(disabled)return;disabled=true;clearSurfaces()}
 function dockVisible(){const style=getComputedStyle(nav);return !nav.hidden&&!document.body.dataset.settingsDetail&&style.display!=='none'&&style.visibility!=='hidden'}
 function hideDock(){
  if(document.activeElement===search)search.blur();
  document.body.classList.toggle('native-dock-searching',false);
  clearSurfaces();
 }
 window.easybookHideDockSurfaces=hideDock;
 function describe(){
  const clone=nav.cloneNode(true);clone.querySelectorAll('.native-dock-mounted').forEach(el=>el.classList.remove('native-dock-mounted'));
  clone.querySelector('#search').setAttribute('value',search.value);
  const ids=['clearSearch','createFolder','newTop'];ids.forEach((id,i)=>{const button=clone.querySelector('#'+id);if(button)button.dataset.formatToken='d-'+i});
  const root=getComputedStyle(document.documentElement),vars=[...root].filter(key=>key.startsWith('--')).map(key=>key+':'+root.getPropertyValue(key)+';').join('');
  return {html:clone.outerHTML,css:[...document.querySelectorAll('style')].filter(el=>el!==skin).map(el=>el.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(el=>el.outerHTML).join(''),rootStyle:vars,bodyClass:document.body.className,panel:document.body.dataset.page||'',theme:document.documentElement.dataset.theme||'auto'};
 }
 slots.forEach((state,i)=>{
  window['easybook'+names[i]+'SurfaceFallback']=fallback;
  window['easybook'+names[i]+'SurfaceReady']=revision=>{if(disabled||state.last==='closed'||revision!==state.revision||state.ready)return;state.ready=true;schedule()};
  window['easybookSync'+names[i]+'Surface']=schedule;
  window['easybook'+names[i]+'SurfaceClick']=token=>{const id=['clearSearch','createFolder','newTop'][Number(token.slice(2))],button=document.getElementById(id);if(disabled||!dockVisible()||!state.mounted||!id||!button||button.hidden||button.disabled||document.querySelector('dialog[open]'))return;button.click();dirty=true;schedule()};
 });
 window.easybookDockSearchFocus=()=>{if(!dockVisible()||document.querySelector('dialog[open]'))return false;clearSurfaces();search.focus({preventScroll:true});schedule();return document.activeElement===search};
 function sync(){
  if(!dockVisible()){hideDock();return}
  const searchFocused=document.activeElement===search;document.body.classList.toggle('native-dock-searching',searchFocused);
  const vp=window.visualViewport,blocked=disabled||searchFocused||document.querySelector('dialog[open]')||document.documentElement.dataset.glass==='reduced'||reducedTransparency.matches||Math.abs((vp?.scale||1)-1)>.01;
  if(blocked){clearSurfaces();return}
  const visible=[];
  for(const state of slots){
   const rect=state.element.getBoundingClientRect(),css=getComputedStyle(state.element);
   if(rect.width>=1&&rect.height>=1&&!state.element.hidden&&css.display!=='none'&&css.visibility!=='hidden')visible.push({state,rect,css});
  }
  if(dirty||!content){content=describe();dirty=false}
  const dark=content.theme==='dark'||content.theme!=='light'&&darkScheme.matches;
  const nextGroup=JSON.stringify([dark,...visible.map(({state})=>state.slot)]);
  if(nextGroup!==group){clearSurfaces();group=nextGroup}
  const signature=JSON.stringify(content);
  // Keep the CSS dock visible until every glass projection can replace its control.
  for(const {state} of visible){
   if(signature!==state.signature&&!state.mounted)state.ready=false;
  }
  const mount=visible.every(({state})=>state.ready);
  for(const {state,rect,css} of visible){
   if(state.mounted!==mount){state.mounted=mount;state.element.classList.toggle('native-dock-mounted',mount)}
   const changed=signature!==state.signature;if(changed){state.signature=signature;state.revision++}
   const corner=Math.min(rect.width/2,rect.height/2,parseFloat(css.borderTopLeftRadius)||0);
   const params={slot:state.slot,visible:true,focused:false,left:rect.left-(vp?.offsetLeft||0),top:rect.top-(vp?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:vp?.width||document.documentElement.clientWidth,dark,opacity:state.mounted?1:Number(css.opacity),corner,mounted:state.mounted,revision:state.revision};
   const key=JSON.stringify(params);if(key===state.last&&!changed)continue;state.last=key;if(changed||!state.mounted)params.content=content;
   window.NativeStore.call('ui.glass.dock',params).then(r=>{if(!r.accepted)fallback()}).catch(fallback);
  }
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync();if(slots.some(s=>s.mounted))window.NativeStore.call('ui.glass.invalidate').catch(()=>{})})}
 new MutationObserver(records=>{if(nav.hidden||document.body.dataset.settingsDetail)hideDock();if(records.some(r=>!(controls.includes(r.target)&&r.attributeName==='class')))dirty=true;schedule()}).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
 if(window.ResizeObserver){const observer=new ResizeObserver(schedule);observer.observe(nav);controls.forEach(el=>observer.observe(el))}
 for(const type of ['focus','blur','input','change'])search.addEventListener(type,()=>{dirty=true;schedule()});
 for(const type of ['scroll','resize','load','transitionend','animationend'])window.addEventListener(type,schedule,true);
 for(const type of ['scroll','resize'])window.visualViewport?.addEventListener(type,schedule);
 darkScheme.addEventListener('change',()=>{dirty=true;schedule()});
 reducedTransparency.addEventListener('change',schedule);
 schedule();
})();
