import {boundedJSON,object,READ,WRITE} from './mcp-common.mjs';
import {registry} from './mcp-registry.mjs';
import {callTool} from './mcp-services.mjs';
import {workspaceAccess} from './workspace-identity.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder();
const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const modelPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const allowedRoles=new Set(['manager','editor','reader']);

async function encryptionKey(env){
 const raw=env.AI_CREDENTIAL_KEY;
 if(typeof raw!=='string')throw Object.assign(Error('AI credential vault unavailable'),{status:503,code:'credential_vault_unavailable'});
 let bytes;
 if(/^[a-f0-9]{64}$/i.test(raw))bytes=Uint8Array.from(raw.match(/../g),value=>parseInt(value,16));
 else{try{bytes=unb64(raw)}catch{}if(bytes?.length!==32&&encoder.encode(raw).length===32)bytes=encoder.encode(raw)}
 if(bytes?.length!==32&&raw.length>=32&&raw.length<=1024)bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));
 if(bytes?.length!==32)throw Object.assign(Error('AI credential vault unavailable'),{status:503,code:'credential_vault_unavailable'});
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
const aad=accountId=>encoder.encode('easybook-ai-credential-v1:'+accountId);
async function seal(env,accountId,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(accountId)},await encryptionKey(env),encoder.encode(secret));
 return {ciphertext:b64(new Uint8Array(encrypted)),iv:b64(iv)};
}
async function open(env,row){
 try{return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.key_iv),additionalData:aad(row.account_id)},await encryptionKey(env),unb64(row.key_ciphertext)))}
 catch{throw Object.assign(Error('AI credential cannot be decrypted'),{status:503,code:'credential_unavailable'})}
}
async function credential(env,accountId){return env.DB.prepare('SELECT account_id,provider,model,key_ciphertext,key_iv,updated_at FROM account_ai_credentials WHERE account_id=?').bind(accountId).first()}
function validateKey(value){return typeof value==='string'&&value.length>=20&&value.length<=500&&!/[\s\u0000-\u001f]/.test(value)}
function toolsFor(role){
 const scopes=role==='reader'?READ:[...READ,...WRITE];
 return registry.filter(t=>!t.risk&&scopes.includes(t.scope)&&!['access_request_permissions','operations_request_confirmation'].includes(t.name)).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
}
function safeMessages(input){
 if(!Array.isArray(input)||input.length<1||input.length>40)throw Object.assign(Error('Invalid messages'),{status:400,code:'invalid_messages'});
 let size=0;return input.map(message=>{if(!object(message)||!['user','assistant'].includes(message.role)||typeof message.content!=='string')throw Object.assign(Error('Invalid messages'),{status:400,code:'invalid_messages'});size+=message.content.length;if(size>60000)throw Object.assign(Error('Messages too large'),{status:413,code:'messages_too_large'});return {role:message.role,content:message.content}});
}
async function completion(key,model,messages,tools,fetcher=fetch){
 const upstream=await fetcher('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,messages,tools,tool_choice:'auto',max_completion_tokens:2000}),signal:AbortSignal.timeout(45000)});
 let data;try{data=await upstream.json()}catch{data=null}
 if(!upstream.ok)throw Object.assign(Error(data?.error?.message||'AI provider request failed'),{status:upstream.status===401?401:502,code:upstream.status===401?'provider_key_rejected':'provider_error'});
 const message=data?.choices?.[0]?.message;if(!message||typeof message!=='object')throw Object.assign(Error('Invalid AI provider response'),{status:502,code:'provider_error'});return message;
}
export async function aiAPI(request,env,principal,{workspaceId,fetcher=fetch}={}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/ai/'))return null;
 try{
  if(principal?.kind!=='account')return response({error:'account_required'},403);
  if(path==='/api/ai/config'){
   if(request.method==='GET'){
    const row=await credential(env,principal.accountId);return response({configured:!!row,...(row?{provider:row.provider,model:row.model,updatedAt:row.updated_at}:{})});
   }
   if(request.method==='DELETE'){
    if(Date.now()-principal.authenticatedAt>300000)return response({error:'reauthentication_required'},403);
    await env.DB.prepare('DELETE FROM account_ai_credentials WHERE account_id=?').bind(principal.accountId).run();return response({configured:false});
   }
   if(request.method!=='PUT')return response({error:'method_not_allowed'},405);
   if(Date.now()-principal.authenticatedAt>300000)return response({error:'reauthentication_required'},403);
   const input=await boundedJSON(request,4096);if(!object(input)||input.provider!=='openai'||!modelPattern.test(input.model||'')||!validateKey(input.apiKey))return response({error:'invalid_credential'},400);
   const wrapped=await seal(env,principal.accountId,input.apiKey),now=Date.now();
   await env.DB.prepare('INSERT INTO account_ai_credentials(account_id,provider,model,key_ciphertext,key_iv,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,key_ciphertext=excluded.key_ciphertext,key_iv=excluded.key_iv,updated_at=excluded.updated_at').bind(principal.accountId,'openai',input.model,wrapped.ciphertext,wrapped.iv,now,now).run();
   return response({configured:true,provider:'openai',model:input.model,updatedAt:now});
  }
  if(path!=='/api/ai/chat'||request.method!=='POST')return response({error:'not_found'},404);
  if(!/^[a-f0-9]{64}$/.test(workspaceId||''))return response({error:'workspace_required'},400);
  const access=await workspaceAccess(env,workspaceId,principal);if(!access||!allowedRoles.has(access.role))return response({error:'workspace_access_denied'},403);
  const row=await credential(env,principal.accountId);if(!row)return response({error:'ai_not_configured'},409);
  const input=await boundedJSON(request,65536),messages=safeMessages(input?.messages),tools=toolsFor(access.role),key=await open(env,row);
  const conversation=[{role:'system',content:'你是 Easybook 内置 AI 助手。优先使用提供的工具读取或整理当前工作区；不得猜测工具结果。执行写入前需明确遵循用户当前请求。高风险删除与永久操作不可用。'},...messages];
  const used=[];
  for(let turn=0;turn<6;turn++){
   const message=await completion(key,row.model,conversation,tools,fetcher),calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
   conversation.push(message);
   if(!calls.length)return response({message:{role:'assistant',content:typeof message.content==='string'?message.content:''},tools:used,model:row.model});
   for(const call of calls.slice(0,6)){
    const name=call?.function?.name;let args,result;
    try{args=JSON.parse(call?.function?.arguments||'{}');result=await callTool({env,workspace:workspaceId,client:'easybook-agent:'+principal.accountId,scopes:access.role==='reader'?READ:[...READ,...WRITE]},name,args)}
    catch(error){result={error:{code:error.code||'TOOL_ERROR',message:error.code?error.message:'Tool failed'}}}
    used.push({name,ok:!result?.error});conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,180000)});
   }
  }
  return response({error:'agent_turn_limit'},422);
 }catch(error){if(error?.code==='PAYLOAD_TOO_LARGE')return response({error:'payload_too_large'},413);console.error(JSON.stringify({event:'ai_request_failed',name:error?.name,code:error?.code}));return response({error:error?.code||'ai_unavailable'},error?.status||503)}
}

