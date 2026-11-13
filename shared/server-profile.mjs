export function serverError(code,message=code){return Object.assign(Error(message),{code})}

/** Server addresses identify an origin, never a credential or an API path. */
export function normalizeOrigin(value,{clientOrigin}={}){
 if(typeof value!=='string'||!/^https?:\/\/[^/?#]+\/?$/i.test(value.trim()))throw serverError('INVALID_SERVER_ORIGIN','Enter a server origin without a path, query or fragment');
 let url;try{url=new URL(value.trim())}catch{throw serverError('INVALID_SERVER_ORIGIN','Invalid server origin')}
 if(url.username||url.password||value.slice(value.indexOf('//')+2).includes('@'))throw serverError('INVALID_SERVER_ORIGIN','Server origins cannot contain credentials');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local&&clientOrigin===url.origin))throw serverError('HTTPS_SERVER_REQUIRED','Web connections require HTTPS; local HTTP development must use its own page');
 return url.origin;
}

export async function serverId(origin){const canonical=normalizeOrigin(origin,{clientOrigin:origin}),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('')}

export async function profileFor(origin,{builtin=false,name}={}){
 const id=await serverId(origin);
 return {id,origin,builtin,name:name||origin,dbName:builtin?'easybook-json-v1':'easybook-json-v1:'+id,filesDbName:builtin?'easybook-files':'easybook-files:'+id,storagePrefix:builtin?'':'server:'+id+':'};
}

export async function probeServer(origin,{fetch:fetcher=globalThis.fetch,timeoutMs=8000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetcher(origin+'/.well-known/easybook.json',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw serverError('SERVER_DISCOVERY_FAILED','Server discovery returned HTTP '+response.status);
  const text=await response.text();if(text.length>16384)throw serverError('INVALID_SERVER_DISCOVERY','Server discovery is too large');
  let value;try{value=JSON.parse(text)}catch{throw serverError('INVALID_SERVER_DISCOVERY','Server discovery must be JSON')}
  if(value?.protocolVersion!==1||value.serverOrigin!==origin||value.capabilities?.sync!==true||value.capabilities?.accounts!==true||value.capabilities?.webConnector!==true)throw serverError('INCOMPATIBLE_SERVER','Server must support protocol 1, accounts, sync and the Web connector at this origin');
  return {protocolVersion:1,serverOrigin:origin,capabilities:Object.fromEntries(['sync','keySync','accounts','webConnector','passkeys','httpKeyOnly'].map(key=>[key,value.capabilities[key]===true]))};
 }finally{clearTimeout(timer)}
}
