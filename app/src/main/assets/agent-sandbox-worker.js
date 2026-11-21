'use strict';
// Easybook Android opt-in code sandbox. This worker has no DOM, native bridge or
// access to Easybook notes. All persisted files are explicitly scoped by the host.
const MAX_FILE=131072, MAX_TOTAL=524288, MAX_FILES=48, MAX_OUTPUT=16000;
const pending=new Map();
let counter=0;
const validPath=value=>typeof value==='string'&&value.length>0&&value.length<=180&&!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.'))&&/^[A-Za-z0-9_./-]+$/.test(value);
const errorText=e=>String(e?.message||e||'执行失败').slice(0,1000);
self.onmessage=async event=>{
 const message=event.data||{};
 if(message.type==='network-result'){
  const job=pending.get(message.requestId);
  if(job){pending.delete(message.requestId);message.ok?job.resolve(String(message.text||'')):job.reject(Error(message.error||'网络请求失败'))}
  return;
 }
 if(message.type!=='execute')return;
 const {id,code}=message;
 if(typeof id!=='string'||typeof code!=='string'||code.length>10000){self.postMessage({type:'done',id,ok:false,error:'无效执行请求'});return}
 const files=new Map(),logs=[];
 const say=(...values)=>{
  const line=values.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ');
  if(logs.join('\n').length<MAX_OUTPUT)logs.push(line.slice(0,MAX_OUTPUT));
 };
 try{
  for(const [name,data] of Object.entries(message.files||{})){
   if(!validPath(name)||typeof data!=='string'||data.length>MAX_FILE)throw Error('工作区文件无效');
   files.set(name,data);
  }
  const size=()=>[...files.values()].reduce((sum,value)=>sum+value.length,0);
  const sandbox=Object.freeze({
   readFile(name){if(!validPath(name))throw Error('路径无效');if(!files.has(name))throw Error('文件不存在');return files.get(name)},
   writeFile(name,data){if(!validPath(name))throw Error('路径无效');if(typeof data!=='string'||data.length>MAX_FILE)throw Error('文件必须为不超过 128 KB 的文本');if(!files.has(name)&&files.size>=MAX_FILES)throw Error('文件数量超过上限');const previous=files.get(name);files.set(name,data);if(size()>MAX_TOTAL){if(previous===undefined)files.delete(name);else files.set(name,previous);throw Error('沙箱总存储超过 512 KB')};return data.length},
   deleteFile(name){if(!validPath(name))throw Error('路径无效');return files.delete(name)},
   listFiles(){return [...files.entries()].map(([name,value])=>({name,bytes:value.length}))},
   async fetchText(url){
    if(typeof url!=='string'||url.length>2048)throw Error('URL 无效');
    const requestId=id+':'+(++counter);
    const response=new Promise((resolve,reject)=>pending.set(requestId,{resolve,reject}));
    self.postMessage({type:'network',id,requestId,url});
    return response;
   }
  });
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const execute=new AsyncFunction('sandbox','print','console','"use strict";\n'+code);
  const value=await execute(sandbox,say,Object.freeze({log:say,error:say,warn:say}));
  self.postMessage({type:'done',id,ok:true,output:logs.join('\n').slice(0,MAX_OUTPUT),value:typeof value==='undefined'?'':String(typeof value==='string'?value:JSON.stringify(value)).slice(0,4000),files:Object.fromEntries(files)});
 }catch(e){self.postMessage({type:'done',id,ok:false,error:errorText(e),output:logs.join('\n').slice(0,MAX_OUTPUT)})}
};
