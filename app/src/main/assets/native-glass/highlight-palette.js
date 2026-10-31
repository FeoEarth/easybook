// Independent color UI; the complete panel remains the sole color/command source.
window.installEasybookHighlightPalette=(rich,high,arrow,cluster)=>{
 const $=id=>document.getElementById(id),original=[...document.querySelectorAll('#highlightColors button[data-color-mark="highlight"]')];
 if(!original.length)return;
 const panel=document.createElement('dialog');panel.id='nativeHighlightPalette';panel.className='ui-material';panel.setAttribute('aria-labelledby','quickHighlightTitle');
 const header=document.createElement('div');header.className='dialog-title';const title=document.createElement('h2');title.id='quickHighlightTitle';title.textContent='高亮颜色';
 const close=document.createElement('button');close.type='button';close.textContent='×';close.dataset.close=panel.id;close.setAttribute('aria-label','关闭高亮颜色');close.onclick=()=>panel.close();header.append(title,close);panel.append(header);
 const swatches=document.createElement('div');swatches.className='quick-highlight-swatches';panel.append(swatches);
 const controls=[];let selected='',remembered='',focused=false,opening=false;
 for(const source of original){
  const color=source.dataset.color,button=document.createElement('button');button.type='button';button.dataset.color=color;
  button.setAttribute('aria-label',source.getAttribute('aria-label')||source.textContent);button.setAttribute('aria-pressed','false');button.onpointerdown=event=>event.preventDefault();
  if(color){const dot=document.createElement('span');dot.className='swatch';dot.style.setProperty('--swatch',color);dot.setAttribute('aria-hidden','true');button.append(dot);swatches.append(button)}
  else{button.textContent='移除高亮';button.className='quick-highlight-remove';panel.append(button)}
  button.onclick=()=>{if(rich.isComposing())return;source.click();sync();panel.close()};controls.push({source,button});
 }
 document.body.append(panel);
 const style=document.createElement('style');style.textContent='#formatTrack .highlight-quick{background:var(--control-fill);border-radius:18px;overflow:hidden}#formatTrack #highlightPalette svg{width:14px;height:14px;stroke-width:1.8}#formatTrack #highlightButton .quick-highlight-ink{stroke:var(--quick-highlight-color);stroke-width:3}#nativeHighlightPalette{position:fixed;margin:0;width:min(280px,calc(100vw - 24px));padding:12px;border-radius:26px;max-height:calc(100dvh - 24px);overflow:auto}#nativeHighlightPalette.native-anchored-menu{width:min(280px,calc(100vw - 24px))!important}#nativeHighlightPalette .dialog-title{margin:0 0 6px}#nativeHighlightPalette h2{font-size:17px;line-height:24px}#nativeHighlightPalette .quick-highlight-swatches{display:flex;flex-wrap:wrap;gap:4px}#nativeHighlightPalette .quick-highlight-swatches button{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:44px;padding:8px;background:transparent}#nativeHighlightPalette .swatch{position:relative}#nativeHighlightPalette [aria-pressed=true] .swatch{outline:2px solid var(--ink);outline-offset:3px}#nativeHighlightPalette [aria-pressed=true] .swatch:after{content:"✓";position:absolute;inset:0;text-align:center;line-height:24px;color:#1c1c1e;font-size:16px}#nativeHighlightPalette .quick-highlight-remove{display:block;width:100%;min-height:44px;margin-top:8px;white-space:nowrap;background:transparent;text-align:left}';document.head.append(style);
 const svg=high.querySelector('svg'),ink=document.createElementNS('http://www.w3.org/2000/svg','path');ink.setAttribute('d','M3 22h18');ink.setAttribute('class','quick-highlight-ink');svg?.append(ink);
 arrow.setAttribute('aria-haspopup','dialog');arrow.setAttribute('aria-controls',panel.id);arrow.setAttribute('aria-expanded','false');
 function sync(){
  let next='';for(const {source,button}of controls){const checked=source.getAttribute('aria-pressed')==='true';if(button.getAttribute('aria-pressed')!==String(checked))button.setAttribute('aria-pressed',String(checked));if(checked&&source.dataset.color)next=source.dataset.color}
  const saved=localStorage.getItem('easybook-last-highlight')||window.RichNotes.highlights.黄色;
  const recent=original.find(source=>source.dataset.color===saved)||original.find(source=>source.dataset.color);
  if(recent&&remembered!==recent.dataset.color){remembered=recent.dataset.color;high.style.setProperty('--quick-highlight-color',remembered);high.title='应用最近高亮：'+recent.textContent.trim()}
  if(panel.open&&next!==selected){selected=next;window.NativeStore?.call('ui.glass.palette',{color:selected})?.catch(()=>{})}else selected=next;
 }
 function show(){
  if(rich.isComposing()||!document.body.classList.contains('editing')){opening=false;return}
  rich.captureSelection();sync();panel.show();arrow.setAttribute('aria-expanded','true');opening=false;
 }
 arrow.onclick=()=>{
  if(panel.open){panel.close();return}if(opening||rich.isComposing())return;
  focused=rich.editor.isFocused;opening=true;
  // Let the original format close handler restore/release its bookmark first.
  if($('formatDialog').open){$('formatDialog').addEventListener('close',show,{once:true});$('formatDialog').close()}else show();
 };
 panel.addEventListener('close',()=>{
  arrow.setAttribute('aria-expanded','false');opening=false;
  if(!['formatDialog','linkDialog','markdownDialog','nativeAttachmentMenu'].some(id=>$(id)?.open))rich.releaseSelection();
  if(focused&&document.body.classList.contains('editing')&&!rich.isComposing()&&!document.querySelector('dialog[open]'))rich.editor.commands.focus(undefined,{scrollIntoView:false});
  window.dispatchEvent(new Event('easybook-highlight-palette-closed'));
 });
 document.addEventListener('pointerdown',event=>{if(panel.open&&!panel.contains(event.target)&&!cluster.contains(event.target))panel.close()},true);
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();panel.close()}});
 rich.editor.on('transaction',sync);sync();
 // Local fallback anchoring also works when native glass isn't supported.
 let queued=false,last='';const position=()=>{queued=false;if(!panel.open)return;
  const rect=cluster.getBoundingClientRect(),vp=window.visualViewport,left=(vp?.offsetLeft||0)+12,top=(vp?.offsetTop||0)+12,right=left+(vp?.width||innerWidth)-24,bottom=top+(vp?.height||innerHeight)-24;
  const width=Math.min(280,right-left),height=Math.min(panel.scrollHeight,bottom-top),above=rect.top-top-8,below=bottom-rect.bottom-8;
  const up=above>=height||above>=below,max=Math.max(1,Math.min(height,up?above:below));
  const x=Math.max(left,Math.min((rect.left+rect.right-width)/2,right-width)),y=Math.max(top,Math.min(up?rect.top-max-8:rect.bottom+8,bottom-max));
  const key=[x,y,width,max].join();if(key===last)return;last=key;panel.style.left=x+'px';panel.style.top=y+'px';panel.style.width=width+'px';panel.style.maxHeight=max+'px';
 };
 const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(position)};
 new MutationObserver(schedule).observe(panel,{attributes:true,childList:true,subtree:true});
 for(const event of ['resize','scroll']){window.addEventListener(event,schedule,true);window.visualViewport?.addEventListener(event,schedule)}
};
