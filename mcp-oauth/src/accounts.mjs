import {accountAllowed,sessionAllowed,revoked,reserveRevocations,finishRevocations} from '../../worker/security-checkpoint.mjs';
import {modernWorkspaces,workspacePolicy} from '../../worker/oauth-workspace-policy.mjs';
import {requestedScopes,readOnlyConsentNotice} from './requested-scopes.mjs';
import {githubCallback,identityEnabled} from '../../worker/identity-origin.mjs';
import {hash, READ, WRITE} from '../../worker/mcp-common.mjs';
import {verifyWorkspaceAssertion} from './pairing.mjs';
import {escape,oauthAppearance,htmlHeaders} from './appearance.mjs';

export const ACCOUNT_COOKIE='__Host-easybook-session';
const LOGIN_COOKIE='__Host-easybook-login';
export const SCOPES=[...READ,...WRITE];
const labels={'notes.read':'读取笔记','notes.write':'创建和修改笔记','notes.delete':'删除笔记','folders.read':'读取文件夹','folders.manage':'管理文件夹','tasks.read':'读取待办','tasks.manage':'管理待办','attachments.read':'读取附件','attachments.write':'上传和修改附件','workspace.read':'读取工作区信息'};
export const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export const readCookie=(request,name)=>(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const noStore={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export const json=(data,status=200)=>Response.json(data,{status,headers:noStore});
// Native browser forms need a non-null same-origin Origin. Keep redirects/JSON
// on no-referrer so OAuth response URLs still do not leak to other sites.
export function page(title,content,headers={}){
 const root=['账户与安全','登录 Easybook'].includes(title),backHref=root?'https://easybook.loonxy.com/':'/account',backLabel=root?'Easybook':'Easybook 账户';
 return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(title)} · Easybook</title>${oauthAppearance}<style>.group{background:var(--paper);border-radius:20px;padding:4px 16px;margin:20px 0}.row{padding:14px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}h2{font-size:13px;line-height:1.5;color:var(--muted);font-weight:500;margin:28px 16px 8px}.group{margin:0 0 20px}label{display:block;padding:12px 0;line-height:1.5}input,select{font:inherit;max-width:100%;accent-color:var(--accent)}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;margin-top:8px;padding:10px 12px;border:0;border-radius:10px;background:var(--bg);color:var(--ink);outline-offset:3px}input[type=checkbox]{width:18px;height:18px;vertical-align:middle;margin-right:8px}select{appearance:none;background-image:none}form{display:block;margin:18px 0;padding:16px;gap:0}.row form{margin:10px 0 0;padding:0;background:none;border-radius:0}form button{margin:8px 4px;min-height:44px}.row form button{margin:0;padding-left:0;background:none;color:var(--danger)}a.link{background:none;color:var(--accent);padding-left:0}small{display:block;color:var(--muted);font-size:13px}code{font-size:13px;word-break:break-all}.danger{color:var(--danger)}</style><body><a class="link" href="${backHref}">‹ ${backLabel}</a><h1>${escape(title)}</h1>${content}</body></html>`,{headers:{...htmlHeaders,...noStore,'Referrer-Policy':'same-origin',...headers}});
}
export function reauthenticationPage(message='此操作需要最近五分钟内重新验证身份。',returnPath='/account'){
 const target=encodeURIComponent(safeReturn(returnPath));
 return page('请重新验证身份',`<p>${escape(message)}</p><div class="group"><a class="link" href="/account/passkeys?return=${target}">使用通行密钥验证 ›</a><a class="link" href="/account/login?return=${target}">使用 GitHub 验证 ›</a></div><p>验证完成后会返回账户与安全页面。</p>`);
}
export function redirect(path,cookies=[]){const headers=new Headers({...noStore,Location:path});for(const c of cookies)headers.append('Set-Cookie',c);return new Response(null,{status:303,headers});}
export async function sessionToken(token,env){
 if(!/^[a-f0-9]{64}$/.test(token||''))return null;
 const current=await env.DB.prepare('SELECT s.*,a.display_name FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL)').bind(await hash(token),Date.now()).first();return current&&await sessionAllowed(env,current)?current:null;
}
export async function session(request,env){const current=await sessionToken(readCookie(request,ACCOUNT_COOKIE),env);if(current&&identityEnabled(env)&&await env.DB.prepare('SELECT session_id FROM account_native_sessions WHERE session_id=?').bind(current.id).first())return null;return current}
export async function csrf(request,s){return hash(readCookie(request,ACCOUNT_COOKIE)+'|'+s.id);}
export async function boundedText(request,max=16384){
 const reader=request.body?.getReader();if(!reader)return '';let size=0;const parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new Response('Too large',{status:413})}parts.push(value)}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.byteLength}return new TextDecoder().decode(bytes);
}
export async function requireForm(request,s,max=16384){
 if(request.headers.get('Origin')!==new URL(request.url).origin)throw new Response('Origin not allowed',{status:403});
 if(Number(request.headers.get('Content-Length')||0)>max)throw new Response('Too large',{status:413});
 const raw=await boundedText(request,max);if(raw.length>max)throw new Response('Too large',{status:413});
 const form=new URLSearchParams(raw);
 if(form.get('csrf')!==await csrf(request,s))throw new Response('Invalid CSRF token',{status:403});return form;
}
export async function rateLimit(request,env,kind,limit=30){
 await env.DB.prepare('DELETE FROM account_rate_limits WHERE bucket IN (SELECT bucket FROM account_rate_limits WHERE expires_at<? LIMIT 100)').bind(Date.now()).run();
 const bucket=kind+':'+await hash((request.headers.get('CF-Connecting-IP')||'unknown')+':'+Math.floor(Date.now()/60000));
 const row=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,Date.now()+120000).first();
 if(row.count>limit)throw new Response('Too many requests',{status:429,headers:{...noStore,'Retry-After':'60'}});
}
export function safeReturn(value){return typeof value==='string'&&value.length<=6000&&(value==='/account'||value==='/account?connect=1'||value==='/account/delete'||/^\/account\/handoff\?flow=[a-f0-9]{64}&state=[a-f0-9]{64}$/.test(value)||/^\/account\/operations\/[a-f0-9-]{36}$/.test(value)||value.startsWith('/oauth/authorize?'))?value:'/account';}
export async function startLogin(request,env,linkSession=null){
 await rateLimit(request,env,'login',10);
 const state='account_'+random(),browser=random();
 const returnPath=linkSession?'/account?identity-link=github':safeReturn(new URL(request.url).searchParams.get('return'));
 await env.DB.prepare('INSERT INTO account_login_states(state_hash,browser_hash,return_path,expires_at) VALUES(?,?,?,?)').bind(await hash(state),await hash(browser),returnPath,Date.now()+300000).run();
 if(linkSession)await env.DB.prepare('INSERT INTO account_identity_link_requests(state_hash,account_id,session_id,expires_at) VALUES(?,?,?,?)').bind(await hash(state),linkSession.account_id,linkSession.id,Date.now()+300000).run();
 const url=new URL('https://github.com/login/oauth/authorize');url.searchParams.set('client_id',env.GITHUB_CLIENT_ID);url.searchParams.set('redirect_uri',githubCallback(request,env));url.searchParams.set('state',state);
 return redirect(url.href,[cookie(LOGIN_COOKIE,browser,300)]);
}
export async function finishLogin(request,env,fetcher=fetch){
 const url=new URL(request.url),browser=readCookie(request,LOGIN_COOKIE),state=url.searchParams.get('state');
 if(!browser||!state||state.length>100)return json({error:'Login expired'},400);
 const proof=await env.DB.prepare('DELETE FROM account_login_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING return_path').bind(await hash(state),await hash(browser),Date.now()).first();
 if(!proof||url.searchParams.has('error')||!url.searchParams.get('code'))return json({error:'Login expired or declined'},400);
 const response=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:url.searchParams.get('code'),redirect_uri:githubCallback(request,env)})});
 if(!response.ok)return json({error:'Identity service unavailable'},502);
 const token=await response.json();if(typeof token.access_token!=='string'||token.access_token.length>512)return json({error:'Identity verification failed'},403);
 const identity=await fetcher('https://api.github.com/user',{headers:{Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'Easybook-Accounts','X-GitHub-Api-Version':'2022-11-28'},redirect:'error'});
 if(!identity.ok)return json({error:'Identity service unavailable'},502);
 const user=await identity.json();if(!Number.isSafeInteger(user?.id)||user.id<=0||user.type!=='User'||typeof user.login!=='string')return json({error:'Invalid identity'},403);
 const link=await env.DB.prepare('DELETE FROM account_identity_link_requests WHERE state_hash=? AND expires_at>? RETURNING account_id,session_id').bind(await hash(state),Date.now()).first();
 if(link){
  const current=await session(request,env);
  if(!current||current.id!==link.session_id||current.account_id!==link.account_id||Date.now()-current.authenticated_at>300000)return json({error:'Link session expired or changed'},403);
  const existing=await env.DB.prepare("SELECT account_id FROM account_identities WHERE provider='github' AND subject=?").bind(String(user.id)).first();
  if(existing&&existing.account_id!==current.account_id)return json({error:'This GitHub identity belongs to another account'},409);
  try{await env.DB.prepare("INSERT INTO account_identities(provider,subject,account_id) VALUES('github',?,?) ON CONFLICT(provider,subject) DO NOTHING").bind(String(user.id),current.account_id).run()}catch{return json({error:'Identity cannot be linked'},409)}
  const linked=await env.DB.prepare("SELECT account_id FROM account_identities WHERE provider='github' AND subject=?").bind(String(user.id)).first();
  if(linked?.account_id!==current.account_id)return json({error:'Identity cannot be linked'},409);
  return redirect('/account',[cookie(LOGIN_COOKIE,'',0)]);
 }
 if(proof.return_path==='/account?identity-link=github')return json({error:'Identity link request expired'},403);
 // Provider subject is never used as the local account ID, and names/emails never link accounts.
 const candidate=crypto.randomUUID(),now=Date.now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO accounts(id,display_name,created_at) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM account_identities WHERE provider='github' AND subject=?)").bind(candidate,user.login.slice(0,100),now,String(user.id)),
  env.DB.prepare("INSERT INTO account_identities(provider,subject,account_id) VALUES('github',?,?) ON CONFLICT(provider,subject) DO NOTHING").bind(String(user.id),candidate)
 ]);
 const account=await env.DB.prepare("SELECT a.id FROM accounts a JOIN account_identities i ON i.account_id=a.id WHERE i.provider='github' AND i.subject=? AND a.deleted_at IS NULL").bind(String(user.id)).first();
 if(!account)return json({error:'Account unavailable'},403);
 const established=await createSession(request,env,account.id);
 return redirect(proof.return_path,[established.cookie,cookie(LOGIN_COOKIE,'',0)]);
}
export async function createSession(request,env,accountId,credentialId=null,authenticatedAt=Date.now()){
 if(!await accountAllowed(env,accountId)||await revoked(env,'passkey',credentialId))throw json({error:'identity_revoked'},403);
 const token=random(),id=crypto.randomUUID(),now=Date.now();
 const statements=[env.DB.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,expires_at,authenticated_at,device) VALUES(?,?,?,?,?,?,?)').bind(id,await hash(token),accountId,now,now+7*86400000,authenticatedAt,(request.headers.get('User-Agent')||'Browser').slice(0,180))];
 if(credentialId)statements.push(env.DB.prepare('INSERT INTO account_session_passkeys(session_id,credential_id) VALUES(?,?)').bind(id,credentialId));
 await env.DB.batch(statements);return {id,token,cookie:cookie(ACCOUNT_COOKIE,token,7*86400)};
}
export async function accountRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path==='/account/login'&&request.method==='GET')return startLogin(request,env);
 if(path==='/callback'&&url.searchParams.get('state')?.startsWith('account_'))return finishLogin(request,env);
 if(!path.startsWith('/account')&&!['/oauth/grants','/oauth/clients'].includes(path))return null;
 const s=await session(request,env);
 if(!s&&['/oauth/grants','/oauth/clients'].includes(path))return json({error:'unauthorized'},401);
 if(!s)return page('登录 Easybook',`<p>使用 GitHub 验证身份，建立独立的 Easybook 账户。此账户与同步密钥分开；登录不会自动获得任何已有工作区。</p><a href="/account/login?return=${encodeURIComponent(safeReturn(path+url.search))}">继续使用 GitHub</a><p><a class="link" href="/account/passkeys?return=${encodeURIComponent(safeReturn(path+url.search))}">使用通行密钥登录或创建账户</a></p>`);
 const c=await csrf(request,s),hidden=`<input type="hidden" name="csrf" value="${c}">`;
 if(request.method==='POST'){
  const f=await requireForm(request,s);
  if(path==='/account/identities/github'){
   if(Date.now()-s.authenticated_at>300000)return page('请重新验证身份','<p>关联登录身份前，请先使用通行密钥或 GitHub 重新登录。</p><a href="/account/passkeys">重新登录</a>');
   return startLogin(request,env,s);
  }
  if(path==='/account/logout'){
   const revocation=await reserveRevocations(env,[['session',s.id]]);await env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=? AND account_id=?').bind(Date.now(),s.id,s.account_id).run();await finishRevocations(env,revocation,'committed');return redirect('/account',[cookie(ACCOUNT_COOKIE,'',0)]);
  }
  if(path==='/account/sessions/revoke'){
   if(f.get('id')!==s.id&&Date.now()-s.authenticated_at>300000)return reauthenticationPage('管理其他设备前，请先重新验证身份。');
   if(!await env.DB.prepare('SELECT 1 FROM account_sessions WHERE id=? AND account_id=?').bind(f.get('id'),s.account_id).first())return json({error:'not_found'},404);
   const revocation=await reserveRevocations(env,[['session',f.get('id')]]);await env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=? AND account_id=?').bind(Date.now(),f.get('id'),s.account_id).run();await finishRevocations(env,revocation,'committed');return redirect('/account');
  }
  if(path==='/account/profile'){
   const name=(f.get('name')||'').trim();if(!name||name.length>100)return json({error:'Invalid name'},400);
   await env.DB.prepare('UPDATE accounts SET display_name=? WHERE id=?').bind(name,s.account_id).run();return redirect('/account');
  }
  if(path==='/account/delete'&&modernWorkspaces(env))return json({error:'account_deletion_requires_workspace_disposition'},409);
  if(path==='/account/workspaces/claim'&&modernWorkspaces(env))return json({error:'use_verified_workspace_association'},410);
  if(path==='/account/delete'){
   if(f.get('confirm')!=='DELETE')return page('删除账户',`<p>删除账户会撤销账户会话与新 OAuth 授权。笔记、附件和原有同步密钥保留，仍可通过原有设备访问。第三方旧 GitHub 授权需在原有授权界面单独撤销。</p><form method="post">${hidden}<label>输入 DELETE 确认 <input name="confirm" required></label><button class="danger">确认删除账户</button></form>`);
   if(Date.now()-s.authenticated_at>300000)return reauthenticationPage('删除账户前需要最近五分钟内验证身份。','/account/delete');
   await env.DB.batch([
    env.DB.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').bind(Date.now(),s.account_id),
    env.DB.prepare('UPDATE account_sessions SET revoked_at=? WHERE account_id=?').bind(Date.now(),s.account_id),
    env.DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE account_id=?').bind(Date.now(),s.account_id),
    env.DB.prepare('UPDATE workspace_memberships SET revoked_at=? WHERE account_id=?').bind(Date.now(),s.account_id)
   ]);return redirect('/account',[cookie(ACCOUNT_COOKIE,'',0)]);
  }
  if(path==='/oauth/grants'){
   if(f.get('confirm')!=='yes')return page('撤销应用授权',`<p>该授权的笔记、附件及其他访问将立即停止。</p><form method="post">${hidden}<input type="hidden" name="id" value="${escape(f.get('id'))}"><button name="confirm" value="yes" class="danger">撤销授权</button><a class="link" href="/account">取消</a></form>`);
   if(!await env.DB.prepare('SELECT 1 FROM oauth_grants WHERE id=? AND account_id=?').bind(f.get('id'),s.account_id).first())return json({error:'not_found'},404);
   const revocation=await reserveRevocations(env,[['oauth',f.get('id')]]);await env.DB.prepare('UPDATE oauth_grants SET revoked_at=? WHERE id=? AND account_id=?').bind(Date.now(),f.get('id'),s.account_id).run();await finishRevocations(env,revocation,'committed');return redirect('/account');
  }
  if(path==='/account/workspaces/claim'){
   await rateLimit(request,env,'claim',10);
   const challenge=f.get('challenge'),assertion=f.get('assertion');
   if(!/^[a-f0-9]{64}$/.test(challenge||''))return json({error:'Invalid challenge'},400);
   const workspace=await verifyWorkspaceAssertion(assertion,env.MCP_PAIRING_SIGNING_KEY,challenge);
   if(!workspace)return json({error:'Invalid workspace proof'},403);
   // Consume and claim in one atomic D1 transaction. A known workspace ID is never proof.
   const digest=await hash(challenge),now=Date.now();
   const results=await env.DB.batch([
    env.DB.prepare("INSERT INTO workspace_memberships(workspace_id,account_id,role,created_at) SELECT ?,account_id,'owner',? FROM account_workspace_claims WHERE challenge_hash=? AND account_id=? AND session_id=? AND expires_at>? ON CONFLICT(workspace_id,account_id) DO UPDATE SET revoked_at=NULL").bind(workspace,now,digest,s.account_id,s.id,now),
    env.DB.prepare('DELETE FROM account_workspace_claims WHERE challenge_hash=? AND account_id=? AND session_id=? AND expires_at>? RETURNING challenge_hash').bind(digest,s.account_id,s.id,now)
   ]);
   if(!results[1].results.length)return json({error:'Claim expired or already used'},409);return redirect('/account');
  }
  return json({error:'Not found'},404);
 }
 if(request.method!=='GET')return json({error:'Method not allowed'},405);
 if(path==='/oauth/grants'||path==='/oauth/clients'){
  const {results}=await env.DB.prepare('SELECT id,client_id,workspace_id,scopes,created_at,revoked_at FROM oauth_grants WHERE account_id=? ORDER BY created_at DESC LIMIT 100').bind(s.account_id).all();
  return json(path==='/oauth/clients'?{clients:[...new Set(results.map(g=>g.client_id))]}:{grants:results});
 }
 if(modernWorkspaces(env)){const {workspaceAccountPage}=await import('./workspace-consent.mjs');return workspaceAccountPage(request,env,s);}
 const [devices,workspaces,grants]=await Promise.all([
  env.DB.prepare('SELECT id,device,created_at FROM account_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 50').bind(s.account_id,Date.now()).all(),
  env.DB.prepare('SELECT workspace_id,role FROM workspace_memberships WHERE account_id=? AND revoked_at IS NULL').bind(s.account_id).all(),
  env.DB.prepare('SELECT id,client_id,workspace_id,scopes FROM oauth_grants WHERE account_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100').bind(s.account_id).all()
 ]);
 const challenge=random();await env.DB.prepare('INSERT INTO account_workspace_claims(challenge_hash,account_id,session_id,expires_at) VALUES(?,?,?,?)').bind(await hash(challenge),s.account_id,s.id,Date.now()+300000).run();
 const connect=`<p>在已连接工作区的 Easybook Web 打开“账户连接”，由现有设备证明工作区访问权。</p><a href="https://easybook.loonxy.com/account/connect" target="_blank" rel="noopener">打开工作区连接</a>`;
 return page('账户与安全',`<p>${escape(s.display_name)}<small>账户 ID：${escape(s.account_id)}</small></p><form method="post" action="/account/profile">${hidden}<label>账户名称 <input name="name" value="${escape(s.display_name)}" maxlength="100" required></label><button>保存</button></form><h2>工作区</h2><div class="group">${workspaces.results.map(w=>`<div class="row"><code>${escape(w.workspace_id)}</code><small>${escape(w.role)}</small></div>`).join('')||'<p>尚未关联工作区</p>'}</div>${connect}<form method="post" action="/account/workspaces/claim" id="claim">${hidden}<input type="hidden" name="challenge" value="${challenge}"><label>设备生成的工作区证明 <input name="assertion" maxlength="8192" required></label><button>关联工作区</button><small>本页挑战码：<code>${challenge}</code>。仅凭同步密钥的可信设备生成证明。若该工作区已有其他所有者，认领会被拒绝。</small></form><h2>登录方式</h2><div class="group"><a class="link" href="/account/passkeys">通行密钥与独立登录 ›</a></div><h2>已登录设备</h2><div class="group">${devices.results.map(d=>`<div class="row">${escape(d.device)}<small>${d.id===s.id?'当前设备 · ':''}${escape(new Date(d.created_at).toISOString())}</small><form method="post" action="/account/sessions/revoke">${hidden}<input type="hidden" name="id" value="${escape(d.id)}"><button class="danger">退出此设备</button></form></div>`).join('')}</div><h2>已授权应用</h2><div class="group">${grants.results.map(g=>`<div class="row"><code>${escape(g.client_id)}</code><small>工作区 ${escape(g.workspace_id.slice(0,12))}</small><p>${escape(JSON.parse(g.scopes).map(x=>labels[x]||x).join('、'))}</p><form method="post" action="/oauth/grants">${hidden}<input type="hidden" name="id" value="${escape(g.id)}"><button class="danger">撤销授权</button></form></div>`).join('')||'<p>暂无新账户授权</p>'}</div><p>旧 GitHub OAuth 与配对授权继续可用；不会自动成为账户工作区。已有数据和同步密钥保持独立。</p><form method="post" action="/account/logout">${hidden}<button>退出登录</button></form><form method="post" action="/account/delete">${hidden}<button class="danger">删除账户…</button></form>`);
}

export async function accountAuthorize(request,env){
 if(modernWorkspaces(env)){const {workspaceAuthorize}=await import('./workspace-consent.mjs');return workspaceAuthorize(request,env);}
 const oauth=env.OAUTH_PROVIDER,s=await session(request,env),url=new URL(request.url);
 if(!s)return redirect('/account/login?return='+encodeURIComponent(safeReturn(url.pathname+url.search)));
 if(request.method==='GET'){
  await rateLimit(request,env,'authorize');
  const auth=await oauth.parseAuthRequest(request);
  if(!auth.state||auth.codeChallengeMethod!=='S256'||!auth.codeChallenge)return json({error:'state and PKCE S256 required'},400);
  if(auth.scope.some(x=>!SCOPES.includes(x)&&x!=='mcp:read'))return json({error:'invalid_scope'},400);
  const client=await oauth.lookupClient(auth.clientId),consent=await oauth.beginConsent(auth);
  const {results}=await env.DB.prepare('SELECT workspace_id FROM workspace_memberships WHERE account_id=? AND revoked_at IS NULL').bind(s.account_id).all();
  if(!results.length)return page('先关联工作区','<p>登录不代表拥有旧工作区。请先使用可信设备关联工作区，再返回客户端重新授权。</p><a href="/account">账户与工作区</a>');
  const requested=requestedScopes(auth.scope);
  const response=page('授权应用',`<p><strong>${escape(client?.clientName||'第三方应用')}</strong> 请求访问你的 Easybook。</p><div class="group"><div class="row">客户端 ID<code>${escape(auth.clientId)}</code></div><div class="row">返回地址<code>${escape(auth.redirectUri)}</code></div></div><p>名称由应用提供。请根据客户端 ID 和返回地址确认身份。</p>${readOnlyConsentNotice(requested)}<form method="post" action="/oauth/authorize"><input type="hidden" name="csrf" value="${await csrf(request,s)}"><input type="hidden" name="handle" value="${escape(consent.handle)}"><label>工作区 <select name="workspace">${results.map(w=>`<option value="${w.workspace_id}">${w.workspace_id.slice(0,12)}</option>`).join('')}</select></label>${requested.map(scope=>`<label><input type="checkbox" name="scope" value="${scope}" ${READ.includes(scope)?'checked':''}> ${escape(labels[scope])} <small>${scope}</small></label>`).join('')}<button name="decision" value="allow">允许所选权限</button><button name="decision" value="deny">取消</button></form>`);
  const headers=new Headers(response.headers);for(const [key,value]of consent.headers)headers.append(key,value);return new Response(response.body,{headers});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const form=await requireForm(request,s),handle=form.get('handle');
 if(form.get('decision')!=='allow')return oauth.denyConsent(request,handle);
 const approved=await oauth.approveConsent(request,handle),auth=approved.request;
 const allowed=requestedScopes(auth.scope);
 const scopes=[...new Set(form.getAll('scope'))];
 if(!scopes.length||scopes.some(x=>!allowed.includes(x)||!SCOPES.includes(x)))return json({error:'invalid_scope'},400);
 const workspace=form.get('workspace');
 const member=await env.DB.prepare('SELECT role FROM workspace_memberships WHERE workspace_id=? AND account_id=? AND revoked_at IS NULL').bind(workspace,s.account_id).first();
 if(!member)return json({error:'Workspace not owned'},403);
 const policy=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO oauth_grants(id,account_id,client_id,workspace_id,scopes,created_at) VALUES(?,?,?,?,?,?)').bind(policy,s.account_id,auth.clientId,workspace,JSON.stringify(scopes),Date.now()).run();
 const completed=await oauth.completeAuthorization({request:auth,userId:s.account_id,scope:scopes,metadata:{workspace,policy},props:{accountId:s.account_id,policyId:policy},revokeExistingGrants:false});
 const headers=new Headers(approved.headers);headers.set('Location',completed.redirectTo);headers.set('Cache-Control','no-store');return new Response(null,{status:303,headers});
}

export async function policyFor(env,props,clientId,tokenScopes){
 if(!props?.accountId||!props?.policyId)return null;
 if(modernWorkspaces(env)){if(typeof clientId!=='string'||!clientId)return null;return workspacePolicy(env,props.policyId,{accountId:props.accountId,clientId,tokenScopes});}
 const row=await env.DB.prepare('SELECT g.* FROM oauth_grants g JOIN accounts a ON a.id=g.account_id JOIN workspace_memberships m ON m.account_id=g.account_id AND m.workspace_id=g.workspace_id WHERE g.id=? AND g.account_id=? AND g.client_id=? AND g.revoked_at IS NULL AND a.deleted_at IS NULL AND m.revoked_at IS NULL').bind(props.policyId,props.accountId,clientId).first();
 if(!row)return null;
 const allowed=JSON.parse(row.scopes);return {...row,scopes:tokenScopes.filter(x=>allowed.includes(x))};
}



