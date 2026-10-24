// Android presentation only. Reuse existing nodes/listeners and PM state.
(()=>{
 const track=document.getElementById('formatTrack');if(!track)return;
 function start(){
  const rich=window.easybookRich;if(!rich)return false;
  const find=selector=>track.querySelector(selector);
  const key=element=>element.id||element.dataset.command;
  const styles=document.createElement('style');styles.textContent='#formatTrack button{white-space:nowrap;flex-shrink:0;line-height:1}#formatTrack #formatButton{padding-inline:4px}#formatTrack .highlight-quick{display:flex;flex:0 0 auto;align-items:center;gap:0}#formatTrack .highlight-quick>button:first-child{border-radius:16px 0 0 16px}#formatTrack .highlight-quick>button:last-child{min-width:44px;width:44px;padding-inline:2px;border-radius:0 16px 16px 0;font-size:16px}#formatTrack>[hidden]{display:none!important}';document.head.append(styles);
  const aa=find('#formatButton');aa.textContent='Aa';aa.setAttribute('aria-label','完整格式');
  const high=find('#highlightButton'),palette=find('#highlightPalette'),cluster=document.createElement('div');cluster.className='highlight-quick';cluster.id='quickHighlight';high.before(cluster);cluster.append(high,palette);palette.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>'; palette.setAttribute('aria-label','选择高亮颜色');
  // Low-frequency actions remain in the existing complete panel, not deleted.
  const low=new Set(['textColorPalette','undoButton','redoButton','toolbarLink','toggleStrike','toggleBlockquote','toggleBulletList','toggleOrderedList','toolbarIndent','toolbarOutdent']);
  const groups={
   text:['formatButton','toggleBold','toggleItalic','toggleUnderline','quickHighlight','toggleTaskList','attachmentButton'],
   selection:['toggleBold','toggleItalic','toggleUnderline','toggleStrike','quickHighlight','toolbarLink','formatButton','toggleTaskList','attachmentButton'],
   list:['toggleBulletList','toggleOrderedList','toggleTaskList','toolbarOutdent','toolbarIndent','formatButton','toggleBold','toggleItalic','toggleUnderline','quickHighlight','attachmentButton'],
   multiline:['toggleBulletList','toggleOrderedList','toolbarOutdent','toolbarIndent','toggleBlockquote','formatButton','toggleBold','toggleItalic','toggleUnderline','quickHighlight','toggleTaskList','attachmentButton'],
   heading:['formatButton','toggleBold','toggleItalic','toggleUnderline','quickHighlight','toggleTaskList','attachmentButton']
  };
  let current='',pending='',timer=0,pressed=false,scrolling=false,scrollTimer=0;
  const entries=[...track.children];
  function context(){const editor=rich.editor,{selection}=editor.state;
   if(!selection.empty&&selection.$from.parent!==selection.$to.parent)return 'multiline';
   if(!selection.empty)return 'selection';
   if(editor.isActive('listItem')||editor.isActive('taskItem'))return 'list';
   return editor.isActive('heading')?'heading':'text';
  }
  function apply(){
   if(!pending||pending===current)return;
   if(pressed||scrolling||rich.isComposing()||document.getElementById('nativeHighlightPalette')?.open)return;
   const order=groups[pending];
   if(current&&groups[current].join()===order.join()){current=pending;pending='';track.dataset.context=current;return}
   const rect=track.getBoundingClientRect(),atStart=track.scrollLeft<3;
   const anchor=[...track.children].find(el=>!el.hidden&&el.getBoundingClientRect().right>rect.left+1&&el.getBoundingClientRect().left<rect.right),offset=anchor?anchor.getBoundingClientRect().left-rect.left:0;
   current=pending;pending='';
   for(const el of entries)el.hidden=low.has(key(el))&&!order.includes(key(el));
   for(const id of order){const el=entries.find(el=>key(el)===id);if(el)track.append(el)}
   for(const el of entries)if(!order.includes(key(el)))track.append(el);
   track.scrollLeft=atStart?0:anchor&&!anchor.hidden?track.scrollLeft+anchor.getBoundingClientRect().left-rect.left-offset:track.scrollLeft;
   track.dataset.context=current;
  }
  function schedule(){const next=context();if(next===current){pending='';clearTimeout(timer);return}if(next===pending)return;pending=next;clearTimeout(timer);timer=setTimeout(apply,180)}
  rich.editor.on('selectionUpdate',schedule);rich.editor.on('transaction',schedule);
  track.addEventListener('pointerdown',()=>{pressed=true},{passive:true});
  const release=()=>{pressed=false;clearTimeout(timer);timer=setTimeout(apply,200)};
  window.addEventListener('pointerup',release,true);window.addEventListener('pointercancel',release,true);
  track.addEventListener('scroll',()=>{scrolling=true;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{scrolling=false;apply()},240)},{passive:true});
  rich.editor.view.dom.addEventListener('compositionend',()=>{clearTimeout(timer);timer=setTimeout(()=>{schedule();apply()},200)});
  // The original toolbar release microtask runs first. Preserve the bookmark
  // for the asynchronous Android attachment menu/picker after that release.
  track.addEventListener('click',event=>{if(event.target.closest('#attachmentButton'))queueMicrotask(()=>{if(!rich.isComposing())rich.captureSelection()})},true);
  const more=document.getElementById('moreButton'),showMore=more.onclick;
  more.addEventListener('mousedown',event=>event.preventDefault());
  more.onclick=function(event){const focused=rich.editor.isFocused;showMore?.call(this,event);if(focused)rich.editor.commands.focus(undefined,{scrollIntoView:false})};
  window.installEasybookHighlightPalette?.(rich,high,palette,cluster);
  window.addEventListener('easybook-highlight-palette-closed',()=>{schedule();clearTimeout(timer);timer=setTimeout(apply,200)});
  pending=context();apply();return true;
 }
 if(start())return;
 const ready=new MutationObserver(()=>{if(start())ready.disconnect()});ready.observe(track,{subtree:true,attributes:true});
})();
