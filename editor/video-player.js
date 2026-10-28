// One media element owns playback for both inline and fullscreen presentations.
const players=new Set();
const paths={play:'M8 5v14l11-7z',pause:'M6 5h4v14H6zM14 5h4v14h-4z',expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',close:'M6 6l12 12M18 6L6 18',volume:'M11 5L6 9H3v6h3l5 4zM15 8a6 6 0 010 8M18 5a10 10 0 010 14',back:'M4 8V3m0 5h5M4 8a9 9 0 11-1 8',forward:'M20 8V3m0 5h-5M20 8a9 9 0 101 8'};
function icon(name){
 const optical={
  pause:'<rect x="5.4" y="3" width="5.6" height="18" rx="1.5"/><rect x="13" y="3" width="5.6" height="18" rx="1.5"/>',
  play:'<path d="M8 4.5Q7 4 7 5.5v13Q7 20 8.5 19l10-6Q20 12 18.5 11z"/>',
  volume:'<path fill="currentColor" stroke="none" d="M11 4.8 6 9H3v6h3l5 4.2z"/><path d="M14.5 8.5a5.5 5.5 0 0 1 0 7M17.5 5.5a9.6 9.6 0 0 1 0 13M20 3a13 13 0 0 1 0 18"/>',
  back:'<path d="M10 3.7a8.4 8.4 0 1 1-5.3 3.5M10 3.7 7 1m3 2.7L7 7"/>',
  forward:'<path d="M14 3.7a8.4 8.4 0 1 0 5.3 3.5M14 3.7 17 1m-3 2.7L17 7"/>'
 };
 const ten='<path class="eb-video-ten" transform="translate(.435 0) scale(.9 1)" d="M7.2 9.5 9.8 8v9m6-9a2.7 4.5 0 1 1 0 9a2.7 4.5 0 1 1 0-9"/>';
 return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(optical[name]||'<path d="'+paths[name]+'"/>')+(['back','forward'].includes(name)?ten:'')+'</svg>';
}
export function mediaMime(file){const mime=(file.mime||'').toLowerCase();if(mime&&mime!=='application/octet-stream')return mime;return ({mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo'})[(file.name||'').split('.').pop().toLowerCase()]||mime||'application/octet-stream'}
export function createVideoPlayer({open=()=>{},retry}={}){
 const root=document.createElement('div');root.className='eb-video';root.tabIndex=0;root.setAttribute('role','region');root.setAttribute('aria-label','视频播放器');
 const video=document.createElement('video');video.preload='metadata';video.playsInline=true;video.controls=false;video.setAttribute('playsinline','');
 const controls=document.createElement('div');controls.className='eb-video-controls';
 const top=document.createElement('div');top.className='eb-video-top';
 const center=document.createElement('div');center.className='eb-video-center';
 const bottom=document.createElement('div');bottom.className='eb-video-bottom';
 function button(label,kind,parent,action){const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon(kind);b.onclick=action;parent.append(b);return b}
 const full=button('全屏','expand',top,()=>void fullscreen());
 const back=button('后退 10 秒','back',center,()=>seek(-10));back.className='eb-video-skip';
 const play=button('播放','play',center,()=>void toggle());play.className='eb-video-play';
 const forward=button('快进 10 秒','forward',center,()=>seek(10));forward.className='eb-video-skip';
 const timeline=document.createElement('input');timeline.type='range';timeline.min='0';timeline.max='0';timeline.step='0.05';timeline.value='0';timeline.setAttribute('aria-label','视频进度');timeline.disabled=true;
 const times=document.createElement('div');times.className='eb-video-times';const elapsed=document.createElement('span'),remaining=document.createElement('span');times.append(elapsed,remaining);
 const options=document.createElement('div');options.className='eb-video-options';
 const speed=document.createElement('select');speed.setAttribute('aria-label','播放速度');for(const v of [.5,.75,1,1.25,1.5,2]){const o=document.createElement('option');o.value=v;o.textContent=v+'×';o.selected=v===1;speed.append(o)}speed.onchange=()=>{video.playbackRate=Number(speed.value)};
 const mute=button('静音','volume',options,()=>{video.muted=!video.muted;volume.value=video.muted?'0':String(video.volume);mute.setAttribute('aria-pressed',String(video.muted))});
 const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value='1';volume.setAttribute('aria-label','音量');volume.oninput=()=>{video.volume=Number(volume.value);video.muted=video.volume===0};video.addEventListener('volumechange',()=>{volume.value=video.muted?'0':String(video.volume);volume.style.setProperty('--progress',Number(volume.value)*100+'%');mute.setAttribute('aria-pressed',String(video.muted))});const sound=document.createElement('div');sound.className='eb-video-sound';sound.append(volume,mute);top.append(sound);options.append(speed);
 const message=document.createElement('div');message.className='eb-video-message';message.setAttribute('role','status');
 const text=document.createElement('span');const again=document.createElement('button');again.type='button';again.textContent='重试';again.onclick=()=>void reload();const external=document.createElement('button');external.type='button';external.textContent='保存或外部打开';external.onclick=()=>{video.pause();open()};message.append(text,again,external);message.hidden=true;
 bottom.append(timeline,times,options);controls.append(top,center,bottom);root.append(video,controls,message);
 let progressTimer,fullscreenEpoch=0,recoveredEpoch=-1;
 let hideTimer,loadTimer,disposed=false,failed=false,source='',file=null,revision=0;
 const format=n=>{n=Number.isFinite(n)?Math.max(0,n):0;return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')};
 function update(){const duration=Number.isFinite(video.duration)?video.duration:0;timeline.max=String(duration);timeline.disabled=!duration;timeline.value=String(video.currentTime||0);timeline.style.setProperty('--progress',(duration?100*video.currentTime/duration:0)+'%');timeline.setAttribute('aria-valuetext',format(video.currentTime)+' / '+format(duration));elapsed.textContent=format(video.currentTime);remaining.textContent=root.classList.contains('is-fullscreen')?'-'+format(duration-video.currentTime):format(duration);play.innerHTML=icon(video.paused?'play':'pause');play.setAttribute('aria-label',video.paused?'播放':'暂停');}
 function show(){root.classList.remove('controls-hidden');clearTimeout(hideTimer);if(!video.paused&&!failed)hideTimer=setTimeout(()=>{if(!root.matches(':focus-visible')&&!root.querySelector(':focus-visible'))root.classList.add('controls-hidden')},2800)}
 function fail(reason){failed=true;clearTimeout(loadTimer);video.pause();root.classList.remove('controls-hidden');text.textContent=reason;message.hidden=false;again.hidden=false;external.hidden=false;root.dataset.state='error'}
 function waiting(force=false){if(failed)return;if(force!==true&&video.paused&&video.readyState>=1){clearTimeout(loadTimer);message.hidden=true;root.dataset.state='paused';return}root.dataset.state='waiting';message.hidden=false;text.textContent='正在缓冲…';again.hidden=true;external.hidden=true;clearTimeout(loadTimer);loadTimer=setTimeout(()=>fail('视频加载超时，请重试或保存后打开'),20000)}
 function ready(){if(failed)return;if(video.videoWidth&&video.videoHeight){root.style.setProperty('--video-ratio',video.videoWidth+'/'+video.videoHeight);root.style.setProperty('--video-aspect',String(video.videoWidth/video.videoHeight));root.dataset.orientation=video.videoHeight>video.videoWidth?'portrait':'landscape'}clearTimeout(loadTimer);message.hidden=true;root.dataset.state=video.paused?'paused':'playing';update();}
 async function toggle(){if(failed){await reload();return}if(!video.paused){video.pause();return}for(const p of players)if(p!==api)p.pause();try{await video.play()}catch(e){if(e.name==='NotAllowedError'){show();text.textContent='请轻触播放';message.hidden=false;again.hidden=true;external.hidden=true}else fail('此设备无法播放该视频编码，请保存后使用外部播放器')}show()}
 function seek(delta){if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+delta));show()}
 // A WebView surface handoff can leave Android at HAVE_CURRENT_DATA forever.
 // Re-seek the same point once only after measured lack of progress; no load,
 // new source, second player, permission change or ordinary-playback seek.
 function watchFullscreenProgress(){
  clearTimeout(progressTimer);
  if(document.documentElement.dataset.platform!=='android'||document.fullscreenElement!==root||video.paused||failed||recoveredEpoch===fullscreenEpoch)return;
  const position=video.currentTime,expected=source,epoch=fullscreenEpoch;
  progressTimer=setTimeout(()=>{
   if(disposed||failed||video.error||source!==expected||document.fullscreenElement!==root||video.paused||fullscreenEpoch!==epoch||Math.abs(video.currentTime-position)>.1||video.readyState>=3)return;
   recoveredEpoch=epoch;
   try{root.dataset.fullscreenRecovery='same-position-seek';video.currentTime=position}catch{}
  },1500);
 }
 timeline.oninput=()=>{if(Number.isFinite(video.duration))video.currentTime=Number(timeline.value);update();show()};
 async function fullscreen(){show();try{if(document.fullscreenElement===root){await document.exitFullscreen();return}if(!root.requestFullscreen){text.textContent='当前浏览器不支持全屏';message.hidden=false;return}await root.requestFullscreen();try{await screen.orientation?.lock?.('landscape')}catch{}}catch{show();text.textContent='无法进入全屏，请重试';message.hidden=false;again.hidden=true;external.hidden=true}}
 let ownedFullscreen=false;
 function fullChanged(){const isFull=document.fullscreenElement===root;if(isFull&&!ownedFullscreen)fullscreenEpoch++;if(!isFull)clearTimeout(progressTimer);root.classList.toggle('is-fullscreen',isFull);full.innerHTML=icon(isFull?'close':'expand');full.setAttribute('aria-label',isFull?'退出全屏':'全屏');if(ownedFullscreen&&!isFull)screen.orientation?.unlock?.();ownedFullscreen=isFull;layout();update();show();if(isFull)watchFullscreenProgress()}
 // Compact Photos controls sit on the picture; fullscreen keeps the same video node.
 function layout(){const expanded=root.classList.contains('is-fullscreen');expanded?center.insertBefore(play,forward):bottom.prepend(play)}
 layout();
 // Calibrated against the 874×402 effective display in the supplied reference.
 // Pixels scale from the player, never from the surrounding editor/card.
 const measure=()=>root.style.setProperty('--ios-player-unit',(root.clientWidth/(root.classList.contains('is-fullscreen')?874:402))+'px');
 const sizing=typeof ResizeObserver==='function'?new ResizeObserver(measure):null;sizing?.observe(root);window.addEventListener('resize',measure);
 function visibility(){if(document.hidden)video.pause()}
 root.onkeydown=e=>{if(e.target.matches('input,select,button'))return;if(e.code==='Space'){e.preventDefault();void toggle()}else if(e.key==='ArrowLeft')seek(-10);else if(e.key==='ArrowRight')seek(10)};
 // Touch focuses the region before click. Preserve pre-focus visibility so focusin
 // cannot reveal controls and have the same tap immediately hide them again.
 let tapWasHidden=null;
 video.addEventListener('pointerdown',()=>{tapWasHidden=root.classList.contains('controls-hidden')});
 video.addEventListener('pointercancel',()=>{tapWasHidden=null});
 video.onclick=()=>{const reveal=tapWasHidden??root.classList.contains('controls-hidden');tapWasHidden=null;if(reveal)show();else if(!video.paused)root.classList.add('controls-hidden');else void toggle()};
 root.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')show()});root.addEventListener('focusin',show);
 for(const type of ['loadedmetadata','durationchange','canplay','seeked'])video.addEventListener(type,ready);
 video.addEventListener('play',watchFullscreenProgress);video.addEventListener('waiting',watchFullscreenProgress);video.addEventListener('pause',()=>clearTimeout(progressTimer));
 video.addEventListener('timeupdate',update);video.addEventListener('playing',()=>{ready();show()});video.addEventListener('pause',()=>{if(!failed&&video.readyState>=1)ready();else update();show()});video.addEventListener('ended',()=>{update();show()});
 for(const type of ['waiting','stalled'])video.addEventListener(type,waiting);
 video.addEventListener('error',()=>fail(video.error?.code===2?'视频读取失败，请重试':'此设备不支持该视频编码或文件已损坏，请保存后打开'));
 document.addEventListener('fullscreenchange',fullChanged);document.addEventListener('visibilitychange',visibility);
 function setFile(next){if(disposed)return;file=next;root.setAttribute('aria-label',next.name||'视频');if(source===next.url&&!failed)return;failed=false;source=next.url;video.src=source;waiting(true);video.load()}
 async function reload(){const version=++revision,pos=video.currentTime||0,rate=video.playbackRate;again.disabled=true;try{const next=retry?await retry():file;if(disposed||version!==revision)return;source='';setFile(next);video.playbackRate=rate;video.addEventListener('loadedmetadata',()=>{if(!disposed&&version===revision)video.currentTime=Math.min(pos,video.duration||0)},{once:true})}catch{if(!disposed)fail('附件读取失败，请联网后重试')}finally{again.disabled=false}}
 const api={root,video,get disposed(){return disposed},setFile,pause:()=>video.pause(),destroy(){disposed=true;clearTimeout(progressTimer);sizing?.disconnect();window.removeEventListener('resize',measure);revision++;clearTimeout(hideTimer);clearTimeout(loadTimer);document.removeEventListener('fullscreenchange',fullChanged);document.removeEventListener('visibilitychange',visibility);if(document.fullscreenElement===root)void document.exitFullscreen();video.pause();video.removeAttribute('src');video.load();players.delete(api)}};players.add(api);update();return api;
}
