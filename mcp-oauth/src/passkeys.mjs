import {Buffer} from 'node:buffer';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {hash,boundedJSON} from '../../worker/mcp-common.mjs';
import {session,csrf,random,readCookie,cookie,json,page,redirect,rateLimit,safeReturn,createSession} from './accounts.mjs';
import {escape} from './appearance.mjs';
import browserClient from './passkey-browser.mjs';

// One stable origin/RP. Preview hosts must never issue credentials for production.
export const PASSKEY_ORIGIN='https://easybook-mcp-oauth.1902521952.workers.dev';
export const PASSKEY_RP_ID=new URL(PASSKEY_ORIGIN).hostname;
export const PASSKEY_COOKIE='__Host-easybook-passkey';
const algorithms=[-7,-257]; // ES256 and RS256; verification is delegated to SimpleWebAuthn.
const fresh=s=>s&&Date.now()-s.authenticated_at<=300000;
const error=(message,status=400)=>json({error:message},status);
function sameOrigin(request){
 if(new URL(request.url).origin!==PASSKEY_ORIGIN||request.headers.get('Origin')!==PASSKEY_ORIGIN||request.headers.get('X-Easybook-Passkey')!=='1')throw new Response('Origin not allowed',{status:403});
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new Response('JSON required',{status:415});
}
async function challengeCookie(env,options,details){
 const secret=random();
 await env.DB.prepare('DELETE FROM account_passkey_challenges WHERE browser_hash IN (SELECT browser_hash FROM account_passkey_challenges WHERE expires_at<? LIMIT 100)').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO account_passkey_challenges(browser_hash,challenge,purpose,account_id,session_id,display_name,return_path,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(await hash(secret),options.challenge,details.purpose,details.accountId||null,details.sessionId||null,details.name||null,safeReturn(details.returnPath),Date.now()+300000).run();
 const response=json({options});response.headers.append('Set-Cookie',cookie(PASSKEY_COOKIE,secret,300));return response;
}
async function consume(request,env,purposes){
 const secret=readCookie(request,PASSKEY_COOKIE);if(!/^[a-f0-9]{64}$/.test(secret))return null;
 // Consume BEFORE expensive verification; invalid responses require a fresh ceremony.
 const row=await env.DB.prepare('DELETE FROM account_passkey_challenges WHERE browser_hash=? AND expires_at>? RETURNING *').bind(await hash(secret),Date.now()).first();
 return row&&purposes.includes(row.purpose)?row:null;
}
async function protectAccountMutation(request,s,input){
 if(!fresh(s))throw json({error:'请先重新登录，再管理通行密钥'},403);
 if(input.csrf!==await csrf(request,s))throw json({error:'页面已过期，请刷新重试'},403);
}
export async function passkeyRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/account/passkeys'))return null;
 if(path==='/account/passkeys/client.js'&&request.method==='GET')return new Response(browserClient,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
 const s=await session(request,env);
 if(path==='/account/passkeys'&&request.method==='GET')return renderPasskeys(request,env,s);
 if(request.method!=='POST')return error('Method not allowed',405);
 sameOrigin(request);await rateLimit(request,env,'passkey',30);
 let input;try{input=await boundedJSON(request,65536)}catch{return error('Invalid or oversized request')}
 if(!input||typeof input!=='object'||Array.isArray(input))return error('Invalid request');
 if(path==='/account/passkeys/register/options'){
  if(s)await protectAccountMutation(request,s,input);
  const name=s?.display_name||(typeof input.name==='string'?input.name.trim():'');
  if(!name||name.length>100)return error('请填写 1—100 字的账户名称');
  const accountId=s?.account_id||crypto.randomUUID();
  const existing=s?(await env.DB.prepare('SELECT id,transports FROM account_passkeys WHERE account_id=? AND revoked_at IS NULL LIMIT 20').bind(accountId).all()).results:[];
  if(existing.length>=20)return error('最多保留 20 个通行密钥',409);
  const options=await generateRegistrationOptions({rpName:'Easybook',rpID:PASSKEY_RP_ID,userID:new TextEncoder().encode(accountId),userName:accountId,userDisplayName:name,attestationType:'none',supportedAlgorithmIDs:algorithms,timeout:120000,authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:existing.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
  return challengeCookie(env,options,{purpose:s?'register':'signup',accountId,sessionId:s?.id,name,returnPath:input.returnPath});
 }
 if(path==='/account/passkeys/register/verify'){
  const pending=await consume(request,env,['register','signup']);if(!pending)return error('请求已过期或已使用，请重新开始');
  if(pending.purpose==='register'){
   if(s?.account_id!==pending.account_id||s?.id!==pending.session_id)return error('账户会话已更改',403);
   await protectAccountMutation(request,s,input);
  }else if(s)return error('登录状态已更改，请重新开始',409);
  let checked;try{checked=await verifyRegistrationResponse({response:input.response,expectedChallenge:pending.challenge,expectedOrigin:PASSKEY_ORIGIN,expectedRPID:PASSKEY_RP_ID,requireUserVerification:true,supportedAlgorithmIDs:algorithms})}catch{return error('通行密钥验证失败')}
  if(!checked.verified)return error('通行密钥验证失败');
  const info=checked.registrationInfo,k=info.credential,label=typeof input.label==='string'?input.label.trim().slice(0,80):'通行密钥';
  // A credential ID is globally unique and never silently relinked to another account.
  const statements=[];
  if(pending.purpose==='signup')statements.push(env.DB.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').bind(pending.account_id,pending.display_name,Date.now()));
  statements.push(env.DB.prepare('INSERT INTO account_passkeys(id,account_id,public_key,counter,transports,device_type,backed_up,label,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(k.id,pending.account_id,Buffer.from(k.publicKey).toString('base64url'),k.counter,JSON.stringify(k.transports||[]),info.credentialDeviceType,Number(info.credentialBackedUp),label||'通行密钥',Date.now()));
  try{await env.DB.batch(statements)}catch{return error('无法保存此通行密钥；请重新开始',409)}
  const established=await createSession(request,env,pending.account_id,k.id);
  return jsonWithSession({ok:true,redirect:pending.return_path},established.cookie);
 }
 if(path==='/account/passkeys/login/options'){
  const options=await generateAuthenticationOptions({rpID:PASSKEY_RP_ID,timeout:120000,userVerification:'required',allowCredentials:[]});
  return challengeCookie(env,options,{purpose:'login',returnPath:input.returnPath});
 }
 if(path==='/account/passkeys/login/verify'){
  const pending=await consume(request,env,['login']);if(!pending)return error('请求已过期或已使用，请重新开始');
  const id=input.response?.id;if(typeof id!=='string'||id.length>2048)return error('通行密钥验证失败');
  const k=await env.DB.prepare('SELECT k.* FROM account_passkeys k JOIN accounts a ON a.id=k.account_id WHERE k.id=? AND k.revoked_at IS NULL AND a.deleted_at IS NULL').bind(id).first();
  if(!k)return error('通行密钥验证失败');
  // Discoverable credentials must identify the same immutable local account handle.
  if(input.response?.response?.userHandle!==Buffer.from(k.account_id).toString('base64url'))return error('通行密钥验证失败');
  let checked;try{checked=await verifyAuthenticationResponse({response:input.response,expectedChallenge:pending.challenge,expectedOrigin:PASSKEY_ORIGIN,expectedRPID:PASSKEY_RP_ID,requireUserVerification:true,credential:{id:k.id,publicKey:new Uint8Array(Buffer.from(k.public_key,'base64url')),counter:k.counter,transports:JSON.parse(k.transports)}})}catch{return error('通行密钥验证失败')}
  if(!checked.verified)return error('通行密钥验证失败');
  const counter=checked.authenticationInfo.newCounter;
  // Atomic counter check prevents parallel stale-counter acceptance; synced passkeys may use 0.
  const updated=await env.DB.prepare('UPDATE account_passkeys SET counter=?,last_used_at=?,backed_up=? WHERE id=? AND counter=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM accounts WHERE id=account_passkeys.account_id AND deleted_at IS NULL) RETURNING id').bind(counter,Date.now(),Number(checked.authenticationInfo.credentialBackedUp),k.id,k.counter).first();
  if(!updated)return error('凭据状态已更改，请重新验证',409);
  const established=await createSession(request,env,k.account_id,k.id);
  return jsonWithSession({ok:true,redirect:pending.return_path},established.cookie);
 }
 if(path==='/account/passkeys/revoke'){
  await protectAccountMutation(request,s,input);
  if(typeof input.id!=='string'||input.id.length>2048)return error('Invalid credential');
  const now=Date.now();
  const result=await env.DB.batch([
   env.DB.prepare("UPDATE account_passkeys SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL AND (EXISTS(SELECT 1 FROM account_identities WHERE account_id=? AND provider='github') OR EXISTS(SELECT 1 FROM account_passkeys p WHERE p.account_id=? AND p.id<>? AND p.revoked_at IS NULL)) RETURNING id").bind(now,input.id,s.account_id,s.account_id,s.account_id,input.id),
   env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE account_id=? AND id IN (SELECT session_id FROM account_session_passkeys WHERE credential_id=?) AND EXISTS(SELECT 1 FROM account_passkeys WHERE id=? AND revoked_at IS NOT NULL)').bind(now,s.account_id,input.id,input.id)
  ]);
  if(!result[0].results.length)return error('不能移除唯一登录方式；请先添加另一把通行密钥',409);
  return json({ok:true,redirect:'/account/passkeys'});
 }
 return error('Not found',404);
}
function jsonWithSession(data,sessionCookie){const response=json(data);response.headers.append('Set-Cookie',sessionCookie);response.headers.append('Set-Cookie',cookie(PASSKEY_COOKIE,'',0));return response;}

async function renderPasskeys(request,env,s){
 const keys=s?(await env.DB.prepare('SELECT id,label,created_at,last_used_at,backed_up FROM account_passkeys WHERE account_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 20').bind(s.account_id).all()).results:[];
 const github=s?await env.DB.prepare("SELECT subject FROM account_identities WHERE account_id=? AND provider='github' LIMIT 1").bind(s.account_id).first():null;
 const nonce=random(),c=s?await csrf(request,s):'',returnPath=safeReturn(new URL(request.url).searchParams.get('return'));
 const content=`<p>使用设备锁屏、指纹或面容验证。私钥保存在你的设备或密码管理器中；Easybook 仅保存公钥。无需 GitHub 即可使用通行密钥登录。</p><p id="passkey-status" role="status" aria-live="polite"></p>${s?`<div class="group">${keys.map(k=>`<div class="row"><strong>${escape(k.label)}</strong><small>${k.backed_up?'已由密码管理器备份':'请确认你的密码管理器已安全保存'} · ${escape(new Date(k.created_at).toISOString().slice(0,10))}</small><button type="button" class="danger" data-revoke="${escape(k.id)}">移除通行密钥…</button></div>`).join('')||'<p>尚未添加通行密钥</p>'}</div>${fresh(s)?'<label>通行密钥名称<input id="passkey-label" maxlength="80" value="我的通行密钥" autocomplete="off"></label><button type="button" id="passkey-register">添加通行密钥</button>':'<p>添加或移除通行密钥前，请重新登录。</p><button type="button" id="passkey-login">使用通行密钥重新验证</button><p><a class="link" href="/account/login">使用 GitHub 重新验证</a></p>'}`:`<div class="group"><button type="button" id="passkey-login">使用通行密钥登录</button></div><h2>首次使用</h2><form id="passkey-signup"><label>账户名称<input id="passkey-name" maxlength="100" required autocomplete="nickname" placeholder="你的名称"></label><button type="submit" id="passkey-register">创建账户与通行密钥</button><small>名称不作为身份凭证。请保管好通行密钥；没有其他登录方式时，丢失密钥将无法恢复账户。</small></form><p><a class="link" href="/account/login?return=${encodeURIComponent(returnPath)}">继续使用 GitHub</a></p>`}<div id="passkey-confirm" class="group" hidden><p>移除此通行密钥会使通过它登录的设备会话退出。请确认已保存其他登录方式。</p><button type="button" class="danger" id="passkey-confirm-remove">确认移除</button><button type="button" id="passkey-cancel-remove">取消</button></div>${s?github?'<p>已关联 GitHub 备用登录方式。</p>':`<h2>备用登录方式</h2><form method="post" action="/account/identities/github"><input type="hidden" name="csrf" value="${c}"><p>可以关联你自己的 GitHub 身份，在通行密钥丢失时继续登录。已属于其他账户的 GitHub 身份不能直接关联。</p><button>关联 GitHub 备用身份</button></form>`:''}<p>账户登录与工作区同步凭据独立。创建或登录账户不会自动关联旧工作区。</p>`;
 const script=`const status=document.getElementById('passkey-status'),csrf=${JSON.stringify(c)},returnPath=${JSON.stringify(returnPath).replace(/</g,'\\u003c')};let busy=false,pending=null;const buttons=()=>document.querySelectorAll('button');function feedback(text){status.textContent=text}async function api(path,body){const r=await fetch('/account/passkeys/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Easybook-Passkey':'1'},body:JSON.stringify({...body,csrf,returnPath})});const d=await r.json();if(!r.ok)throw Error(d.error||'验证未完成');return d}async function run(action){if(busy)return;busy=true;buttons().forEach(b=>b.disabled=true);feedback('请完成设备验证…');try{await action()}catch(e){feedback(e.name==='NotAllowedError'||e.name==='AbortError'?'验证已取消或未完成，请重试。':e.message||'当前设备无法使用通行密钥')}finally{busy=false;buttons().forEach(b=>b.disabled=false)}}const signup=document.getElementById('passkey-signup');async function register(){if(signup&&!signup.reportValidity())return;await run(async()=>{const data=await api('register/options',{name:document.getElementById('passkey-name')?.value});const response=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:data.options});const result=await api('register/verify',{response,label:document.getElementById('passkey-label')?.value});location.assign(result.redirect)})}if(signup)signup.onsubmit=e=>{e.preventDefault();void register()};else document.getElementById('passkey-register')?.addEventListener('click',register);document.getElementById('passkey-login')?.addEventListener('click',()=>run(async()=>{const data=await api('login/options',{});const response=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:data.options});const result=await api('login/verify',{response});location.assign(result.redirect)}));document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>{pending=b.dataset.revoke;document.getElementById('passkey-confirm').hidden=false});document.getElementById('passkey-cancel-remove').onclick=()=>{pending=null;document.getElementById('passkey-confirm').hidden=true};document.getElementById('passkey-confirm-remove').onclick=()=>run(async()=>{if(!pending)return;const result=await api('revoke',{id:pending});location.assign(result.redirect)});if(!window.PublicKeyCredential||!navigator.credentials){feedback('当前浏览器不支持通行密钥，请使用系统浏览器或 GitHub 登录。');buttons().forEach(b=>b.disabled=true)}`;
 const response=page(s?'通行密钥':'登录 Easybook',content),html=(await response.text()).replace('</body>',`<script nonce="${nonce}" src="/account/passkeys/client.js"></script><script nonce="${nonce}">${script}</script></body>`);
 const headers=new Headers(response.headers);headers.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
 return new Response(html,{headers});
}
