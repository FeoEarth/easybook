import {publicOrigin,isWebClientOriginAllowed,webLoginRedirect,webCorsHeaders,validateServerConfig} from '../../worker/server-config.mjs';
import {identityEnabled} from '../../worker/identity-origin.mjs';
import {requireRestoreAccess,sessionAllowed,reserveRevocations,finishRevocations} from '../../worker/security-checkpoint.mjs';
import {hash,boundedJSON,object} from '../../worker/mcp-common.mjs';
import {session,sessionToken,csrf,random,page,redirect,requireForm,rateLimit} from './accounts.mjs';
import {s256} from './native-sessions.mjs';
import {escape} from './appearance.mjs';

const HEX=/^[a-f0-9]{64}$/,CHALLENGE=/^[A-Za-z0-9_-]{43}$/,VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const paths=new Set(['/account/web/start','/account/web/authorize','/account/web/token','/account/web/session','/account/web/logout']);
const live="s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL)";
const response=(request,env,value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...webCorsHeaders(request,env)}});
function clientOrigin(request,env){
 const explicit=request.headers.get('Origin');
 // Same-origin GETs may omit Origin. Fetch Metadata may only stand in for the
 // server's own origin; a cross-origin Web token always requires its Origin.
 const value=explicit||(request.headers.get('Sec-Fetch-Site')==='same-origin'?publicOrigin(env):null);
 return isWebClientOriginAllowed(env,value)?value:null;
}
function accountOrigin(request,env){const own=publicOrigin(env);return own.startsWith('https:')&&new URL(request.url).origin===own;}
async function body(request,env,allowed){
 const client=clientOrigin(request,env);
 if(!client)throw response(request,env,{error:'web_origin_not_allowed'},403);
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw response(request,env,{error:'json_required'},415);
 let value;try{value=await boundedJSON(request,8192)}catch{throw response(request,env,{error:'invalid_request'},400)}
 if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw response(request,env,{error:'invalid_request'},400);
 return {input:value,client};
}
export async function webSession(request,env){
 if(!request.headers.get('Authorization')?.startsWith('Easybook-Web '))return null;
 if(!identityEnabled(env)||!accountOrigin(request,env))return null;
 const client=clientOrigin(request,env),token=request.headers.get('Authorization').match(/^Easybook-Web ([a-f0-9]{64})$/)?.[1];
 if(!client||!token)return null;
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_web_sessions'").first())return null;
 const current=await sessionToken(token,env);if(!current)return null;
 const marker=await env.DB.prepare('SELECT client_origin,server_origin FROM account_web_sessions WHERE session_id=?').bind(current.id).first();
 return marker?.client_origin===client&&marker.server_origin===publicOrigin(env)?{...current,client_origin:marker.client_origin,server_origin:marker.server_origin}:null;
}
function destination(entry,flow,state,code,error){
 const url=new URL(entry.redirect_uri);
 url.search=new URLSearchParams({server:entry.server_origin,flow,...(code?{code}:{}),state,...(error?{error}:{})}).toString();
 return url.href;
}
async function authorize(request,env){
 const url=new URL(request.url);
 if(!['GET','POST'].includes(request.method))return response(request,env,{error:'method_not_allowed'},405);
 const browser=await session(request,env);
 if(!browser)return redirect('/account/passkeys?return='+encodeURIComponent(url.pathname+url.search));
 const input=request.method==='POST'?await requireForm(request,browser):url.searchParams;
 const flow=input.get('flow'),state=input.get('state');
 if(!HEX.test(flow||'')||!HEX.test(state||''))return response(request,env,{error:'invalid_handoff'},400);
 const entry=await env.DB.prepare('SELECT * FROM account_web_logins WHERE id=? AND state_hash=? AND server_origin=? AND expires_at>? AND approved_at IS NULL').bind(flow,await hash(state),publicOrigin(env),Date.now()).first();
 if(!entry||!webLoginRedirect(env,entry.redirect_uri,entry.client_origin))return response(request,env,{error:'handoff_expired'},400);
 const returnPath='/account/web/authorize?'+new URLSearchParams({flow,state});
 if(Date.now()-browser.authenticated_at>300000)return page('重新验证身份',`<p>登录交接前需要重新验证。</p><a href="/account/passkeys?return=${encodeURIComponent(returnPath)}">重新验证</a>`);
 if(request.method==='GET')return page('连接 Easybook 网页',`<p>以 <strong>${escape(browser.display_name)}</strong> 登录 <strong>${escape(entry.client_origin)}</strong> 的 Easybook 网页。</p><p>账户和数据来自 ${escape(entry.server_origin)}。此操作不会复制或转移其他服务器的账户与工作区密钥。</p><form method="post" action="/account/web/authorize"><input type="hidden" name="csrf" value="${await csrf(request,browser)}"><input type="hidden" name="flow" value="${flow}"><input type="hidden" name="state" value="${state}"><button name="decision" value="allow">确认连接</button><button name="decision" value="deny">取消</button></form>`);
 if(!['allow','deny'].includes(input.get('decision')))return response(request,env,{error:'invalid_decision'},400);
 if(input.get('decision')==='deny'){
  const removed=await env.DB.prepare('DELETE FROM account_web_logins WHERE id=? AND state_hash=? AND approved_at IS NULL RETURNING id').bind(flow,await hash(state)).first();
  return removed?redirect(destination(entry,flow,state,null,'access_denied')):response(request,env,{error:'handoff_changed'},409);
 }
 const code=random(),now=Date.now();
 const approved=await env.DB.prepare(`UPDATE account_web_logins SET account_id=?,approved_session_id=?,code_hash=?,approved_at=? WHERE id=? AND state_hash=? AND server_origin=? AND expires_at>? AND approved_at IS NULL AND EXISTS(SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND ${live}) RETURNING id`).bind(browser.account_id,browser.id,await hash(code),now,flow,await hash(state),publicOrigin(env),now,browser.id,browser.account_id,now).first();
 return approved?redirect(destination(entry,flow,state,code)):response(request,env,{error:'handoff_changed'},409);
}
async function token(request,env){
 const {input,client}=await body(request,env,['flow','code','state','verifier','redirect_uri']);
 if(!HEX.test(input.flow||'')||!HEX.test(input.code||'')||!HEX.test(input.state||'')||typeof input.verifier!=='string'||!VERIFIER.test(input.verifier)||!webLoginRedirect(env,input.redirect_uri,client))return response(request,env,{error:'invalid_grant'},400);
 const challenge=await s256(input.verifier),stateHash=await hash(input.state),codeHash=await hash(input.code),own=publicOrigin(env),now=Date.now();
 const entry=await env.DB.prepare(`SELECT l.*,s.id source_id,s.created_at source_created_at FROM account_web_logins l JOIN account_sessions s ON s.id=l.approved_session_id JOIN accounts a ON a.id=s.account_id WHERE l.id=? AND l.challenge=? AND l.state_hash=? AND l.code_hash=? AND l.client_origin=? AND l.redirect_uri=? AND l.server_origin=? AND l.expires_at>? AND l.approved_at IS NOT NULL AND s.account_id=l.account_id AND ${live}`).bind(input.flow,challenge,stateHash,codeHash,client,input.redirect_uri,own,now,now).first();
 if(!entry||!await sessionAllowed(env,{id:entry.source_id,account_id:entry.account_id,created_at:entry.source_created_at}))return response(request,env,{error:'invalid_grant'},400);
 const id=crypto.randomUUID(),secret=random(),secretHash=await hash(secret);
 // Consume the authorization code, create the account session and bind its
 // origin in one D1 transaction. A competing exchange cannot mint a second token.
 const created=env.DB.prepare(`INSERT INTO account_sessions(id,token_hash,account_id,created_at,expires_at,authenticated_at,device) SELECT ?,?,l.account_id,?,?,s.authenticated_at,? FROM account_web_logins l JOIN account_sessions s ON s.id=l.approved_session_id JOIN accounts a ON a.id=s.account_id WHERE l.id=? AND l.challenge=? AND l.state_hash=? AND l.code_hash=? AND l.client_origin=? AND l.redirect_uri=? AND l.server_origin=? AND l.expires_at>? AND l.approved_at IS NOT NULL AND s.account_id=l.account_id AND ${live}`).bind(id,secretHash,now,now+604800000,(request.headers.get('User-Agent')||'Web connector').slice(0,180),input.flow,challenge,stateHash,codeHash,client,input.redirect_uri,own,now,now);
 const marker=env.DB.prepare('INSERT INTO account_web_sessions(session_id,client_origin,server_origin,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM account_sessions WHERE id=? AND token_hash=?)').bind(id,client,own,now,id,secretHash);
 const factor=env.DB.prepare('INSERT INTO account_session_passkeys(session_id,credential_id) SELECT ?,credential_id FROM account_session_passkeys WHERE session_id=? AND EXISTS(SELECT 1 FROM account_web_sessions WHERE session_id=?)').bind(id,entry.source_id,id);
 const consume=env.DB.prepare('DELETE FROM account_web_logins WHERE id=? AND EXISTS(SELECT 1 FROM account_web_sessions WHERE session_id=?)').bind(input.flow,id);
 const read=env.DB.prepare('SELECT session_id FROM account_web_sessions WHERE session_id=?').bind(id);
 const result=await env.DB.batch([created,marker,factor,consume,read]);
 if(!result[4].results?.length)return response(request,env,{error:'invalid_grant'},400);
 return response(request,env,{token:secret,session_id:id,expires_in:604800});
}
export async function webAccountRoutes(request,env){
 const path=new URL(request.url).pathname;if(!paths.has(path))return null;
 try{
  validateServerConfig(env);
  if(!publicOrigin(env).startsWith('https:')||new URL(request.url).protocol!=='https:')return response(request,env,{error:'account_https_required'},403);
  if(!identityEnabled(env))return response(request,env,{error:'not_available'},404);
  if(!accountOrigin(request,env))return response(request,env,{error:'identity_origin_required'},403);
  await requireRestoreAccess(env);
  if(request.method==='OPTIONS')return new Response(null,{status:isWebClientOriginAllowed(env,request.headers.get('Origin'))?204:403,headers:webCorsHeaders(request,env)});
  if(path==='/account/web/authorize')return await authorize(request,env);
  if(path==='/account/web/start'&&request.method==='POST'){
   const {input,client}=await body(request,env,['challenge','state','redirect_uri']);
   const redirectUri=webLoginRedirect(env,input.redirect_uri||client+'/server-callback',client);
   if(!CHALLENGE.test(input.challenge||'')||!HEX.test(input.state||'')||!redirectUri)return response(request,env,{error:'invalid_pkce_or_redirect'},400);
   await rateLimit(request,env,'web-login-start',10);
   const flow=random(),now=Date.now();
   await env.DB.prepare('DELETE FROM account_web_logins WHERE id IN(SELECT id FROM account_web_logins WHERE expires_at<? LIMIT 100)').bind(now).run();
   await env.DB.prepare('INSERT INTO account_web_logins(id,challenge,state_hash,client_origin,redirect_uri,server_origin,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(flow,input.challenge,await hash(input.state),client,redirectUri,publicOrigin(env),now,now+300000).run();
   return response(request,env,{flow,authorization_url:publicOrigin(env)+'/account/web/authorize?'+new URLSearchParams({flow,state:input.state}),expires_in:300});
  }
  if(path==='/account/web/token'&&request.method==='POST'){await rateLimit(request,env,'web-login-token',30);return await token(request,env);}
  if(path==='/account/web/session'&&request.method==='GET'){
   const current=await webSession(request,env);
   return current?response(request,env,{signedIn:true,name:current.display_name,account:{id:current.account_id,name:current.display_name},session:{id:current.id,expires_at:current.expires_at,authenticated_at:current.authenticated_at},recently_authenticated:Date.now()-current.authenticated_at<=300000}):response(request,env,{signedIn:false,error:'unauthorized'},401);
  }
  if(path==='/account/web/logout'&&request.method==='POST'){
   await body(request,env,[]);const current=await webSession(request,env);if(!current)return response(request,env,{error:'unauthorized'},401);
   const revocation=await reserveRevocations(env,[['session',current.id]]);
   await env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(Date.now(),current.id).run();
   await finishRevocations(env,revocation,'committed');return response(request,env,{ok:true});
  }
  return response(request,env,{error:'method_not_allowed'},405);
 }catch(error){if(error instanceof Response){const headers=new Headers(error.headers);for(const [key,value]of Object.entries(webCorsHeaders(request,env)))headers.set(key,value);return new Response(error.body,{status:error.status,headers})}throw error}
}
