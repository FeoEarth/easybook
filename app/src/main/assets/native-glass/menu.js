// Injected only into the origin-scoped Android prototype; Web stays unchanged.
(()=>{
 const button=document.getElementById('listMore');if(!button)return;
 let bypass=false;
 window.easybookNativeGlassFallback=()=>{bypass=true;button.click();bypass=false};
 const commands={layout:'viewToggle',select:'selectNotes',checklist:'template'};
 window.easybookNativeGlassCommand=id=>{
  const element=commands[id]?document.getElementById(commands[id]):id==='sort-title'?document.querySelector('[data-note-sort="title"]'):id==='sort-updated'?document.querySelector('[data-note-sort="updated"]'):null;
  if(element)element.click();button.setAttribute('aria-expanded','false');
 };
 button.addEventListener('click',event=>{
  if(bypass||document.body.classList.contains('editing')||document.body.classList.contains('selecting'))return;
  event.preventDefault();event.stopImmediatePropagation();
  const rect=button.getBoundingClientRect(),theme=document.documentElement.dataset.theme;
  window.NativeStore.call('ui.glass.menu',{right:rect.right,bottom:rect.bottom,viewportWidth:document.documentElement.clientWidth,dark:theme==='dark'||theme!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches,layout:document.getElementById('cards').classList.contains('grid')?'grid':'list',sort:localStorage.getItem('easybook-note-sort')||'updated'}).then(r=>{if(!r.accepted)window.easybookNativeGlassFallback()}).catch(window.easybookNativeGlassFallback);
 },true);
})();
