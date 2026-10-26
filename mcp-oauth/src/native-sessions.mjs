import {sessionAllowed,reserveRevocations,finishRevocations} from '../../worker/security-checkpoint.mjs';
import {Buffer} from 'node:buffer';
import {hash,boundedJSON,object} from '../../worker/mcp-common.mjs';
import {IDENTITY_ORIGIN,LEGACY_IDENTITY_ORIGIN,NATIVE_REDIRECT,identityEnabled} from '../../worker/identity-origin.mjs';
import {session,sessionToken,csrf,random,readCookie,cookie,json,page,redirect,rateLimit,requireForm,createSession} from './accounts.mjs';
import {escape} from './appearance.mjs';
const HEX=/^[a-f0-9]{64}$/;
const RECOVERY_COOKIE='__Host-easybook-recovery';
export const s256=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('base64url');
const live="s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL)";
export async function nativeSession(request,env){
 if(!identityEnabled(env))return null;
 const token=request.headers.get('Authorization')?.match(/^Easybook-Session ([a-f0-9]{64})$/)?.[1];
 if(!token)return null;
 const current=await sessionToken(token,env);if(!current)return null;
 return await env.DB.prepare('SELECT session_id FROM account_native_sessions WHERE session_id=?').bind(current.id).first()?current:null;
}
export async function nativeBody(request,max=8192){
 if(request.headers.has('Origin')||request.headers.get('X-Easybook-Native')!=='1')throw json({error:'native_request_required'},403);
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw json({error:'json_required'},415);
 let value;try{value=await boundedJSON(request,max)}catch{throw json({error:'invalid_request'},400)}
 if(!object(value))throw json({error:'invalid_request'},400);return value;
}
async function newHandoff(env,kind,challenge,state){
 const id=random();await env.DB.prepare('INSERT INTO account_login_handoffs(id,kind,challenge,state_hash,expires_at) VALUES(?,?,?,?,?)').bind(id,kind,challenge,await hash(state),Date.now()+300000).run();return id;
}
async function consume(env,input,kind){
 if(!HEX.test(input.flow||'')||!HEX.test(input.code||'')||!HEX.test(input.state||'')||typeof input.verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier))return null;
 const challenge=await s256(input.verifier),now=Date.now();
 return env.DB.prepare(`DELETE FROM account_login_handoffs WHERE id=? AND kind=? AND code_hash=? AND challenge=? AND state_hash=? AND expires_at>? AND approved_at IS NOT NULL AND EXISTS(SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=account_login_handoffs.approved_session_id AND s.account_id=account_login_handoffs.account_id AND ${live}) RETURNING account_id,approved_session_id`).bind(input.flow,kind,await hash(input.code),challenge,await hash(input.state),now,now).first();
}
async function establish(request,env,proof,native){
 const factor=await env.DB.prepare('SELECT credential_id FROM account_session_passkeys WHERE session_id=?').bind(proof.approved_session_id).first();
 const source=await env.DB.prepare('SELECT * FROM account_sessions WHERE id=?').bind(proof.approved_session_id).first();
 if(!source||!await sessionAllowed(env,source))throw json({error:'source_session_unavailable'},403);
 const established=await createSession(request,env,proof.account_id,factor?.credential_id||null,source.authenticated_at);
 if(native)await env.DB.prepare('INSERT INTO account_native_sessions(session_id,created_at) VALUES(?,?)').bind(established.id,Date.now()).run();
 return established;
}
export async function nativeAccountRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!['/account/native/start','/account/native/poll','/account/native/token','/account/native/session','/account/native/logout','/account/native/sessions','/account/native/sessions/revoke','/account/handoff','/account/recover','/account/recover/complete'].includes(path))return null;
 if(!identityEnabled(env))return json({error:'not_available'},404);
 const canonical=url.origin===IDENTITY_ORIGIN,legacy=url.origin===LEGACY_IDENTITY_ORIGIN;
 if(!canonical&&!(legacy&&path==='/account/handoff'))return json({error:'identity_origin_required'},403);
 if(path==='/account/native/start'&&request.method==='POST'){
  await rateLimit(request,env,'native-login',10);const input=await nativeBody(request);
  if(typeof input.challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.challenge)||!HEX.test(input.state||''))return json({error:'invalid_pkce_or_state'},400);
  // No caller-supplied redirect URI or client type is accepted.
  const flow=await newHandoff(env,'native',input.challenge,input.state);
  const handoff='/account/handoff?'+new URLSearchParams({flow,state:input.state});
  if(input.provider!==undefined&&input.provider!=='github')return json({error:'invalid_provider'},400);
  return json({flow,authorization_url:IDENTITY_ORIGIN+(input.provider==='github'?'/account/login?'+new URLSearchParams({return:handoff}):handoff),expires_in:300});
 }
 if(path==='/account/native/poll'&&request.method==='POST'){
  await rateLimit(request,env,'native-poll',30);const input=await nativeBody(request);
  if(!HEX.test(input.flow||'')||!HEX.test(input.state||'')||typeof input.verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier))return json({error:'invalid_request'},400);
  // Status only: a poll never substitutes for the one-use code delivered to
  // the initiating app. This avoids turning a forwarded approval URL into
  // a cross-device session pickup capability.
  const pending=await env.DB.prepare("SELECT approved_at FROM account_login_handoffs WHERE id=? AND kind='native' AND challenge=? AND state_hash=? AND expires_at>?").bind(input.flow,await s256(input.verifier),await hash(input.state),Date.now()).first();
  return pending?json({status:pending.approved_at?'approved':'pending'}):json({error:'handoff_expired'},410);
 }
 if(path==='/account/native/token'&&request.method==='POST'){
  await rateLimit(request,env,'native-token',30);const input=await nativeBody(request),proof=await consume(env,input,'native');
  if(!proof)return json({error:'invalid_grant'},400);
  const established=await establish(request,env,proof,true);
  return json({token:established.token,session_id:established.id,expires_in:604800});
 }
 if(path==='/account/native/session'&&request.method==='GET'){
  const s=await nativeSession(request,env);if(!s)return json({error:'unauthorized'},401);
  return json({account:{id:s.account_id,name:s.display_name},session:{id:s.id,expires_at:s.expires_at,authenticated_at:s.authenticated_at}});
 }
 if(path==='/account/native/sessions'&&request.method==='GET'){
  const s=await nativeSession(request,env);if(!s)return json({error:'unauthorized'},401);
  const {results}=await env.DB.prepare('SELECT id,device,created_at,expires_at FROM account_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 50').bind(s.account_id,Date.now()).all();
  return json({account:{id:s.account_id,name:s.display_name},recently_authenticated:Date.now()-s.authenticated_at<=300000,devices:results.map(d=>({...d,current:d.id===s.id}))});
 }
 if(path==='/account/native/sessions/revoke'&&request.method==='POST'){
  const input=await nativeBody(request),s=await nativeSession(request,env);if(!s)return json({error:'unauthorized'},401);
  if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id))return json({error:'invalid_session'},400);
  if(input.id!==s.id&&Date.now()-s.authenticated_at>300000)return json({error:'reauthentication_required'},403);
  await rateLimit(request,env,'native-device-revoke',20);
  if(!await env.DB.prepare('SELECT 1 FROM account_sessions WHERE id=? AND account_id=?').bind(input.id,s.account_id).first())return json({error:'session_not_found'},404);
  const revocation=await reserveRevocations(env,[['session',input.id]]);
  const changed=await env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL RETURNING id').bind(Date.now(),input.id,s.account_id).first();
  await finishRevocations(env,revocation,changed?'committed':'cancelled');if(!changed)return json({error:'session_not_found'},404);
  return json({revoked:true,current:input.id===s.id,independent_key_access_unchanged:true});
 }
 if(path==='/account/native/logout'&&request.method==='POST'){
  await nativeBody(request);const s=await nativeSession(request,env);if(!s)return json({error:'unauthorized'},401);
  const revocation=await reserveRevocations(env,[['session',s.id]]);await env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=? AND account_id=?').bind(Date.now(),s.id,s.account_id).run();await finishRevocations(env,revocation,'committed');return json({ok:true});
 }
 if(path==='/account/recover'&&request.method==='GET'){
  await rateLimit(request,env,'identity-recovery',10);
  const verifier=random(),state=random(),flow=await newHandoff(env,'browser',await s256(verifier),state);
  return redirect(LEGACY_IDENTITY_ORIGIN+'/account/handoff?'+new URLSearchParams({flow,state}),[cookie(RECOVERY_COOKIE,flow+'.'+verifier+'.'+state,300)]);
 }
 if(path==='/account/recover/complete'&&request.method==='GET'){
  const [flow,verifier,state]=readCookie(request,RECOVERY_COOKIE).split('.');
  if(flow!==url.searchParams.get('flow')||state!==url.searchParams.get('state'))return json({error:'recovery_browser_changed'},403);
  const proof=await consume(env,{flow,verifier,state,code:url.searchParams.get('code')},'browser');
  if(!proof)return json({error:'recovery_expired'},400);
  const established=await establish(request,env,proof,false);
  return redirect('/account/passkeys',[established.cookie,cookie(RECOVERY_COOKIE,'',0)]);
 }
 if(path==='/account/handoff'&&['GET','POST'].includes(request.method)){
  let input;if(request.method==='GET')input=url.searchParams;
  const s=await session(request,env);
  if(!s)return redirect('/account/passkeys?return='+encodeURIComponent(url.pathname+url.search));
  if(request.method==='POST')input=await requireForm(request,s);
  const id=input.get('flow'),state=input.get('state');
  if(!HEX.test(id||'')||!HEX.test(state||''))return json({error:'invalid_handoff'},400);
  const pending=await env.DB.prepare('SELECT kind,expires_at FROM account_login_handoffs WHERE id=? AND state_hash=? AND expires_at>? AND approved_at IS NULL').bind(id,await hash(state),Date.now()).first();
  if(!pending)return json({error:'handoff_expired'},400);
  if(Date.now()-s.authenticated_at>300000)return page('重新验证身份',`<p>登录交接前需要重新验证。</p><a href="/account/passkeys?return=${encodeURIComponent('/account/handoff?'+new URLSearchParams({flow:id,state}))}">重新验证</a>`);
  if(request.method==='GET')return page(pending.kind==='native'?'登录 Easybook Android':'恢复新域名登录',`<p>以 <strong>${escape(s.display_name)}</strong> 继续。此操作建立一个新的账户会话；不会复制或转移工作区同步密钥。</p><form method="post" action="/account/handoff"><input type="hidden" name="csrf" value="${await csrf(request,s)}"><input type="hidden" name="flow" value="${id}"><input type="hidden" name="state" value="${state}"><button name="decision" value="allow">确认继续</button><button name="decision" value="deny">取消</button></form>${canonical?`<p>只有旧域名的通行密钥？<a class="link" href="${LEGACY_IDENTITY_ORIGIN+'/account/handoff?'+new URLSearchParams({flow:id,state})}">在旧域名验证后继续</a></p>`:''}`);
  if(input.get('decision')!=='allow'){await env.DB.prepare('DELETE FROM account_login_handoffs WHERE id=? AND state_hash=? AND approved_at IS NULL').bind(id,await hash(state)).run();return redirect(pending.kind==='native'?NATIVE_REDIRECT+'?'+new URLSearchParams({flow:id,state,error:'access_denied'}):'/account')}
  const code=random(),now=Date.now();
  const approved=await env.DB.prepare(`UPDATE account_login_handoffs SET account_id=?,approved_session_id=?,code_hash=?,approved_at=?,expires_at=? WHERE id=? AND state_hash=? AND expires_at>? AND approved_at IS NULL AND EXISTS(SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND ${live}) RETURNING kind`).bind(s.account_id,s.id,await hash(code),now,now+180000,id,await hash(state),now,s.id,s.account_id,now).first();
  if(!approved)return json({error:'handoff_changed'},409);
  const destination=new URL(approved.kind==='native'?NATIVE_REDIRECT:IDENTITY_ORIGIN+'/account/recover/complete');destination.search=new URLSearchParams({flow:id,code,state}).toString();
  if(approved.kind==='native'){
   const intent='intent://account/callback?'+destination.searchParams.toString()+'#Intent;scheme=easybook;package=com.feoearth.easybook.notes;end';
   return page('登录已确认',`<p>浏览器身份验证已完成。请点击下方按钮返回 Easybook，完成本机登录。</p><div class="group"><a id="native-return" class="link" href="${escape(intent)}">返回 Easybook</a><a id="native-scheme-return" class="link" href="${escape(destination.href)}">使用系统链接返回</a></div><p>如果浏览器阻止打开应用，请允许此页面打开 Easybook，或选择系统链接。无需复制任何授权码。</p>`);
  }
  return redirect(destination.href);
 }
 return json({error:'method_not_allowed'},405);
}

