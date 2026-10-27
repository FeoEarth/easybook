import {createVideoPlayer,mediaMime} from './video-player.js';
// View-only media state. Binary URLs and transfer status never enter JSON.
export function mediaView(name, services, views){return ({node})=>{
 const dom=document.createElement('div');dom.className='inline-media';dom.dataset.type=name;dom.contentEditable='false';
 const button=document.createElement('button');button.type='button';button.className='media-open';
 const image=document.createElement('img');image.hidden=true;image.draggable=false;
 const title=document.createElement('span');title.className='media-name';
 const detail=document.createElement('small');detail.className='media-detail';detail.setAttribute('aria-live','polite');
 const video=document.createElement('div');video.hidden=true;button.append(image,title,detail);dom.append(video,button);let player=null,alive=true,serial=0,loaded=false,lastFile=null,loading=false;
 const id=node.attrs.assetId.slice(7);dom.dataset.assetId=id;
 function label(){title.textContent=node.attrs.name||node.attrs.alt||'图片';image.alt=node.attrs.alt||node.attrs.name||'图片';button.setAttribute('aria-label','打开 '+title.textContent)}label();
 function status(){if(lastFile?.localOnly){detail.textContent=lastFile.available===false?'此附件仅保存在原设备':'仅本地 · 原文件已保留';return}if(lastFile)detail.textContent=(lastFile.size===undefined?'':formatBytes(lastFile.size)+' · '+(lastFile.mime||'文件')+' · ')+(services.status?.(id)||(lastFile.dirty?'等待同步':'已缓存'))}
 async function refresh(){if(!services.resolve||loading)return;loading=true;const version=++serial;detail.textContent='正在读取…';try{const f=await services.resolve(id);if(!alive||version!==serial)return;loaded=true;lastFile=f;title.textContent=f.name||title.textContent;if(f.available!==false&&/^image\/(png|jpeg|gif|webp)$/.test(f.mime)){image.hidden=false;image.src=f.url;title.hidden=true;image.onerror=()=>{loaded=false;image.hidden=true;title.hidden=false;detail.textContent='图片无法显示，点击重试'}}if(f.available!==false&&/^video\//.test(mediaMime(f))){dom.classList.add('has-video');detail.hidden=true;video.hidden=false;if(!player){player=createVideoPlayer({open:()=>services.open?.(id,player),retry:async()=>{const f=await services.resolve(id,{retry:true});if(f.available===false)throw Error('Unavailable');return f}});video.replaceWith(player.root);player.root.hidden=false}player.setFile(f)}status();}catch{if(alive&&version===serial){loaded=false;detail.textContent='读取失败 · 点击重试'}}finally{loading=false}}
 button.onclick=()=>{if(!loaded)void refresh();else services.open?.(id,player)};
 const updateStatus=()=>{if(loaded&&!lastFile?.dirty)status();else void refresh()};views.add(updateStatus);void refresh();
 return {dom,update(next){if(next.type!==node.type||next.attrs.assetId!==node.attrs.assetId)return false;node=next;label();return true},stopEvent:()=>true,ignoreMutation:()=>true,destroy(){player?.destroy();alive=false;serial++;views.delete(updateStatus)}};
}}
export function formatBytes(size){return size>=1048576?(size/1048576).toFixed(1)+' MB':Math.max(0,size/1024).toFixed(1)+' KB'}

