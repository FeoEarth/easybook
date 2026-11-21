'use strict';
// This document is served only from agent-sandbox.easybook.invalid, a separate
// synthetic WebView origin. It has no account session and no Easybook bridge.
const PARENT='https://appassets.androidplatform.net';
let active=null;
const send=message=>parent.postMessage({sandboxChannel:'easybook-agent-v1',...message},PARENT);
window.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==PARENT)return;
 const m=event.data;
 if(!m||m.sandboxChannel!=='easybook-agent-v1'||typeof m.id!=='string')return;
 if(m.type==='execute'){
  if(active)return;
  const id=m.id;
  let worker;
  try{worker=new Worker('/worker.js');}
  catch(error){send({id,type:'done',ok:false,error:String(error.message||error)});return}
  active={id,worker};
  worker.onmessage=message=>{
   if(active?.worker!==worker)return;
   const payload=message.data||{};
   send({...payload,id});
   if(payload.type==='done'){worker.terminate();active=null;}
  };
  worker.onerror=error=>{
   if(active?.worker!==worker)return;
   send({id,type:'done',ok:false,error:String(error.message||'脚本运行失败')});
   worker.terminate();active=null;
  };
  worker.postMessage({type:'execute',id,code:m.code,files:m.files});
 }else if(m.type==='network-result'&&active?.id===m.id){
  active.worker.postMessage({type:'network-result',requestId:m.requestId,ok:m.ok,text:m.text,error:m.error});
 }else if(m.type==='cancel'&&active?.id===m.id){
  active.worker.terminate();active=null;
 }
});
send({type:'ready'});
