const HEX=/^[a-f0-9]{64}$/;
const SESSION='server-web-session-v1',REVOKED='server-web-revocations-v1';
const CHANNEL='easybook-server-login:';
const revocationLocks=new Map();
const encoder=new TextEncoder();
const failure=(code,message,status)=>Object.assign(new Error(message),{code,...(status?{status}:{})});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Cross-site account authorization. Cookies and credentials from other server
 * profiles never participate in this protocol. The profile store owns the
 * activation gate, encryption key, and transaction lifetime. */
export class WebServerAuth {
 constructor({profile,store,fetch=globalThis.fetch,clientOrigin=globalThis.location?.origin,
  assertActive=async()=>{},onChange=()=>{},window=globalThis.window,
  BroadcastChannel=globalThis.BroadcastChannel,crypto=globalThis.crypto,
  now=()=>Date.now(),setTimeout=globalThis.setTimeout,clearTimeout=globalThis.clearTimeout,
  requestTimeout=12000,locks=globalThis.navigator?.locks}={}){
  const origin=new URL(profile?.origin),client=new URL(clientOrigin);
  if(profile.builtin||origin.protocol!=='https:'||origin.origin!==profile.origin||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)
   throw failure('INVALID_SERVER','账户授权只支持 HTTPS 服务器');
  if(client.origin!==clientOrigin||client.username||client.password||client.pathname!=='/'||client.search||client.hash||
   client.protocol!=='https:'&&!(client.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(client.hostname)))
   throw failure('INVALID_CLIENT','账户授权需要安全的网页来源');
  if(!HEX.test(profile.id)||!store?.vaultGet||!store?.vaultKey||!store?.vaultPut||!store?.vaultDelete||typeof fetch!=='function')
   throw failure('INVALID_AUTH_STORE','服务器凭据存储不可用');
  this.profile=Object.freeze({...profile});this.store=store;this.fetch=fetch;this.clientOrigin=client.origin;
  this.assertActive=assertActive;this.onChange=onChange;this.window=window;this.Channel=BroadcastChannel;
  this.crypto=crypto;this.now=now;this.setTimeout=setTimeout;this.clearTimeout=clearTimeout;
  this.requestTimeout=requestTimeout;this.redirectUri=client.origin+'/server-callback';
  this.locks=locks;
  this.generation=0;this.pending=null;this.controllers=new Set();this.loggingOut=false;
  this.tasks=new Set();this.cancellation=Promise.resolve();
 }
 async check(generation=this.generation){
  if(generation!==this.generation)throw failure('AUTH_CANCELLED','登录操作已取消');
  await this.assertActive();
  if(generation!==this.generation)throw failure('AUTH_CANCELLED','登录操作已取消');
 }
 notify(value){try{Promise.resolve(this.onChange(value)).catch(()=>{})}catch{}}
 track(task){this.tasks.add(task);task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task}
 withRevocations(task){
  const name='easybook-web-auth-revocations:'+this.profile.id;
  if(this.locks?.request)return this.locks.request(name,task);
  const previous=revocationLocks.get(name)||Promise.resolve(),result=previous.then(task,task),settled=result.then(()=>{},()=>{});
  revocationLocks.set(name,settled);settled.then(()=>{if(revocationLocks.get(name)===settled)revocationLocks.delete(name)});return result;
 }
 randomHex(){return Array.from(this.crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')}
 base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
 aad(name){return encoder.encode('easybook-web-auth-v1:'+this.profile.id+':'+this.profile.origin+':'+name)}
 async readSecret(name,generation=this.generation){
  await this.check(generation);const record=await this.store.vaultGet(name);await this.check(generation);
  if(!record)return null;
  if(record.version!==1||record.profileId!==this.profile.id||record.origin!==this.profile.origin)
   throw failure('CREDENTIAL_UNAVAILABLE','服务器凭据归属不匹配');
  const key=await this.store.vaultGet('key');if(!key)throw failure('CREDENTIAL_UNAVAILABLE','本机凭据密钥不可用');
  let value;try{const bytes=await this.crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:this.aad(name)},key,record.data);value=JSON.parse(new TextDecoder().decode(bytes))}
  catch{throw failure('CREDENTIAL_UNAVAILABLE','本机服务器凭据无法解密')}
  await this.check(generation);return value;
 }
 async writeSecret(name,value,generation,operationId=this.randomHex(),guard=()=>{}){
  await this.check(generation);guard();const key=await this.store.vaultKey();await this.check(generation);guard();
  const iv=this.crypto.getRandomValues(new Uint8Array(12));
  const data=await this.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:this.aad(name)},key,encoder.encode(JSON.stringify(value)));
  await this.check(generation);guard();
  await this.store.vaultPut(name,{version:1,profileId:this.profile.id,origin:this.profile.origin,operationId,iv,data});
  try{await this.check(generation);guard()}
  catch(error){try{await this.store.vaultDelete(name,{operationId})}catch{}throw error}
 }
 async credential(generation=this.generation){
  const record=await this.readSecret(SESSION,generation);if(!record)return null;
  if(!object(record)||!HEX.test(record.token)||!HEX.test(record.operationId)||typeof record.sessionId!=='string'||!Number.isSafeInteger(record.expiresAt))
   throw failure('CREDENTIAL_UNAVAILABLE','服务器会话格式不正确');
  if(record.expiresAt<=this.now()){await this.check(generation);await this.store.vaultDelete(SESSION,{operationId:record.operationId});await this.check(generation);return null}
  return record;
 }
 async request(path,{method='GET',body,token}={},generation=this.generation){
  await this.check(generation);
  if(!['/account/web/start','/account/web/token','/account/web/session','/account/web/logout'].includes(path))
   throw failure('INVALID_AUTH_PATH','无效的账户接口');
  const controller=new AbortController();this.controllers.add(controller);
  const timer=this.setTimeout(()=>controller.abort(),this.requestTimeout);
  try{
   const response=await this.fetch(this.profile.origin+path,{method,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Easybook-Web '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   await this.check(generation);const text=await response.text();await this.check(generation);
   if(text.length>65536)throw failure('INVALID_AUTH_RESPONSE','账户响应超过限制');
   let value;try{value=JSON.parse(text)}catch{throw failure('INVALID_AUTH_RESPONSE','账户响应格式不正确',response.status)}
   if(!object(value))throw failure('INVALID_AUTH_RESPONSE','账户响应格式不正确');
   if(!response.ok)throw failure(typeof value.error==='string'&&/^[a-z_]{1,80}$/.test(value.error)?value.error:'AUTH_HTTP_ERROR','账户请求失败（'+response.status+'）',response.status);
   return value;
  }finally{this.clearTimeout(timer);this.controllers.delete(controller)}
 }
 login(){
  const cleanup=this.cancel();
  if(typeof this.Channel!=='function')return Promise.reject(failure('AUTH_UNAVAILABLE','此浏览器不支持授权窗口通信'));
  // Open before awaiting storage or PKCE work, preserving the click's user gesture.
  const popup=this.window?.open?.('about:blank','easybook-server-login-'+this.randomHex().slice(0,12),'popup,width=520,height=720');
  if(!popup)return Promise.reject(failure('POPUP_BLOCKED','浏览器阻止了授权窗口，请允许弹窗后重新登录'));
  // The untrusted server only needs BroadcastChannel; it must not navigate our tab.
  try{popup.opener=null}catch{try{popup.close()}catch{}return Promise.reject(failure('AUTH_UNAVAILABLE','此浏览器无法安全打开授权窗口'))}
  const generation=this.generation,state=this.randomHex(),verifier=this.base64url(this.crypto.getRandomValues(new Uint8Array(32)));
  let resolve,reject;const result=new Promise((yes,no)=>{resolve=yes;reject=no});
  const pending={generation,state,verifier,popup,expiresAt:this.now()+300000,done:false,exchanging:false};
  pending.finish=(error,value)=>{
   if(pending.done)return;pending.done=true;this.clearTimeout(pending.timer);pending.channel?.close();
   try{popup.close()}catch{}
   if(this.pending===pending)this.pending=null;
   error?reject(error):resolve(value);
  };
  this.pending=pending;
  pending.timer=this.setTimeout(()=>pending.finish(failure('AUTH_EXPIRED','登录请求已过期，请重新开始')),300000);
  this.track(cleanup.then(()=>this.begin(pending))).catch(error=>pending.finish(error));return result;
 }
 pendingCheck(pending){
  if(this.pending!==pending||pending.done||pending.generation!==this.generation)
   throw failure('AUTH_CANCELLED','登录操作已取消');
  if(pending.expiresAt<=this.now())throw failure('AUTH_EXPIRED','登录请求已过期，请重新开始');
 }
 async begin(pending){
  const generation=pending.generation;await this.check(generation);this.pendingCheck(pending);
  const challenge=this.base64url(new Uint8Array(await this.crypto.subtle.digest('SHA-256',encoder.encode(pending.verifier))));
  await this.check(generation);this.pendingCheck(pending);
  const start=await this.request('/account/web/start',{method:'POST',body:{challenge,state:pending.state,redirect_uri:this.redirectUri}},generation);
  this.pendingCheck(pending);
  if(!HEX.test(start.flow)||!Number.isSafeInteger(start.expires_in)||start.expires_in<1||start.expires_in>300)
   throw failure('INVALID_AUTH_RESPONSE','服务器登录信息不正确');
  const destination=new URL(start.authorization_url);
  if(destination.origin!==this.profile.origin||destination.pathname!=='/account/web/authorize'||destination.username||destination.password||destination.hash||
   destination.searchParams.get('flow')!==start.flow||destination.searchParams.get('state')!==pending.state||
   [...destination.searchParams.keys()].length!==2)
   throw failure('INVALID_AUTH_DESTINATION','服务器返回了不受信任的授权地址');
  pending.flow=start.flow;pending.expiresAt=Math.min(pending.expiresAt,this.now()+start.expires_in*1000);
  this.clearTimeout(pending.timer);pending.timer=this.setTimeout(()=>pending.finish(failure('AUTH_EXPIRED','登录请求已过期，请重新开始')),Math.max(1,pending.expiresAt-this.now()));
  pending.channel=new this.Channel(CHANNEL+pending.flow);
  pending.channel.onmessage=event=>{
   const message=event.data;
   if(pending.done||pending.exchanging||!object(message)||message.type!=='easybook-server-login'||
    message.server!==this.profile.origin||message.flow!==pending.flow||message.state!==pending.state||
    event.origin&&event.origin!==this.clientOrigin)return;
   if(message.error){if(message.error==='access_denied')pending.finish(failure('AUTH_DENIED','登录授权已取消'));return}
   if(!HEX.test(message.code))return;
   pending.exchanging=true;this.track(this.exchange(pending,message.code)).catch(error=>pending.finish(error));
  };
  this.pendingCheck(pending);pending.popup.location.replace(destination.href);
 }
 async exchange(pending,code){
  const generation=pending.generation;await this.check(generation);this.pendingCheck(pending);
  const value=await this.request('/account/web/token',{method:'POST',body:{flow:pending.flow,code,state:pending.state,verifier:pending.verifier,redirect_uri:this.redirectUri}},generation);
  this.pendingCheck(pending);
  if(!HEX.test(value.token)||typeof value.session_id!=='string'||!value.session_id||value.session_id.length>128||
   !Number.isSafeInteger(value.expires_in)||value.expires_in<1||value.expires_in>604800)
   throw failure('INVALID_AUTH_RESPONSE','服务器会话信息不正确');
  const credential={token:value.token,sessionId:value.session_id,expiresAt:this.now()+value.expires_in*1000,operationId:pending.state};
  await this.writeSecret(SESSION,credential,generation,pending.state,()=>this.pendingCheck(pending));
  this.pendingCheck(pending);const status={signedIn:true,name:'',account:null,sessionId:credential.sessionId,expiresAt:credential.expiresAt};
  pending.finish(null,status);this.notify(status);
 }
 cancel(){
  this.generation++;this.loggingOut=false;for(const controller of this.controllers)controller.abort();this.controllers.clear();
  this.pending?.finish(failure('AUTH_CANCELLED','登录操作已取消'));
  // Switching profiles must await an in-flight vault write and its CAS cleanup.
  this.cancellation=Promise.allSettled([this.cancellation,...this.tasks]).then(()=>{});return this.cancellation;
 }
 async authorizationHeaders(){
  if(this.loggingOut)return {};
  const generation=this.generation,credential=await this.credential(generation);await this.check(generation);
  return credential?{Authorization:'Easybook-Web '+credential.token}:{};
 }
 async session(){
  if(this.loggingOut)return {signedIn:false,name:'',account:null};
  const generation=this.generation;
  await this.retryLogout();await this.check(generation);
  const credential=await this.credential(generation);if(!credential)return {signedIn:false,name:'',account:null};
  let value;try{value=await this.request('/account/web/session',{token:credential.token},generation)}
  catch(error){if(error.status!==401)throw error;await this.check(generation);await this.store.vaultDelete(SESSION,{operationId:credential.operationId});await this.check(generation);return {signedIn:false,name:'',account:null}}
  const account=object(value.account)?value.account:null,signedIn=value.signedIn===true||!!account?.id;
  if(!signedIn){await this.check(generation);await this.store.vaultDelete(SESSION,{operationId:credential.operationId});await this.check(generation)}
  return {...value,signedIn,name:typeof value.name==='string'?value.name:typeof account?.name==='string'?account.name:'',account};
 }
 retryLogout(){const generation=this.generation;return this.withRevocations(()=>this.performRetryLogout(generation))}
 async performRetryLogout(generation){
  const stored=await this.readSecret(REVOKED,generation);if(!stored)return {pending:false};
  if(!Array.isArray(stored)||stored.some(item=>!object(item)||!HEX.test(item.token)||!Number.isSafeInteger(item.expiresAt)))
   throw failure('CREDENTIAL_UNAVAILABLE','待撤销会话格式不正确');
  const remaining=[];
  for(const item of stored){
   if(item.expiresAt<=this.now())continue;
   try{await this.request('/account/web/logout',{method:'POST',body:{},token:item.token},generation)}
   catch(error){await this.check(generation);if(error.status!==401)remaining.push(item)}
  }
  if(remaining.length)await this.writeSecret(REVOKED,remaining,generation);
  else{await this.check(generation);await this.store.vaultDelete(REVOKED);await this.check(generation)}
  return {pending:!!remaining.length};
 }
 async logout(){
  const cleanup=this.cancel(),generation=this.generation;this.loggingOut=true;
  try{
   await cleanup;await this.check(generation);
   return await this.withRevocations(async()=>{
    await this.check(generation);const credential=await this.credential(generation);
    if(credential){
     const queue=await this.readSecret(REVOKED,generation)||[];
     if(!Array.isArray(queue))throw failure('CREDENTIAL_UNAVAILABLE','待撤销会话格式不正确');
     if(!queue.some(item=>item.token===credential.token))queue.push(credential);
     await this.writeSecret(REVOKED,queue,generation);
     await this.check(generation);await this.store.vaultDelete(SESSION,{operationId:credential.operationId});await this.check(generation);
    }
    const result=await this.performRetryLogout(generation),status={signedIn:false,name:'',account:null,revocationPending:result.pending};this.notify(status);return status;
   });
  }finally{if(generation===this.generation)this.loggingOut=false}
 }
}
