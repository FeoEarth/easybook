// Android-only adapter, inserted into the existing application closure before ui.ready.
// No credentials, note identifiers or history are sent to the native navigation channel.
if (window.NativeStore) {
 let backRevision=0,backSignature='',backExecuting=false,backToken=0;
 function backSnapshot(){
  const dialogs=[...document.querySelectorAll('dialog[open]')].map(d=>d.id);
  const blocked=workspacePending||moveBusy||securityBusy;
  const canGoBack=blocked||listMenuOpen||dialogs.length>0||!$('findbar').hidden||selecting||!!current||tab!=='folders'||!!$('search').value;
  return {canGoBack:!!canGoBack,blocked,signature:JSON.stringify([key,current,tab,listTab,dialogs,listMenuOpen,selecting,$('findbar').hidden,$('search').value,blocked])};
 }
 function publishBackState(force=false){
  const state=backSnapshot();
  if(state.signature!==backSignature){backSignature=state.signature;backRevision++}
  else if(!force)return;
  void window.NativeStore.call('navigation.state',{revision:backRevision,canGoBack:state.canGoBack}).catch(()=>{});
 }
 window.easybookPublishBackState=()=>publishBackState(true);
 window.easybookCancelBack=token=>{if(backToken===token)backToken=0};
 window.easybookCommitBack=async(revision,token)=>{
  if(backExecuting){void window.NativeStore.call('navigation.finish',{token}).catch(()=>{});return}
  backExecuting=true;backToken=token;
  try{
   publishBackState();
   if(backToken!==token||revision!==backRevision||backSnapshot().blocked||document.hidden)return;
   // Flush the rich document and await the existing deduplicating native save pump.
   // Nothing runs at gesture start/cancel; a failed save leaves the editor open.
   if(current){rich.flushInput();clearTimeout(saveTimer);await flushLocal()}
   publishBackState();
   if(backToken!==token||revision!==backRevision||backSnapshot().blocked||document.hidden)return;
   // Nested folders return to their live parent, never to a cached workspace page.
   if(!current&&!document.querySelector('dialog[open]')&&!listMenuOpen&&!selecting&&$('findbar').hidden&&!$('search').value&&tab.startsWith('folder:')){
    const parent=folderParent(tab.slice(7));
    switchTab(parent&&activeFolders().some(f=>f.id===parent)?'folder:'+parent:'folders');
   }else handleBack();
  }catch{toast('本机保存未完成，请重试返回')}
  finally{backExecuting=false;publishBackState(true);void window.NativeStore.call('navigation.finish',{token}).catch(()=>{})}
 };
 // Mutations cover programmatic navigation, dialogs, async workspace changes and selection.
 // Input events cover value changes which do not create DOM attribute mutations.
 const backObserver=new MutationObserver(()=>publishBackState());
 backObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','class','data-page','disabled']});
 for(const event of ['input','change','click','close','cancel','popstate','pageshow'])window.addEventListener(event,()=>queueMicrotask(()=>publishBackState()),true);
 publishBackState(true);
}
