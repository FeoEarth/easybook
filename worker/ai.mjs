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
async function ensureCredentialSchema(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_ai_credentials(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,provider TEXT NOT NULL CHECK(provider='openai'),provider_name TEXT NOT NULL DEFAULT 'OpenAI',base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 120),key_ciphertext TEXT NOT NULL,key_iv TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)").run();
 const columns=new Set((await env.DB.prepare('PRAGMA table_info(account_ai_credentials)').all()).results.map(column=>column.name));
 const add=async sql=>{try{await env.DB.prepare(sql).run()}catch(error){if(!String(error?.message).toLowerCase().includes('duplicate column'))throw error}};
 if(!columns.has('provider_name'))await add("ALTER TABLE account_ai_credentials ADD COLUMN provider_name TEXT NOT NULL DEFAULT 'OpenAI'");
 if(!columns.has('base_url'))await add("ALTER TABLE account_ai_credentials ADD COLUMN base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1'");
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_ai_profiles(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,label TEXT NOT NULL,provider TEXT NOT NULL,protocol TEXT NOT NULL CHECK(protocol IN ('openai','anthropic')),provider_name TEXT NOT NULL,base_url TEXT NOT NULL,model TEXT NOT NULL,key_ciphertext TEXT NOT NULL,key_iv TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)").run();
 await env.DB.prepare('CREATE INDEX IF NOT EXISTS account_ai_profiles_account ON account_ai_profiles(account_id,active DESC,updated_at DESC)').run();
 await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS account_ai_profiles_one_active ON account_ai_profiles(account_id) WHERE active=1').run();
}

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
const aad=(accountId,id='')=>encoder.encode(id?'easybook-ai-credential-v2:'+accountId+':'+id:'easybook-ai-credential-v1:'+accountId);
async function seal(env,accountId,id,secret){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(accountId,id)},await encryptionKey(env),encoder.encode(secret));
 return {ciphertext:b64(new Uint8Array(encrypted)),iv:b64(iv)};
}
async function open(env,row){
 try{return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.key_iv),additionalData:aad(row.account_id,row.id||'')},await encryptionKey(env),unb64(row.key_ciphertext)))}
 catch{throw Object.assign(Error('AI credential cannot be decrypted'),{status:503,code:'credential_unavailable'})}
}
async function profiles(env,accountId){
 let rows=(await env.DB.prepare('SELECT id,account_id,label,provider,protocol,provider_name,base_url,model,key_ciphertext,key_iv,active,created_at,updated_at FROM account_ai_profiles WHERE account_id=? ORDER BY active DESC,updated_at DESC').bind(accountId).all()).results;
 if(rows.length)return rows;
 const legacy=await env.DB.prepare('SELECT account_id,provider,provider_name,base_url,model,key_ciphertext,key_iv,created_at,updated_at FROM account_ai_credentials WHERE account_id=?').bind(accountId).first();
 if(!legacy)return [];
 const secret=await open(env,legacy),id=crypto.randomUUID(),wrapped=await seal(env,accountId,id,secret),provider=legacy.base_url==='https://api.openai.com/v1'?'openai':'custom';
 await env.DB.prepare('INSERT INTO account_ai_profiles(id,account_id,label,provider,protocol,provider_name,base_url,model,key_ciphertext,key_iv,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,accountId,legacy.provider_name,provider,'openai',legacy.provider_name,legacy.base_url,legacy.model,wrapped.ciphertext,wrapped.iv,1,legacy.created_at,legacy.updated_at).run();
 await env.DB.prepare('DELETE FROM account_ai_credentials WHERE account_id=?').bind(accountId).run();
 rows=(await env.DB.prepare('SELECT id,account_id,label,provider,protocol,provider_name,base_url,model,key_ciphertext,key_iv,active,created_at,updated_at FROM account_ai_profiles WHERE account_id=?').bind(accountId).all()).results;return rows;
}
async function credential(env,accountId,id=''){const rows=await profiles(env,accountId);return id?rows.find(row=>row.id===id):rows.find(row=>row.active)||rows[0]}
function validateKey(value){return typeof value==='string'&&value.length>=20&&value.length<=500&&!/[\s\u0000-\u001f]/.test(value)}
const presets={
 openai:{providerName:'OpenAI',baseUrl:'https://api.openai.com/v1',protocol:'openai'},
 anthropic:{providerName:'Anthropic',baseUrl:'https://api.anthropic.com/v1',protocol:'anthropic'},
 gemini:{providerName:'Google AI Studio (Gemini)',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',protocol:'openai'},
 deepseek:{providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',protocol:'openai'},
 kimi:{providerName:'Kimi (Moonshot AI)',baseUrl:'https://api.moonshot.cn/v1',protocol:'openai'}
};
function providerConfig(input){
 if(presets[input.provider])return presets[input.provider];
 if(!['custom','custom-anthropic'].includes(input.provider)||typeof input.providerName!=='string'||!input.providerName.trim()||input.providerName.trim().length>80||typeof input.baseUrl!=='string'||input.baseUrl.length>2048)throw Object.assign(Error('Invalid provider'),{status:400,code:'invalid_provider'});
 let url;try{url=new URL(input.baseUrl)}catch{throw Object.assign(Error('Invalid provider URL'),{status:400,code:'invalid_provider_url'})}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||!host.includes('.')||!/^[a-z0-9.-]+$/.test(host)||host.startsWith('.')||host.endsWith('.')||host.includes('..')||/^\d+(?:\.\d+){3}$/.test(host)||host.includes(':')||['localhost','local','internal','lan','home','test','invalid'].some(name=>host===name||host.endsWith('.'+name)))throw Object.assign(Error('Provider URL must be public HTTPS'),{status:400,code:'invalid_provider_url'});
 let path=url.pathname.replace(/\/+$/,'');if(path.endsWith('/chat/completions'))path=path.slice(0,-17);url.pathname=path||'/';
 return {providerName:input.providerName.trim(),baseUrl:url.href.replace(/\/$/,''),protocol:input.provider==='custom-anthropic'?'anthropic':'openai'};
}
const publicProfile=row=>({id:row.id,label:row.label,provider:row.provider,protocol:row.protocol,providerName:row.provider_name,baseUrl:row.base_url,model:row.model,active:!!row.active,updatedAt:row.updated_at});
function toolScopes(role,mode){return mode==='agent'&&role!=='reader'?[...READ,...WRITE]:READ}
function toolsFor(role,mode){
 const scopes=toolScopes(role,mode);
 return registry.filter(t=>!t.risk&&scopes.includes(t.scope)&&!['access_request_permissions','operations_request_confirmation'].includes(t.name)).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
}
async function ensureAgentApprovalSchema(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS ai_agent_approvals(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,workspace_id TEXT NOT NULL,tool_name TEXT NOT NULL,tool_args TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER)').run();
}
function safeMessages(input,attachments=[]){
 if(!Array.isArray(input)||input.length<1||input.length>40)throw Object.assign(Error('Invalid messages'),{status:400,code:'invalid_messages'});
 let size=0;const result=input.map(message=>{if(!object(message)||!['user','assistant'].includes(message.role)||typeof message.content!=='string')throw Object.assign(Error('Invalid messages'),{status:400,code:'invalid_messages'});size+=message.content.length;if(size>60000)throw Object.assign(Error('Messages too large'),{status:413,code:'messages_too_large'});return {role:message.role,content:message.content}});
 if(!Array.isArray(attachments)||attachments.length>3)throw Object.assign(Error('Invalid AI attachments'),{status:400,code:'invalid_attachments'});
 if(!attachments.length)return result;
 if(result.at(-1).role!=='user')throw Object.assign(Error('Attachments require final user message'),{status:400,code:'invalid_attachments'});
 const parts=[{type:'text',text:result.at(-1).content}];let textSize=0;
 for(const file of attachments){
  if(!object(file)||typeof file.name!=='string'||file.name.length>120||!file.name.trim())throw Object.assign(Error('Invalid attachment name'),{status:400,code:'invalid_attachments'});
  if(file.type==='text'){
   if(typeof file.text!=='string'||file.text.length>30000)throw Object.assign(Error('Invalid text attachment'),{status:400,code:'invalid_attachments'});
   textSize+=file.text.length;if(textSize>45000)throw Object.assign(Error('Text attachments too large'),{status:413,code:'attachments_too_large'});
   parts[0].text+='\n\n[附件 '+file.name+']\n'+file.text+'\n[/附件]';
  }else if(file.type==='image'){
   if(!['image/jpeg','image/png','image/webp'].includes(file.mime)||typeof file.data!=='string'||file.data.length>300000||!/^[A-Za-z0-9+/]+={0,2}$/.test(file.data))throw Object.assign(Error('Invalid image attachment'),{status:400,code:'invalid_attachments'});
   parts.push({type:'image_url',image_url:{url:'data:'+file.mime+';base64,'+file.data}});
  }else throw Object.assign(Error('Unsupported AI attachment'),{status:400,code:'invalid_attachments'});
 }
 result[result.length-1].content=parts.length===1?parts[0].text:parts;return result;
}
async function openAICompletion(key,row,messages,tools,fetcher=fetch){
 const upstream=await fetcher(row.base_url.replace(/\/$/,'')+'/chat/completions',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:row.model,messages,tools,tool_choice:'auto',max_completion_tokens:2000}),signal:AbortSignal.timeout(45000)});
 let data;try{data=await upstream.json()}catch{data=null}
 if(!upstream.ok)throw Object.assign(Error(data?.error?.message||'AI provider request failed'),{status:upstream.status===401?401:502,code:upstream.status===401?'provider_key_rejected':'provider_error'});
 const message=data?.choices?.[0]?.message;if(!message||typeof message!=='object')throw Object.assign(Error('Invalid AI provider response'),{status:502,code:'provider_error'});return message;
}
function anthropicMessages(messages){
 const result=[];for(const message of messages){if(message.role==='system')continue;if(message.role==='tool'){const block={type:'tool_result',tool_use_id:message.tool_call_id,content:message.content};const previous=result.at(-1);if(previous?.role==='user'&&Array.isArray(previous.content))previous.content.push(block);else result.push({role:'user',content:[block]});continue}if(message.role==='assistant'&&Array.isArray(message.tool_calls)){const content=[];if(message.content)content.push({type:'text',text:message.content});for(const call of message.tool_calls)content.push({type:'tool_use',id:call.id,name:call.function.name,input:JSON.parse(call.function.arguments||'{}')});result.push({role:'assistant',content});continue}result.push({role:message.role,content:Array.isArray(message.content)?message.content.map(part=>part.type==='image_url'?{type:'image',source:{type:'base64',media_type:part.image_url.url.slice(5,part.image_url.url.indexOf(';')),data:part.image_url.url.slice(part.image_url.url.indexOf(',')+1)}}:{type:'text',text:part.text}):message.content})}return result;
}
async function anthropicCompletion(key,row,messages,tools,fetcher=fetch){
 const system=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n');
 const upstream=await fetcher(row.base_url.replace(/\/$/,'')+'/messages',{method:'POST',redirect:'manual',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:row.model,system,messages:anthropicMessages(messages),tools:tools.map(tool=>({name:tool.function.name,description:tool.function.description,input_schema:tool.function.parameters})),tool_choice:{type:'auto'},max_tokens:2000}),signal:AbortSignal.timeout(45000)});
 let data;try{data=await upstream.json()}catch{data=null}if(!upstream.ok)throw Object.assign(Error(data?.error?.message||'AI provider request failed'),{status:upstream.status===401?401:502,code:upstream.status===401?'provider_key_rejected':'provider_error'});
 if(!Array.isArray(data?.content))throw Object.assign(Error('Invalid AI provider response'),{status:502,code:'provider_error'});const text=data.content.filter(block=>block.type==='text').map(block=>block.text||'').join('\n'),calls=data.content.filter(block=>block.type==='tool_use').map(block=>({id:block.id,type:'function',function:{name:block.name,arguments:JSON.stringify(block.input||{})}}));return {role:'assistant',content:text,...(calls.length?{tool_calls:calls}:{})};
}
const completion=(key,row,messages,tools,fetcher)=>row.protocol==='anthropic'?anthropicCompletion(key,row,messages,tools,fetcher):openAICompletion(key,row,messages,tools,fetcher);
async function discoverModels(key,row,fetcher=fetch){
 const headers=row.protocol==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key};const upstream=await fetcher(row.base_url.replace(/\/$/,'')+'/models',{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});let data;try{data=await upstream.json()}catch{data=null}if(!upstream.ok)throw Object.assign(Error('Model discovery failed'),{status:upstream.status===401?401:502,code:upstream.status===401?'provider_key_rejected':'model_discovery_failed'});const items=Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[];return [...new Set(items.map(item=>item?.id||item?.name?.replace(/^models\//,'')).filter(model=>typeof model==='string'&&modelPattern.test(model)))].sort().slice(0,500)}
export async function aiAPI(request,env,principal,{workspaceId,fetcher=fetch}={}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/ai/'))return null;
 try{
  if(principal?.kind!=='account')return response({error:'account_required'},403);
  await ensureCredentialSchema(env);
  if(path==='/api/ai/config'){
   if(request.method==='GET'){
    const rows=await profiles(env,principal.accountId),row=rows.find(value=>value.active)||rows[0];return response({configured:!!row,activeId:row?.id||'',profiles:rows.map(publicProfile),...(row?publicProfile(row):{})});
   }
   if(request.method==='DELETE'){
    if(Date.now()-principal.authenticatedAt>300000)return response({error:'reauthentication_required'},403);
    const input=await boundedJSON(request,4096),id=input?.credentialId;if(typeof id!=='string')return response({error:'invalid_credential'},400);const row=await credential(env,principal.accountId,id);if(!row)return response({error:'not_found'},404);
    await env.DB.batch([env.DB.prepare('DELETE FROM account_ai_profiles WHERE account_id=? AND id=?').bind(principal.accountId,id),env.DB.prepare('UPDATE account_ai_profiles SET active=1 WHERE id=(SELECT id FROM account_ai_profiles WHERE account_id=? AND id<>? ORDER BY updated_at DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM account_ai_profiles WHERE account_id=? AND id<>? AND active=1)').bind(principal.accountId,id,principal.accountId,id)]);const rows=await profiles(env,principal.accountId);return response({configured:!!rows.length,activeId:rows.find(value=>value.active)?.id||rows[0]?.id||'',profiles:rows.map(publicProfile)});
   }
   if(request.method!=='PUT')return response({error:'method_not_allowed'},405);
   const input=await boundedJSON(request,4096);if(!object(input)||!modelPattern.test(input.model||''))return response({error:'invalid_credential'},400);const existing=input.credentialId?await credential(env,principal.accountId,input.credentialId):null;if(input.credentialId&&!existing)return response({error:'not_found'},404);if((!existing&&!validateKey(input.apiKey))||(existing&&input.apiKey&&!validateKey(input.apiKey)))return response({error:'invalid_credential'},400);const provider=providerConfig(input),id=existing?.id||crypto.randomUUID(),label=typeof input.label==='string'&&input.label.trim()?input.label.trim().slice(0,80):provider.providerName;
   const changesSecretDestination=!existing||!!input.apiKey||existing.provider!==input.provider||existing.protocol!==provider.protocol||existing.base_url!==provider.baseUrl;if(changesSecretDestination&&Date.now()-principal.authenticatedAt>300000)return response({error:'reauthentication_required'},403);
   const wrapped=input.apiKey?await seal(env,principal.accountId,id,input.apiKey):{ciphertext:existing.key_ciphertext,iv:existing.key_iv},now=Date.now(),makeActive=input.active!==false;
   const statements=[];if(makeActive)statements.push(env.DB.prepare('UPDATE account_ai_profiles SET active=0 WHERE account_id=?').bind(principal.accountId));statements.push(env.DB.prepare('INSERT INTO account_ai_profiles(id,account_id,label,provider,protocol,provider_name,base_url,model,key_ciphertext,key_iv,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,provider=excluded.provider,protocol=excluded.protocol,provider_name=excluded.provider_name,base_url=excluded.base_url,model=excluded.model,key_ciphertext=excluded.key_ciphertext,key_iv=excluded.key_iv,active=excluded.active,updated_at=excluded.updated_at').bind(id,principal.accountId,label,input.provider,provider.protocol,provider.providerName,provider.baseUrl,input.model,wrapped.ciphertext,wrapped.iv,makeActive?1:existing?.active||0,existing?.created_at||now,now));await env.DB.batch(statements);
   const rows=await profiles(env,principal.accountId);return response({configured:true,activeId:(rows.find(value=>value.active)||rows[0]).id,profiles:rows.map(publicProfile),...publicProfile(rows.find(value=>value.id===id))});
  }
  if(path==='/api/ai/select'&&request.method==='POST'){
   const input=await boundedJSON(request,4096),row=await credential(env,principal.accountId,input?.credentialId);if(!row)return response({error:'not_found'},404);await env.DB.batch([env.DB.prepare('UPDATE account_ai_profiles SET active=0 WHERE account_id=?').bind(principal.accountId),env.DB.prepare('UPDATE account_ai_profiles SET active=1,updated_at=? WHERE account_id=? AND id=?').bind(Date.now(),principal.accountId,row.id)]);return response({selected:true,...publicProfile({...row,active:1})});
  }
  if(path==='/api/ai/models'&&request.method==='GET'){
   const row=await credential(env,principal.accountId,url.searchParams.get('credentialId')||'');if(!row)return response({error:'ai_not_configured'},409);return response({models:await discoverModels(await open(env,row),row,fetcher),credentialId:row.id});
  }
  if(!['/api/ai/chat','/api/ai/execute'].includes(path)||request.method!=='POST')return response({error:'not_found'},404);
  if(!/^[a-f0-9]{64}$/.test(workspaceId||''))return response({error:'workspace_required'},400);
  const access=await workspaceAccess(env,workspaceId,principal);if(!access||!allowedRoles.has(access.role))return response({error:'workspace_access_denied'},403);
  if(path==='/api/ai/execute'&&request.method==='POST'){
   if(access.role==='reader')return response({error:'workspace_access_denied'},403);
   const input=await boundedJSON(request,4096),id=input?.approvalId;
   if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return response({error:'invalid_approval'},400);
   await ensureAgentApprovalSchema(env);
   const pending=await env.DB.prepare('SELECT tool_name,tool_args FROM ai_agent_approvals WHERE id=? AND account_id=? AND workspace_id=? AND expires_at>? AND consumed_at IS NULL').bind(id,principal.accountId,workspaceId,Date.now()).first();
   if(!pending)return response({error:'approval_expired'},409);
   const tool=registry.find(t=>t.name===pending.tool_name&&!t.risk&&WRITE.includes(t.scope));
   if(!tool)return response({error:'approval_denied'},403);
   const claimed=await env.DB.prepare('UPDATE ai_agent_approvals SET consumed_at=? WHERE id=? AND account_id=? AND workspace_id=? AND expires_at>? AND consumed_at IS NULL RETURNING id').bind(Date.now(),id,principal.accountId,workspaceId,Date.now()).first();
   if(!claimed)return response({error:'approval_expired'},409);
   let result;try{result=await callTool({env,workspace:workspaceId,client:'easybook-agent:'+principal.accountId,scopes:toolScopes(access.role,'agent')},tool.name,JSON.parse(pending.tool_args))}
   catch(error){result={error:{code:error.code||'TOOL_ERROR',message:error.code?error.message:'Tool failed'}}}
   return response({ok:!result?.error,tool:tool.name,result:result?.error?undefined:result,error:result?.error});
  }
  const row=await credential(env,principal.accountId);if(!row)return response({error:'ai_not_configured'},409);
  const input=await boundedJSON(request,1600000),messages=safeMessages(input?.messages,input?.attachments||[]),mode=input?.mode==='agent'?'agent':'conversation',scopes=toolScopes(access.role,mode),tools=toolsFor(access.role,mode),key=await open(env,row);
  const conversation=[{role:'system',content:'你是 Easybook 内置 AI 助手。笔记内容以 Markdown 提供，面向用户的回复必须使用清晰、有效的 Markdown。不得猜测工具结果。'+(mode==='agent'?'当前为 Agent 模式：可以受控地分步骤使用当前工作区工具。所有写入都会暂停，等待用户在 Easybook 内逐项核对并确认；不得宣称未确认的操作已执行。高风险及永久删除操作不可用。':'当前为对话模式：只能读取工作区；不能创建、修改、移动或删除任何内容。如需写入，请提示用户切换 Agent 模式。')},...messages];
  const used=[];
  for(let turn=0;turn<6;turn++){
   const message=await completion(key,row,conversation,tools,fetcher),calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
   conversation.push(message);
   if(!calls.length)return response({message:{role:'assistant',content:typeof message.content==='string'?message.content:''},tools:used,model:row.model,providerName:row.provider_name});
   const writeCall=calls.slice(0,6).find(call=>registry.some(t=>t.name===call?.function?.name&&!t.risk&&WRITE.includes(t.scope)&&scopes.includes(t.scope)));
   if(writeCall){
    const name=writeCall.function.name;let args;
    try{args=JSON.parse(writeCall.function.arguments||'{}');if(!object(args))throw Error('invalid')}catch{return response({error:'invalid_tool_arguments'},400)}
    const serialized=JSON.stringify(args);if(serialized.length>30000)return response({error:'tool_arguments_too_large'},413);
    await ensureAgentApprovalSchema(env);
    await env.DB.prepare('DELETE FROM ai_agent_approvals WHERE expires_at<?').bind(Date.now()-86400000).run();
    const id=crypto.randomUUID(),expiresAt=Date.now()+300000;
    await env.DB.prepare('INSERT INTO ai_agent_approvals(id,account_id,workspace_id,tool_name,tool_args,expires_at) VALUES(?,?,?,?,?,?)').bind(id,principal.accountId,workspaceId,name,serialized,expiresAt).run();
    return response({message:{role:'assistant',content:'Agent 已准备 '+name+' 操作，正在等待你核对参数并确认。未确认前不会修改工作区。'},tools:used,approval:{id,tool:name,arguments:args,expiresAt}});
   }
   for(const call of calls.slice(0,6)){
    const name=call?.function?.name;let args,result;
    try{args=JSON.parse(call?.function?.arguments||'{}');result=await callTool({env,workspace:workspaceId,client:'easybook-agent:'+principal.accountId,scopes},name,args)}
    catch(error){result={error:{code:error.code||'TOOL_ERROR',message:error.code?error.message:'Tool failed'}}}
    used.push({name,ok:!result?.error});conversation.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result).slice(0,180000)});
   }
  }
  return response({error:'agent_turn_limit'},422);
 }catch(error){if(error?.code==='PAYLOAD_TOO_LARGE')return response({error:'payload_too_large'},413);console.error(JSON.stringify({event:'ai_request_failed',name:error?.name,code:error?.code}));return response({error:error?.code||'ai_unavailable'},error?.status||503)}
}

