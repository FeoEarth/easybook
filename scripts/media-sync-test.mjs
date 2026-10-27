import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {SyncActivity} from '../shared/sync-activity.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label='condition'){for(let i=0;i<100;i++){if(check())return;await sleep(20)}throw Error('Timed out: '+label)}
const storage=new Map(),journal=new SyncActivity({getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},()=> 'test');
journal.set('x','文件','image','up','queued');journal.set('x','文件','image','up','running');journal.progress('x',12,24);assert.equal(journal.tasks[0].loaded,12);journal.fail('x');assert.equal(journal.tasks[0].state,'failed');journal.set('x','文件','image','up','running');journal.finish('x');assert.equal(journal.tasks.length,1);assert.equal(journal.tasks[0].state,'done');for(let i=0;i<65;i++){journal.set('h'+i,'历史','note','down','done')}assert.equal(journal.tasks.length,66,'recent history is retained by age, not truncated to a fixed 60 entries');
const html=readFileSync('app/src/main/assets/index.html','utf8'),page=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),w=page.window;
w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.indexedDB=new IDBFactory();w.scrollTo=w.scrollBy=()=>{};let urlSerial=0;w.URL.createObjectURL=()=> 'blob:test/'+(++urlSerial);w.URL.revokeObjectURL=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};Object.defineProperty(w,'crypto',{value:crypto});let savedFile=null,sharedFile=null;w.HTMLAnchorElement.prototype.click=function(){savedFile={name:this.download,url:this.href}};w.navigator.canShare=()=>true;w.navigator.share=async data=>{sharedFile=data.files[0]};let online=false;Object.defineProperty(w.navigator,'onLine',{get:()=>online});
const remoteFiles=new Map(),remoteParts=new Map(),remoteNotes=new Map(),requests=[],progress=[];let failUpload=true;
w.XMLHttpRequest=class {
 constructor(){this.upload={}}
 open(method,url){this.method=method;this.url=url}
 setRequestHeader(){}
 send(body){
  requests.push({method:this.method,url:this.url});
  const address=new URL(this.url),id=address.pathname.split('/').pop();
  setTimeout(()=>{
   if(this.method==='PUT'&&failUpload){this.status=503;this.responseText='{}';this.onload();return}
   let data,status=200;
   if(this.method==='PUT'){
    const value=JSON.parse(body);
    this.upload.onprogress?.({loaded:20,total:40,lengthComputable:true});
    progress.push(w.easybookActivity.tasks.find(t=>t.id==='asset:'+id+':up')?.state);
    if(value.op==='part'&&address.searchParams.has('part-upload')){
     const bytes=Buffer.from(value.data,'base64');
     remoteParts.set(id+':'+value.index,{data:value.data,hash:value.hash,size:bytes.length});
     data={hash:value.hash,size:bytes.length};
    }else if(value.op==='commit'&&value.manifest?.id===id){
     const manifest=value.manifest;
     const valid=manifest.localOnly||manifest.parts.every((part,index)=>{
      const stored=remoteParts.get(id+':'+index);
      return stored?.hash===part.hash&&stored?.size===part.size;
     });
     if(valid){remoteFiles.set(id,manifest);data={id,size:manifest.size,localOnly:manifest.localOnly}}
     else status=409;
    }else status=400;
   }else{
    data=address.searchParams.has('part')?remoteParts.get(id+':'+address.searchParams.get('part')):remoteFiles.get(id);
    if(!data)status=404;
    this.onprogress?.({loaded:10,total:20,lengthComputable:true});
   }
   this.status=status;this.responseText=JSON.stringify(data||{});this.onload();
  },10);
 }
};
w.fetch=async(url,options={})=>{requests.push({method:options.method||'GET',url});let data;if(url.includes('/api/folders'))data={folders:[],next:null};else if(options.method==='PUT'){const n=JSON.parse(options.body),note={...n,version:(n.version||0)+1};remoteNotes.set(n.id,note);data={note};}else data={notes:[...remoteNotes.values()],cursor:1,hasMore:false};return {ok:true,status:200,json:async()=>data}};
w.eval(readFileSync('app/src/main/assets/editor.js','utf8'));w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);await sleep(100);const $=id=>w.document.getElementById(id),r=w.easybookRich;assert.ok(r,'app boots');$('newTop').click();r.editor.commands.insertContent('前文');r.editor.commands.setTextSelection(2);
async function pick(file){const media=file.type.startsWith('image/')||file.type.startsWith('video/'),input=$(media?'mediaFile':'attachmentFile');let opened;const pickerOpened=new Promise(resolve=>opened=resolve),originalClick=input.click.bind(input);input.click=()=>opened();try{$('attachmentButton').click();w.document.querySelector('[data-content-action="'+(media?'media':'files')+'"]').click();await Promise.race([pickerOpened,new Promise((_,reject)=>setTimeout(()=>reject(Error('attachment picker was not opened')),3000))]);Object.defineProperty(input,'files',{configurable:true,value:[file]});await input.onchange()}finally{input.click=originalClick}await sleep(70)}
// jsdom File lacks Blob.stream(), which the real browser and upload hash path require.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1cAAAAASUVORK5CYII=','base64');await pick(new File([png],'图片.png',{type:'image/png'}));assert.equal(r.value().doc.content[1]?.type,'image','image inserted at saved caret: '+JSON.stringify(r.value().doc.content));await until(()=>w.document.querySelector('[data-type=image] img')?.src.startsWith('blob:'),'inline image');assert.ok(w.document.querySelector('[data-type=image] img').src.startsWith('blob:'));assert.equal(w.document.querySelector('[data-type=image] img').hidden,false);
const saved=w.RichNotes.serialize(r.value());r.load(JSON.parse(saved));await sleep(30);assert.equal(w.RichNotes.serialize(r.value()),saved);assert.ok(w.document.querySelector('[data-type=image] img').src);
w.document.querySelector('.media-open').click();await sleep(40);assert.equal($('attachmentDialog').open,true);$('previewStage').dispatchEvent(new w.MouseEvent('dblclick'));assert.ok($('attachmentPreview').style.transform.includes('scale(2)'));$('attachmentDialog').close();assert.equal($('attachmentPreview').getAttribute('src'),null);
await pick(new File(['<script>safe text</script>'],'文档.txt',{type:'text/plain'}));assert.ok(r.value().doc.content.some(n=>n.type==='attachment'));await until(()=>w.document.querySelector('[data-type=attachment] .media-detail')?.textContent.includes('KB'),'file card ready');w.document.querySelector('[data-type=attachment] .media-open').click();await until(()=>$('previewStage').querySelector('pre'),'TXT preview');assert.equal($('previewStage').querySelector('pre').textContent,'<script>safe text</script>');assert.equal($('previewStage').querySelector('script'),null);$('attachmentDialog').close();
assert.ok(w.easybookActivity.tasks.some(t=>t.state==='waiting'));assert.equal(remoteFiles.size,0,'offline does not upload');online=true;w.dispatchEvent(new w.Event('online'));await sleep(180);assert.ok(w.easybookActivity.tasks.some(t=>t.state==='failed'));assert.equal(remoteNotes.size,0,'failed asset blocks note upload');failUpload=false;$('syncNow').click();await until(()=>remoteFiles.size===2,'both attachments uploaded after retry');await until(()=>remoteNotes.size===1,'note uploaded after attachments');assert.ok(w.easybookActivity.tasks.filter(t=>t.id.startsWith('asset:')&&t.direction==='up').every(t=>t.state==='done'));assert.ok(progress.every(s=>s==='running'),'wire progress does not confirm success');assert.ok(!w.easybookActivity.tasks.filter(t=>t.kind==='note').some(t=>t.total),'notes have no fabricated percentage');const ids=w.easybookActivity.tasks.map(t=>t.id);assert.equal(new Set(ids).size,ids.length);
const count=requests.filter(t=>t.url.includes('/api/attachments/')&&t.method==='PUT').length;await pick(new File([png],'图片副本.png',{type:'image/png'}));await sleep(200);assert.equal(requests.filter(t=>t.url.includes('/api/attachments/')&&t.method==='PUT').length,count,'cached content hash prevents redundant upload');assert.equal(remoteFiles.size,2);
$('activityEntry').click();assert.equal($('syncActivity').hidden,false);assert.equal(w.document.body.dataset.page,'sync');assert.ok($('syncTasks').textContent.includes('最近活动'));assert.ok(!$('syncTasks').textContent.includes(w.localStorage.getItem('easybook-key')));
$('syncBack').click();await until(()=>w.document.body.dataset.page!=='sync','leave activity');$('cards').querySelector('.note').click();
// Clear file cache to emulate a second Web client, preserve synced JSON and remote immutable files.
await new Promise((resolve,reject)=>{const q=w.indexedDB.deleteDatabase('easybook-files');q.onsuccess=resolve;q.onerror=reject});w.document.querySelector('[data-type=attachment] .media-open').click();await sleep(120);assert.ok(requests.some(t=>t.method==='GET'&&t.url.includes('/api/attachments/')));await until(()=>w.document.querySelector('[data-type=image] img')?.src.startsWith('blob:'),'inline image');assert.ok(w.document.querySelector('[data-type=image] img').src.startsWith('blob:'));assert.ok(w.easybookActivity.tasks.some(t=>t.direction==='down'&&t.kind!=='note'&&t.state==='done'));
$('attachmentDialog').close();
// Exercise gallery switching and the actual two-pointer gesture handlers.
await pick(new File([Buffer.concat([png,Buffer.from([0])])],'第二张.png',{type:'image/png'}));
await until(()=>w.document.querySelectorAll('[data-type=image] .media-open').length>=2,'second image');
await until(()=>w.document.querySelector('[data-type=image] .media-detail').textContent.includes('KB'));w.document.querySelector('[data-type=image] .media-open').click();await until(()=>$('attachmentDialog').open);assert.equal($('nextImage').hidden,false);const firstTitle=$('attachmentTitle').textContent;$('nextImage').click();await until(()=>$('attachmentTitle').textContent!==firstTitle,'gallery next');
const pointer=(type,id,x,y=100)=>{const event=new w.Event(type,{bubbles:true});Object.assign(event,{pointerId:id,clientX:x,clientY:y});$('previewStage').dispatchEvent(event)};
pointer('pointerdown',1,100);pointer('pointerdown',2,200);pointer('pointermove',2,300);assert.ok($('attachmentPreview').style.transform.includes('scale(2)'));pointer('pointerup',2,300);pointer('pointerup',1,100);$('attachmentDialog').close();
await pick(new File(['%PDF-1.4\n'],'预览.pdf',{type:'application/pdf'}));await until(()=>[...w.document.querySelectorAll('[data-type=attachment] .media-name')].some(e=>e.textContent==='预览.pdf'));
const pdfCard=[...w.document.querySelectorAll('[data-type=attachment]')].find(e=>e.querySelector('.media-name').textContent==='预览.pdf');await until(()=>pdfCard.querySelector('.media-detail').textContent.includes('KB'));pdfCard.querySelector('button').click();await until(()=>$('previewStage').querySelector('iframe'));assert.ok($('previewStage').querySelector('iframe').src.startsWith('blob:'));$('attachmentDialog').close();
const legacy={schemaVersion:1,doc:{type:'doc',content:[{type:'attachment',attrs:{assetId:'sha256:'+r.value().doc.content.find(n=>n.type==='image').attrs.assetId.slice(7),name:'旧图片.png',mime:'image/png',size:png.length}}]}};r.load(legacy);await until(()=>w.document.querySelector('[data-type=attachment] img')?.hidden===false,'legacy attachment image inline');assert.equal(r.value().doc.content[0].type,'attachment');
const manifest=readFileSync('app/src/main/AndroidManifest.xml','utf8'),permissions=readFileSync('app/src/main/java/com/feoearth/easybook/SecurityManager.java','utf8');assert.match(manifest,/FileProvider[\s\S]*android:exported="false"/);assert.match(permissions,/case "attachment.open":case "attachment.share"/);
console.log('PASS media/activity: caret image+file insertion, inline image/card DOM, JSON reload, preview/double-tap/close, safe TXT, real queued/running/failed/acknowledged states, wire progress, retry dedup, offline→online, mocked cross-client download and bounded history');
page.window.close();

