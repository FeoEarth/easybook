// One execution contract for account-authenticated Web and native AI.
import {AI_CHAT_MAX_BODY_BYTES} from '../shared/ai-context-policy.mjs';
import {boundedJSON,object} from './mcp-common.mjs';
import {aiAPI} from './ai.mjs';
import {workspacePrincipal,accountPrincipal} from './request-principal.mjs';
import {nativeSession} from '../mcp-oauth/src/native-sessions.mjs';
import {WorkspaceError} from './workspace-identity.mjs';
import {publicOrigin} from './server-config.mjs';
const json=(data,status)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const AI_READINESS_PATH='/api/ai/internal-readiness';
export const aiPath=path=>path.startsWith('/api/ai/')&&path!==AI_READINESS_PATH;
export async function webAI(request,env,{execute=aiAPI,authenticate=workspacePrincipal}={}){
 try{const principal=await authenticate(request,env,{mutation:!['GET','HEAD'].includes(request.method)});return await execute(request,env,principal,{workspaceId:request.headers.get('X-Easybook-Workspace')||''});}
 catch(e){return e instanceof WorkspaceError?json({error:e.code},e.status):json({error:'Authentication unavailable'},503)}
}
export async function nativeAI(request,env){
 const current=await nativeSession(request,env);if(!current)return json({error:'unauthorized'},401);
   let input;try{input=await boundedJSON(request,AI_CHAT_MAX_BODY_BYTES)}catch(error){if(error?.code==='PAYLOAD_TOO_LARGE')return Response.json({error:'payload_too_large'},{status:413});return Response.json({error:'invalid_request'},{status:400})}if(!object(input))return Response.json({error:'invalid_request'},{status:400});
   const principal=accountPrincipal(current);let target,method='GET',body;
   if(input.action==='config')target='/api/ai/config';
   else if(input.action==='credential'&&['PUT','DELETE'].includes(input.method)){target='/api/ai/config';method=input.method;body=JSON.stringify(input)}
   else if(input.action==='mcp'&&['GET','PUT','DELETE'].includes(input.method)){target='/api/ai/mcp';method=input.method;if(method!=='GET')body=JSON.stringify(input.config)}
   else if(input.action==='preferences'&&['GET','PUT'].includes(input.method)){target='/api/ai/preferences';method=input.method;if(method==='PUT')body=JSON.stringify(input.preferences)}
   else if(input.action==='models'){target='/api/ai/models?credentialId='+encodeURIComponent(input.credentialId||'')+(input.refresh?'&refresh=1':'')}
   else if(input.action==='select'){target='/api/ai/select';method='POST';body=JSON.stringify({credentialId:input.credentialId})}
   else if(input.action==='search'){target='/api/ai/search';method='POST';body=JSON.stringify({messages:input.messages,stream:input.stream===true})}
   else if(input.action==='chat'){target='/api/ai/chat';method='POST';body=JSON.stringify({messages:input.messages,mode:input.mode,attachments:input.attachments,stream:input.stream===true,externalTools:input.externalTools===true,localSandbox:input.localSandbox===true,localSandboxBackend:input.localSandboxBackend==='linux'?'linux':'javascript',credentialId:input.credentialId,model:input.model,...(input.localBrowser===true?{localBrowser:true,browserPreset:input.browserPreset,browserHistory:input.browserHistory}:{}),...((['title','memory','browser_answer'].includes(input.purpose)||typeof input.purpose==='string'&&/^agent_run:[a-f0-9-]{36}$/.test(input.purpose))?{purpose:input.purpose}:{})})}
    else if(input.action==='execute'){target='/api/ai/execute';method='POST';body=JSON.stringify({approvalId:input.approvalId})}
   else return Response.json({error:'invalid_request'},{status:400});
   const headers={'Content-Type':'application/json'};return aiAPI(new Request(new URL(target,request.url),{method,headers,body,signal:request.signal}),env,principal,{workspaceId:input.workspace||'',identityWorker:true});
}
// The caller proves it has the same credential vault secret before forwarding.
// The receiver never returns a secret or a keyed digest; only a boolean status.
// A failed readiness check precedes execution, so fallback cannot double-submit.
const enc=new TextEncoder(),hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g),x=>parseInt(x,16));
async function readinessKey(env){const raw=env.AI_CREDENTIAL_KEY;if(typeof raw!=='string'||raw.length<32)return null;return crypto.subtle.importKey('raw',enc.encode(raw),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
const message=challenge=>enc.encode('easybook-ai-execution-v1:'+challenge);
export async function aiReadiness(request,env){
 if(request.method!=='POST'||new URL(request.url).origin!==publicOrigin(env))return new Response('Not found',{status:404});
 const challenge=request.headers.get('X-Easybook-AI-Challenge')||'',proof=request.headers.get('X-Easybook-AI-Proof')||'';
 if(!/^[a-f0-9]{64}$/.test(challenge)||!/^[a-f0-9]{64}$/.test(proof))return new Response('Not found',{status:404});
 const key=await readinessKey(env);
 if(!key||!await crypto.subtle.verify('HMAC',key,unhex(proof),message(challenge)))return new Response('Not found',{status:404});
 return new Response(null,{status:204,headers:{'Cache-Control':'no-store','X-Easybook-AI-Execution':'v1'}});
}
const readyCache=new WeakMap();
export async function aiServiceReady(env,{fresh=false}={}){
 if(!env.IDENTITY_SERVICE||env.AI_EXECUTION_LOCAL==='true')return false;
 const cached=readyCache.get(env);if(!fresh&&cached&&cached.until>Date.now())return cached.ready;
 let ready=false;try{const key=await readinessKey(env);if(key){const challenge=hex(crypto.getRandomValues(new Uint8Array(32))),proof=hex(await crypto.subtle.sign('HMAC',key,message(challenge)));const response=await env.IDENTITY_SERVICE.fetch(new Request(publicOrigin(env)+AI_READINESS_PATH,{method:'POST',headers:{'X-Easybook-AI-Challenge':challenge,'X-Easybook-AI-Proof':proof}}));ready=response.status===204&&response.headers.get('X-Easybook-AI-Execution')==='v1';}}catch{}
 readyCache.set(env,{ready,until:Date.now()+(ready?30000:5000)});return ready;
}
export async function dispatchWebAI(request,env,{local=webAI,ready=aiServiceReady}={}){
 if(new URL(request.url).origin===publicOrigin(env)&&await ready(env)){// Never retry a forwarded mutation or stream.
  return env.IDENTITY_SERVICE.fetch(request);
 }
 return local(request,env);
}
