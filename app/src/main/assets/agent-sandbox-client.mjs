// Per-session file store and restricted Worker runner for Android Agent.
// No note database, account tokens, or native bridge objects are given to the Worker.
const DB_NAME='easybook-agent-sandbox-v1', STORE='files', MAX_TOTAL=524288, MAX_FILES=48;
const encodedSize=value=>new TextEncoder().encode(value).length;
const validPath=path=>typeof path==='string'&&path.length>0&&path.length<=180
 &&!path.startsWith('/')&&!path.includes('\\')
 &&!path.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.'))
 &&/^[A-Za-z0-9_./-]+$/.test(path);
let dbPending;
function database(){
 if(dbPending)return dbPending;
 dbPending=new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{
   const store=request.result.createObjectStore(STORE,{keyPath:'id'});
   store.createIndex('scope','scope',{unique:false});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('沙箱文件存储不可用'));
 });
 return dbPending;
}
async function scopeKey(workspace,sessionId){
 const bytes=new TextEncoder().encode(String(workspace)+'|'+String(sessionId));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
}
function txPromise(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('文件存储失败'));tx.onabort=()=>reject(tx.error||Error('文件存储中断'))})}
function checkFiles(files){
 const list=Object.entries(files||{});
 if(list.length>MAX_FILES)throw Error('沙箱文件超过数量限制');
 let total=0;
 for(const [path,data]of list){
  if(!validPath(path)||typeof data!=='string'||encodedSize(data)>131072)throw Error('沙箱文件不合法');
  total+=encodedSize(data);if(total>MAX_TOTAL)throw Error('沙箱空间超过 512 KB');
 }
}
async function readFiles(scope){
 const db=await database(),tx=db.transaction(STORE,'readonly');
 const request=tx.objectStore(STORE).index('scope').getAll(IDBKeyRange.only(scope));
 const rows=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 const files=Object.fromEntries(rows.map(row=>[row.path,row.data]));
 checkFiles(files);return files;
}
async function writeFiles(scope,files){
 checkFiles(files);
 const db=await database(),tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),index=store.index('scope');
 const request=index.openCursor(IDBKeyRange.only(scope));
 request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue()}else{
  for(const [path,data] of Object.entries(files))store.put({id:scope+'|'+path,scope,path,data});
 }};
 request.onerror=()=>tx.abort();
 await txPromise(tx);
}
const asError=error=>({code:'sandbox_error',message:String(error?.message||error||'沙箱执行失败').slice(0,800)});
const toolNames=new Set(['sandbox_execute','sandbox_list_files','sandbox_read_file']);
export async function executeSandboxTool({tool,args,workspace,sessionId,native,signal,authorize=()=>true}){
 if(!native||!toolNames.has(tool))throw Error('不支持的沙箱工具');
 const status=await native.call('sandbox.status');
 if(!status.enabled)throw Error('请先在 AI 设置中启用本地执行环境');
 if(signal?.aborted)throw new DOMException('已取消','AbortError');
 const scope=await scopeKey(workspace,sessionId);
 const files=await readFiles(scope);
 if(tool==='sandbox_list_files')return {ok:true,result:{files:Object.entries(files).map(([path,text])=>({path,bytes:new TextEncoder().encode(text).length}))}};
 if(tool==='sandbox_read_file'){
  if(!validPath(args.path)||!Object.hasOwn(files,args.path))return {ok:false,error:{message:'沙箱文件不存在'}};
  return {ok:true,result:{path:args.path,content:files[args.path].slice(0,16000),truncated:files[args.path].length>16000}};
 }
 if(args.language!=='javascript'||typeof args.code!=='string'||!args.code.trim()||args.code.length>10000)throw Error('当前只支持 JavaScript（最长 10000 字符）');
 if(!authorize())throw Error('沙箱会话授权已失效');
 const executionId=crypto.randomUUID(),frameOrigin='https://'+crypto.randomUUID().replaceAll('-','')+'.agent-sandbox.easybook.invalid',channel='easybook-agent-v1';
 return new Promise((resolve,reject)=>{
  let frame,finished=false,committing=false,started=false;
  const cleanup=()=>{
   clearTimeout(timer);
   signal?.removeEventListener('abort',cancel);
   window.removeEventListener('message',onMessage);
   if(frame){try{frame.contentWindow?.postMessage({sandboxChannel:channel,id:executionId,type:'cancel'},frameOrigin)}catch{}frame.remove();}
  };
  const end=(ok,value)=>{if(finished)return;finished=true;cleanup();ok?resolve(value):reject(value)};
  const cancel=()=>end(false,new DOMException('已取消','AbortError'));
  const timer=setTimeout(()=>end(true,{ok:false,error:{message:'代码运行超过 30 秒，已终止执行'}}),30000);
  const send=payload=>{if(!finished&&frame?.contentWindow)frame.contentWindow.postMessage({sandboxChannel:channel,id:executionId,...payload},frameOrigin)};
  const start=()=>{if(started||finished)return;started=true;send({type:'execute',code:args.code,files})};
  const onMessage=async event=>{
   if(finished||!frame||event.source!==frame.contentWindow||event.origin!==frameOrigin)return;
   const m=event.data||{};
   if(m.sandboxChannel!==channel)return;
   if(m.type==='ready'){start();return}
   if(m.id!==executionId)return;
   if(m.type==='network'){
    try{if(!authorize())throw Error('沙箱会话授权已失效');
     const data=await native.call('sandbox.fetch',{url:m.url});
     if(!finished&&authorize())send({type:'network-result',requestId:m.requestId,ok:true,text:data.text});
    }catch(error){if(!finished)send({type:'network-result',requestId:m.requestId,ok:false,error:String(error.message||error).slice(0,800)})}
    return;
   }
   if(m.type!=='done'||committing)return;
   committing=true;
   if(!m.ok){end(true,{ok:false,result:{stdout:String(m.output||'').slice(0,16000)},error:asError(m.error)});return}
   try{
    checkFiles(m.files);
    if(!authorize()||!(await native.call('sandbox.status')).enabled)throw Error('沙箱授权已撤销');
    await writeFiles(scope,m.files);
    end(true,{ok:true,result:{stdout:String(m.output||'').slice(0,16000),value:String(m.value||'').slice(0,4000),files:Object.keys(m.files)}});
   }catch(error){end(true,{ok:false,error:asError(error)})}
  };
  signal?.addEventListener('abort',cancel,{once:true});
  window.addEventListener('message',onMessage);
  try{
   frame=document.createElement('iframe');
   frame.hidden=true;
   frame.setAttribute('aria-hidden','true');
   frame.setAttribute('sandbox','allow-scripts allow-same-origin');
   frame.src=frameOrigin+'/runner.html';
   frame.onload=start;
   frame.onerror=()=>end(true,{ok:false,error:{message:'无法启动独立执行环境'}});
   document.body.append(frame);
   if(signal?.aborted)cancel();
  }catch(error){end(true,{ok:false,error:asError(error)})}
 });

}
export function isSandboxTool(name){return toolNames.has(name)}
