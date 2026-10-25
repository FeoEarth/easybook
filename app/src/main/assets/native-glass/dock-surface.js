// Independent material surfaces; original dock controls remain the only business handlers.
(()=>{
 const nav=document.getElementById('navigation'),search=document.getElementById('search');if(!nav||!search)return;
 const skin=document.createElement('style');skin.textContent='#navigation .native-dock-mounted{opacity:0!important}';document.head.append(skin);
 const controls=[nav.querySelector('.searchbar'),document.getElementById('createFolder'),document.getElementById('newTop')],names=['DockSearch','DockFolder','DockCompose'];
 const slots=controls.map((element,slot)=>({element,slot,mounted:false,disabled:false,last:'',revision:0,signature:''}));
 let queued=false,dirty=true,content=null;
 function hide(state){state.mounted=false;if(state.element.classList.contains('native-dock-mounted'))state.element.classList.remove('native-dock-mounted');if(state.last!=='closed'){state.last='closed';window.NativeStore.call('ui.glass.dock',{slot:state.slot,visible:false}).catch(()=>{})}}
 function describe(){
  const clone=nav.cloneNode(true);clone.querySelectorAll('.native-dock-mounted').forEach(el=>el.classList.remove('native-dock-mounted'));
  clone.querySelector('#search').setAttribute('value',search.value);
  const ids=['clearSearch','createFolder','newTop'];ids.forEach((id,i)=>{const button=clone.querySelector('#'+id);if(button)button.dataset.formatToken='d-'+i});
  const root=getComputedStyle(document.documentElement),vars=[...root].filter(key=>key.startsWith('--')).map(key=>key+':'+root.getPropertyValue(key)+';').join('');
  return {html:clone.outerHTML,css:[...document.querySelectorAll('style')].filter(el=>el!==skin).map(el=>el.textContent).join('\n'),symbols:[...document.querySelectorAll('svg symbol')].map(el=>el.outerHTML).join(''),rootStyle:vars,bodyClass:document.body.className,panel:document.body.dataset.page||'',theme:document.documentElement.dataset.theme||'auto'};
 }
 slots.forEach((state,i)=>{
  window['easybook'+names[i]+'SurfaceFallback']=()=>{state.disabled=true;hide(state)};
  window['easybook'+names[i]+'SurfaceReady']=revision=>{if(state.disabled||revision!==state.revision||!state.element.getClientRects().length)return;state.mounted=true;if(!state.element.classList.contains('native-dock-mounted'))state.element.classList.add('native-dock-mounted');state.last='';schedule()};
  window['easybookSync'+names[i]+'Surface']=schedule;
  window['easybook'+names[i]+'SurfaceClick']=token=>{const id=['clearSearch','createFolder','newTop'][Number(token.slice(2))],button=document.getElementById(id);if(state.disabled||!state.mounted||!id||!button||button.hidden||button.disabled||document.querySelector('dialog[open]'))return;button.click();dirty=true;schedule()};
 });
 window.easybookDockSearchFocus=()=>{hide(slots[0]);search.focus({preventScroll:true});schedule()};
 function sync(){
  const vp=window.visualViewport,blocked=document.querySelector('dialog[open]')||document.documentElement.dataset.glass==='reduced'||matchMedia('(prefers-reduced-transparency:reduce)').matches||Math.abs((vp?.scale||1)-1)>.01;
  if(dirty||!content){content=describe();dirty=false}
  slots.forEach(state=>{
   const rect=state.element.getBoundingClientRect(),css=getComputedStyle(state.element);
   if(state.disabled||blocked||rect.width<1||rect.height<1||state.element.hidden||css.display==='none'||state.slot===0&&document.activeElement===search){hide(state);return}
   const signature=JSON.stringify(content),changed=signature!==state.signature;if(changed){state.signature=signature;state.revision++}
   const corner=Math.min(rect.width/2,rect.height/2,parseFloat(css.borderTopLeftRadius)||0);
   const params={slot:state.slot,visible:true,left:rect.left-(vp?.offsetLeft||0),top:rect.top-(vp?.offsetTop||0),width:rect.width,height:rect.height,viewportWidth:vp?.width||document.documentElement.clientWidth,dark:content.theme==='dark'||content.theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches,opacity:state.mounted?1:Number(css.opacity),corner,mounted:state.mounted,revision:state.revision};
   const key=JSON.stringify(params);if(key===state.last&&!changed)return;state.last=key;if(changed||!state.mounted)params.content=content;
   window.NativeStore.call('ui.glass.dock',params).then(r=>{if(!r.accepted){state.disabled=true;hide(state)}}).catch(()=>{state.disabled=true;hide(state)});
  });
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;sync();if(slots.some(s=>s.mounted))window.NativeStore.call('ui.glass.invalidate').catch(()=>{})})}
 new MutationObserver(records=>{if(records.some(r=>!(controls.includes(r.target)&&r.attributeName==='class')))dirty=true;schedule()}).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true});
 if(window.ResizeObserver){const observer=new ResizeObserver(schedule);observer.observe(nav);controls.forEach(el=>observer.observe(el))}
 for(const type of ['focus','blur','input','change'])search.addEventListener(type,()=>{dirty=true;schedule()});
 for(const type of ['scroll','resize','load','transitionend','animationend'])window.addEventListener(type,schedule,true);
 for(const type of ['scroll','resize'])window.visualViewport?.addEventListener(type,schedule);
 matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{dirty=true;schedule()});schedule();
})();