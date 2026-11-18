import {boundedJSON,object,hash} from './mcp-common.mjs';
import {beginMcpOAuth,handleMcpOAuth,mcpAccessToken,mcpOAuthStatus} from './ai-mcp-oauth.mjs';

export const mcpError=(code,status=502)=>Object.assign(Error(code),{code,status});
const serverLimit=20;
const versions=new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']);
const latest='2025-06-18';
const serverId=/^[a-f0-9-]{36}$/;
const aliases=/^mcp_([a-f0-9]{32})_[a-f0-9]{20}$/;

function endpoint(value){
 let url;
 try{if(typeof value!=='string'||value.length>1024)throw Error();url=new URL(value)}catch{throw mcpError('mcp_invalid_url',400)}
 const host=url.hostname;
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/.test(host)||
    /\.(localhost|local|lan|home|internal|test|invalid|onion|arpa|example)$/.test(host))throw mcpError('mcp_invalid_url',400);
 return url;
}

function publicAddress(value){
 if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)){
  const [a,b,c,...rest]=value.split('.').map(Number);
  return Math.max(a,b,c,...rest)<=255&&a>0&&a<224&&a!==10&&a!==127&&
   !(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&
   !(a===192&&(b===168||b===0||b===88||b===2))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
 }
 return /^[23][0-9a-f]{3}:[0-9a-f:]+$/i.test(value)&&!/^200[12]:/i.test(value)&&!/^3fff:/i.test(value);
}

async function checkHost(url,fetcher,signal){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const query=new URL('https://cloudflare-dns.com/dns-query');
  query.searchParams.set('name',url.hostname);query.searchParams.set('type',type);
  // Workers supports manual redirects. The status check rejects all 3xx responses.
  const res=await fetcher(query,{headers:{Accept:'application/dns-json'},redirect:'manual',signal});
  if(!res.ok)throw mcpError('mcp_unreachable');
  const data=await boundedJSON(res,22000);
  if(data.Status!==0)throw mcpError('mcp_unreachable');
  return (data.Answer||[]).filter(row=>row.type===1||row.type===28).map(row=>row.data);
 }));
 const ips=answers.flat();
 if(!ips.length)throw mcpError('mcp_unreachable');
 if(ips.some(ip=>!publicAddress(ip)))throw mcpError('mcp_invalid_url',400);
}

const rpcResponseLimit=180000;
const catalogResponseLimit=4*1024*1024;
const toolSchemaLimit=64000;
const catalogSchemaBudget=240000;
const schemaEncoder=new TextEncoder();
const schemaBytes=schema=>schemaEncoder.encode(JSON.stringify(schema)).byteLength;

async function rpcResult(response,id,limit=rpcResponseLimit){
 if(!response.ok){
  void response.body?.cancel().catch(()=>{});
  throw Object.assign(mcpError(response.status===401||response.status===403?'mcp_auth_failed':'mcp_request_failed'),{upstreamStatus:response.status});
 }
 const type=response.headers.get('Content-Type')||'';
 if(type.includes('application/json')){
  const value=await boundedJSON(response,limit);
  if(value?.jsonrpc==='2.0'&&value.id===id){if(value.error)throw Object.assign(mcpError('mcp_request_failed'),{rpcCode:Number.isSafeInteger(value.error.code)?value.error.code:undefined});return value.result}
 }
 if(type.includes('text/event-stream')){
  const reader=response.body?.getReader(),decoder=new TextDecoder();
  let buffer='',size=0;
  try{
   while(reader){
    const chunk=await reader.read();
    if(chunk.done)break;
    size+=chunk.value.byteLength;
    if(size>limit)throw mcpError('mcp_response_too_large');
    buffer+=decoder.decode(chunk.value,{stream:true});
    for(let match;(match=/\r?\n\r?\n/.exec(buffer));){
     const event=buffer.slice(0,match.index);
     buffer=buffer.slice(match.index+match[0].length);
     const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
     if(!data)continue;
     const value=JSON.parse(data);
     if(value?.jsonrpc==='2.0'&&value.id===id){if(value.error)throw Object.assign(mcpError('mcp_request_failed'),{rpcCode:Number.isSafeInteger(value.error.code)?value.error.code:undefined});return value.result}
    }
   }
  }finally{void reader?.cancel().catch(()=>{})}
 }
 throw mcpError('mcp_protocol_error');
}

async function withServer(urlValue,token,fetcher,requestSignal,work){
 const url=endpoint(urlValue);
 const timeout=AbortSignal.timeout(12000);
 const signal=requestSignal?AbortSignal.any([requestSignal,timeout]):timeout;
 const headers=new Headers({'Content-Type':'application/json',Accept:'application/json, text/event-stream'});
 if(token)headers.set('Authorization','Bearer '+token);
 let id=0,session,phase='resolve';
 async function send(method,params,notice=false){
  phase=method;
  const requestId=notice?undefined:++id;
  const response=await fetcher(url,{method:'POST',headers,redirect:'manual',signal,body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})});
  if(notice){if(!response.ok)await rpcResult(response);void response.body?.cancel().catch(()=>{});return}
  if(method==='initialize')session=response.headers.get('Mcp-Session-Id');
  return rpcResult(response,requestId,method==='tools/list'?catalogResponseLimit:rpcResponseLimit);
 }
 try{
  await checkHost(url,fetcher,signal);
  const init=await send('initialize',{protocolVersion:latest,capabilities:{},clientInfo:{name:'Easybook',version:'1.0'}});
  if(!versions.has(init?.protocolVersion)||!init.capabilities?.tools)throw mcpError('mcp_protocol_error');
  if(session)headers.set('Mcp-Session-Id',session);
  headers.set('MCP-Protocol-Version',init.protocolVersion);
  await send('notifications/initialized',undefined,true);
  return await work(send);
 }catch(error){
  const failure=error?.status?error:mcpError(error?.code==='PAYLOAD_TOO_LARGE'?'mcp_response_too_large':'mcp_unreachable');
  throw Object.assign(failure,{phase});
 }
 finally{if(headers.has('Mcp-Session-Id'))try{
  const response=await fetcher(url,{method:'DELETE',headers,redirect:'manual',signal:AbortSignal.timeout(1200)});
  void response.body?.cancel().catch(()=>{});
 }catch{}}
}

async function catalog(url,token,fetcher,signal,id){
 return withServer(url,token,fetcher,signal,async send=>{
  const tools=[];
  let cursor,budget=catalogSchemaBudget;
  for(let page=0;page<4;page++){
   const result=await send('tools/list',cursor?{cursor}:{});
   if(!Array.isArray(result?.tools))throw mcpError('mcp_protocol_error');
   for(const item of result.tools){
    if(typeof item?.name!=='string'||!item.name||item.name.length>160||!object(item.inputSchema)||item.inputSchema.type!=='object')continue;
    const bytes=schemaBytes(item.inputSchema);
    if(bytes>toolSchemaLimit||bytes>budget)continue;
    if(token&&JSON.stringify(item).includes(token))continue;
    const alias='mcp_'+id.replaceAll('-','')+'_'+(await hash(item.name)).slice(0,20);
    if(tools.some(t=>t.alias===alias))continue;
    budget-=bytes;
    tools.push({alias,name:item.name,description:typeof item.description==='string'?item.description.slice(0,500):'',inputSchema:item.inputSchema});
    if(tools.length===12)return tools;
   }
   if(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor.length>1000||cursor===result.nextCursor)break;
   cursor=result.nextCursor;
  }
  return tools;
 });
}

const setup=new WeakMap();
function schema(db){
 let pending=setup.get(db);
 if(!pending){
  pending=Promise.resolve(db.prepare(`CREATE TABLE IF NOT EXISTS account_ai_mcp_servers(
   id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
   label TEXT NOT NULL,url TEXT NOT NULL,key_ciphertext TEXT,key_iv TEXT,revision TEXT NOT NULL,
   tools_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1
  )`).run()).catch(error=>{setup.delete(db);throw error});
  setup.set(db,pending);
 }
 return pending;
}
const view=row=>({id:row.id,label:row.label,url:row.url,enabled:!!row.enabled,authenticated:!!row.key_ciphertext,tools:JSON.parse(row.tools_json).map(t=>t.name)});

const oauthContext=options=>({...options,safeUrl:endpoint,checkHost,
 save:async(env,account,config,token,secret,signal)=>{
  await schema(env.DB);
  const id=config.reconnectId||crypto.randomUUID(),revision=crypto.randomUUID();
  const wrapped=await options.seal(env,account,id,secret);
  if(config.reconnectId){
   const found=await env.DB.prepare("UPDATE account_ai_mcp_servers SET key_ciphertext=?,key_iv=?,tools_json='[]',revision=? WHERE id=? AND account_id=? AND url=? AND revision=? RETURNING id")
    .bind(wrapped.ciphertext,wrapped.iv,revision,id,account,config.url,config.reconnectRevision).first();
   if(!found)throw mcpError('mcp_changed',409);
  }else await insertServer(env,account,id,config.label,config.url,[],wrapped,revision);
  // The authorization code is single use. Keep the grant even if discovery must be retried.
  try{
   const tools=await catalog(config.url,token,options.fetcher,signal,id);
   if(!tools.length)throw mcpError('mcp_no_tools',400);
   const found=await env.DB.prepare('UPDATE account_ai_mcp_servers SET tools_json=? WHERE id=? AND account_id=? AND revision=? RETURNING id')
    .bind(JSON.stringify(tools),id,account,revision).first();
   if(!found)throw mcpError('mcp_changed',409);
   return {status:'connected'};
  }catch(error){return {status:'tools_pending',error}}
 }
});

async function insertServer(env,account,id,label,url,tools,wrapped,revision=crypto.randomUUID()){
 const created=await env.DB.prepare(`INSERT INTO account_ai_mcp_servers(id,account_id,label,url,key_ciphertext,key_iv,revision,tools_json)
  SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM account_ai_mcp_servers WHERE account_id=?)<? RETURNING id`)
  .bind(id,account,label,url,wrapped.ciphertext,wrapped.iv,revision,JSON.stringify(tools),account,serverLimit).first();
 if(!created)throw mcpError('mcp_server_limit',409);
}

export const mcpOAuthPage=(request,env,options)=>handleMcpOAuth(request,env,oauthContext(options));

export async function configureMcp(request,env,principal,options){
 await schema(env.DB);
 const {fetcher,seal,open}=options;
 const account=principal.accountId;
 if(request.method==='GET'){
  const rows=(await env.DB.prepare('SELECT * FROM account_ai_mcp_servers WHERE account_id=? ORDER BY label,id').bind(account).all()).results;
  return {servers:rows.map(view)};
 }
 const input=await boundedJSON(request,4096);
 if(!object(input)||input.id!==undefined&&!serverId.test(input.id))throw mcpError('mcp_invalid_config',400);
 const existing=input.id&&await env.DB.prepare('SELECT * FROM account_ai_mcp_servers WHERE id=? AND account_id=?').bind(input.id,account).first();
 if(input.id&&!existing)throw mcpError('mcp_not_found',404);
 if(request.method==='DELETE'&&existing){
  await env.DB.prepare('DELETE FROM account_ai_mcp_servers WHERE id=? AND account_id=?').bind(existing.id,account).run();
  return {ok:true};
 }
 if(request.method!=='PUT')throw mcpError('mcp_invalid_config',400);
 if(input.oauthState){
  const statusUrl=new URL(request.url);
  statusUrl.searchParams.set('state',input.oauthState);
  return mcpOAuthStatus(env,new Request(statusUrl),account);
 }
 if(input.oauth===true){
  if(existing&&existing.url!==input.url)throw mcpError('mcp_invalid_config',400);
  if(!existing&&(await env.DB.prepare('SELECT COUNT(*) AS n FROM account_ai_mcp_servers WHERE account_id=?').bind(account).first()).n>=serverLimit)throw mcpError('mcp_server_limit',409);
  return beginMcpOAuth(env,request,account,{...input,reconnectRevision:existing?.revision},oauthContext(options));
 }
 const revision=crypto.randomUUID();
 if(existing&&typeof input.enabled==='boolean'){
  await env.DB.prepare('UPDATE account_ai_mcp_servers SET enabled=?,revision=? WHERE id=? AND account_id=?').bind(input.enabled?1:0,revision,existing.id,account).run();
  return {ok:true};
 }
 if(existing&&input.refresh===true){
  const token=await mcpAccessToken(env,existing,oauthContext(options));
  const tools=await catalog(existing.url,token,fetcher,request.signal,existing.id);
  if(!tools.length)throw mcpError('mcp_no_tools',400);
  const change=await env.DB.prepare('UPDATE account_ai_mcp_servers SET tools_json=?,revision=? WHERE id=? AND account_id=? AND revision=? RETURNING id').bind(JSON.stringify(tools),revision,existing.id,account,existing.revision).first();
  if(!change)throw mcpError('mcp_changed',409);
  return {ok:true};
 }
 if(existing||typeof input.label!=='string'||!input.label.trim()||input.label.trim().length>60||typeof (input.token??'')!=='string'||(input.token||'').length>1500||(/[^a-zA-Z0-9._~+/=-]/.test(input.token||'')))throw mcpError('mcp_invalid_config',400);
 const url=endpoint(input.url).href,id=crypto.randomUUID();
 if(input.token&&url.includes(input.token))throw mcpError('mcp_invalid_url',400);
 const {n}=await env.DB.prepare('SELECT COUNT(*) AS n FROM account_ai_mcp_servers WHERE account_id=?').bind(account).first();
 if(n>=serverLimit)throw mcpError('mcp_server_limit',409);
 const wrapped=input.token?await seal(env,account,id,input.token):{ciphertext:null,iv:null};
 const tools=await catalog(url,input.token||'',fetcher,request.signal,id);
 if(!tools.length)throw mcpError('mcp_no_tools',400);
 await insertServer(env,account,id,input.label.trim(),url,tools,wrapped);
 return {ok:true};
}

export async function externalMcpTools(env,account){
 await schema(env.DB);
 const rows=(await env.DB.prepare('SELECT id,label,url,revision,tools_json FROM account_ai_mcp_servers WHERE account_id=? AND enabled=1 ORDER BY label,id').bind(account).all()).results;
 const catalogs=rows.map(row=>JSON.parse(row.tools_json).map(tool=>({...tool,server:row.label,url:row.url,revision:row.revision})));
 const available=new Map();
 let budget=catalogSchemaBudget;
 for(let index=0;index<12&&available.size<24;index++){
  for(const tools of catalogs){
   const tool=tools[index];
   if(tool){
    const bytes=schemaBytes(tool.inputSchema);
    if(bytes>budget)continue;
    budget-=bytes;available.set(tool.alias,tool);
   }
   if(available.size===24)break;
  }
 }
 return available;
}

export async function approvedMcpTool(env,account,name,revision){
 const key=aliases.exec(name)?.[1];
 if(!key||!serverId.test(revision||''))return null;
 const id=key.replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
 await schema(env.DB);
 const server=await env.DB.prepare('SELECT * FROM account_ai_mcp_servers WHERE id=? AND account_id=? AND enabled=1 AND revision=?').bind(id,account,revision).first();
 const tool=server&&JSON.parse(server.tools_json).find(t=>t.alias===name);
 return tool?{server,tool}:null;
}

export async function runApprovedMcp(env,entry,args,{open,seal,fetcher,signal}){
 const {server,tool}=entry;
 const token=await mcpAccessToken(env,server,oauthContext({open,seal,fetcher}));
 return withServer(server.url,token,fetcher,signal,async send=>{
  const result=await send('tools/call',{name:tool.name,arguments:args});
  if(!object(result))throw mcpError('mcp_protocol_error');
  const text=(Array.isArray(result.content)?result.content:[]).filter(item=>item?.type==='text'&&typeof item.text==='string').map(item=>item.text).join('\n')||(object(result.structuredContent)?JSON.stringify(result.structuredContent):'');
  const safe=(token?text.replaceAll(token,'[redacted]'):text).slice(0,16000);
  return result.isError?{error:{code:'mcp_tool_failed',message:safe||'MCP 工具返回错误'}}:{text:safe||'（工具未返回文本）'};
 });
}
