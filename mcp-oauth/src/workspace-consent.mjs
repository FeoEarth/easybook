import {READ} from '../../worker/mcp-common.mjs';
import {V2_SCOPES,accountPolicies} from '../../worker/oauth-workspace-policy.mjs';
import {listWorkspaces,workspaceAccess,roleScopes} from '../../worker/workspace-identity.mjs';
import {session,csrf,requireForm,json,page,redirect,rateLimit,safeReturn} from './accounts.mjs';
import {escape,oauthConsentHeaders} from './appearance.mjs';
const labels={'notes.read':'读取笔记','notes.write':'创建和编辑笔记','notes.delete':'删除笔记','folders.read':'读取文件夹','folders.manage':'编辑文件夹','tasks.read':'读取待办','tasks.manage':'编辑待办','attachments.read':'查看附件','attachments.write':'上传和编辑附件','workspace.read':'读取工作区信息','workspace.create':'创建新的账户关联工作区','workspace.write':'重命名和修改普通工作区设置'};
const roles={manager:'管理者',editor:'编辑者',reader:'阅读者'};
const requested=auth=>auth.scope.includes('mcp:read')?READ:auth.scope.length?auth.scope:['workspace.read'];
export async function workspaceAuthorize(request,env){
 const url=new URL(request.url),s=await session(request,env),oauth=env.OAUTH_PROVIDER;
 if(!s)return redirect('/account/passkeys?return='+encodeURIComponent(safeReturn(url.pathname+url.search)));
 if(request.method==='GET'){
  await rateLimit(request,env,'authorize');const auth=await oauth.parseAuthRequest(request);
  if(!auth.state||auth.codeChallengeMethod!=='S256'||!auth.codeChallenge)return json({error:'state_and_pkce_s256_required'},400);
  if(auth.scope.some(scope=>!V2_SCOPES.includes(scope)&&scope!=='mcp:read'))return json({error:'invalid_scope'},400);
  const scopes=requested(auth),workspaces=await listWorkspaces(env,{kind:'account',accountId:s.account_id});
  if(!workspaces.length&&!scopes.includes('workspace.create'))return page('先关联工作区','<p>单人工作区需要先关联此账户，才能授权 AI 与 MCP。</p><a class="link" href="/">工作区管理</a>');
  const client=await oauth.lookupClient(auth.clientId),consent=await oauth.beginConsent(auth);
  const response=page('授权 AI 与 MCP',`<p><strong>${escape(client?.clientName||'第三方应用')}</strong> 请求访问你的 Easybook。</p><div class="group"><div class="row">客户端 ID<code>${escape(auth.clientId)}</code></div><div class="row">返回地址<code>${escape(auth.redirectUri)}</code></div></div><p>应用名称由客户端提供，请核对身份和返回地址。</p><form method="post" action="/oauth/authorize"><input type="hidden" name="csrf" value="${await csrf(request,s)}"><input type="hidden" name="handle" value="${escape(consent.handle)}"><h2>选择工作区</h2><p>默认不选择任何工作区。授权范围始终受你当前的工作区角色限制。</p><div class="group">${workspaces.map(w=>`<label><input type="checkbox" name="workspace" value="${w.id}"> ${escape(w.name)}<small>${roles[w.role]} · ${w.mode==='shared'?'多人':'单人'}工作区</small></label>`).join('')||'<p>暂无已关联工作区。</p>'}</div><h2>允许的操作</h2>${scopes.map(scope=>`<label><input type="checkbox" name="scope" value="${scope}" ${READ.includes(scope)?'checked':''}> ${escape(labels[scope])}<small>${scope}</small></label>`).join('')}<p>阅读者只能授权只读操作。新建工作区不会自动扩大此客户端已有的内容访问范围。成员、同步密钥和账户安全操作不属于 AI 权限。</p><button name="decision" value="allow">允许所选范围</button><button name="decision" value="deny">取消</button></form>`,oauthConsentHeaders(auth.redirectUri));
  const headers=new Headers(response.headers);for(const [key,value]of consent.headers)headers.append(key,value);return new Response(response.body,{headers});
 }
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 const form=await requireForm(request,s),handle=form.get('handle');
 if(form.get('decision')!=='allow')return oauth.denyConsent(request,handle);
 const approved=await oauth.approveConsent(request,handle),auth=approved.request;
 if(!auth.state||auth.codeChallengeMethod!=='S256'||!auth.codeChallenge||auth.scope.some(scope=>!V2_SCOPES.includes(scope)&&scope!=='mcp:read'))return json({error:'invalid_authorization_request'},400);
 const allowed=requested(auth),scopes=[...new Set(form.getAll('scope'))],ids=[...new Set(form.getAll('workspace'))];
 if(!scopes.length||scopes.some(scope=>!allowed.includes(scope)||!V2_SCOPES.includes(scope))||ids.length>50||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))return json({error:'invalid_scope_or_workspace'},400);
 if(!ids.length&&!scopes.includes('workspace.create'))return json({error:'choose_workspace'},400);
 const bindings=[];
 for(const id of ids){const access=await workspaceAccess(env,id,{kind:'account',accountId:s.account_id});if(!access)return json({error:'workspace_access_denied'},403);
  const effective=roleScopes(access.role,scopes.filter(scope=>scope!=='workspace.create'));
  if(!effective.length)return json({error:'selected_role_does_not_allow_requested_operations'},400);
  bindings.push({id,version:access.version,role:access.role,scopes:effective});
 }
 const effective=[...new Set([...scopes.filter(x=>x==='workspace.create'),...bindings.flatMap(b=>b.scopes)])],policy=crypto.randomUUID(),now=Date.now(),check=crypto.randomUUID();
 const statements=[env.DB.prepare('INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL))').bind(check,s.id,s.account_id,now),env.DB.prepare('INSERT INTO oauth_grants(id,account_id,client_id,workspace_id,scopes,created_at) VALUES(?,?,?,?,?,?)').bind(policy,s.account_id,auth.clientId,ids[0]||'',JSON.stringify(effective),now)];
 for(const binding of bindings){const guard=crypto.randomUUID();statements.push(env.DB.prepare("INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspaces w WHERE w.id=? AND w.version=? AND w.deleted_at IS NULL AND ((?='manager' AND w.manager_account_id=?) OR (w.mode='shared' AND EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.account_id=? AND m.role=?))))").bind(guard,binding.id,binding.version,binding.role,s.account_id,s.account_id,binding.role),env.DB.prepare('INSERT INTO oauth_grant_workspaces(policy_id,workspace_id,scopes,created_at) VALUES(?,?,?,?)').bind(policy,binding.id,JSON.stringify(binding.scopes),now),env.DB.prepare('DELETE FROM workspace_tx_assertions WHERE id=?').bind(guard));}
 if(ids.length)statements.push(env.DB.prepare('INSERT INTO oauth_active_workspaces(policy_id,workspace_id) VALUES(?,?)').bind(policy,ids[0]));
 statements.push(env.DB.prepare('DELETE FROM workspace_tx_assertions WHERE id=?').bind(check));
 try{await env.DB.batch(statements)}catch(error){if(String(error.message).includes('workspace_tx_assertions')||String(error.message).includes('valid=1'))return json({error:'authorization_state_changed'},409);throw error}
 const completed=await oauth.completeAuthorization({request:auth,userId:s.account_id,scope:effective,metadata:{policy},props:{accountId:s.account_id,policyId:policy},revokeExistingGrants:false});
 const headers=new Headers(approved.headers);headers.set('Location',completed.redirectTo);headers.set('Cache-Control','no-store');return new Response(null,{status:303,headers});
}

export async function workspaceAccountPage(request,env,s){
 const hidden=`<input type="hidden" name="csrf" value="${await csrf(request,s)}">`;
 const [workspaces,devices,policies]=await Promise.all([
  listWorkspaces(env,{kind:'account',accountId:s.account_id}),
  env.DB.prepare('SELECT id,device FROM account_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 50').bind(s.account_id,Date.now()).all(),
  accountPolicies(env,s.account_id)
 ]);
 return page('账户与安全',`<p>${escape(s.display_name)}</p><form method="post" action="/account/profile">${hidden}<label>账户名称<input name="name" maxlength="100" value="${escape(s.display_name)}" required></label><button>保存</button></form><h2>工作区</h2><div class="group">${workspaces.map(w=>`<div class="row"><strong>${escape(w.name)}</strong><small>${roles[w.role]} · ${w.mode==='shared'?'多人':'单人'}工作区</small></div>`).join('')||'<p>尚未关联工作区。</p>'}</div><p>单人工作区需要独立验证同步密钥后关联账户；登录不会自动取得其他工作区。</p><a class="link" href="/">返回工作区管理</a><a class="link danger" href="/account/delete">删除账户…</a><h2>安全与活动</h2><div class="group"><a class="link" href="/account/notifications">安全通知 ›</a><a class="link" href="/account/activity">活动与安全记录 ›</a></div><h2>登录方式</h2><div class="group"><a class="link" href="/account/passkeys">通行密钥与 GitHub 关联 ›</a></div><h2>已登录设备</h2><div class="group">${devices.results.map(d=>`<div class="row"><strong>${d.id===s.id?'当前浏览器':escape(d.device)}</strong><form method="post" action="/account/sessions/revoke">${hidden}<input type="hidden" name="id" value="${escape(d.id)}"><button>退出此设备</button></form></div>`).join('')||'<p>暂无其他设备。</p>'}</div><p>退出账户设备不会撤销其独立持有的单人工作区同步密钥；需要时请轮换该密钥。</p><h2>AI 与 MCP</h2><div class="group">${policies.map(g=>`<div class="row"><strong>${escape(g.client_id)}</strong><small>${g.last_activity?'最近活动：'+escape(new Date(g.last_activity).toLocaleString('zh-CN')):'暂无工具活动'}</small>${g.workspaces.map(w=>`<div><strong>${escape(w.name)}（${roles[w.role]}）</strong><small>${escape(w.scopes.map(scope=>labels[scope]||scope).join('、'))}</small><form method="post" action="/oauth/workspace-grants">${hidden}<input type="hidden" name="id" value="${g.id}"><input type="hidden" name="workspace" value="${w.id}"><button>撤销此工作区授权</button></form><a class="link" href="/account/activity?workspace=${w.id}">查看工作区活动</a></div>`).join('')||'<small>暂无有效的工作区内容授权</small>'}<small>${g.globalScopes.includes('workspace.create')?'允许创建新工作区；新工作区内容仍需重新授权。':''}</small><form method="post" action="/oauth/grants">${hidden}<input type="hidden" name="id" value="${g.id}"><button>撤销此客户端授权</button></form></div>`).join('')||'<p>暂无已连接客户端。</p>'}</div><form method="post" action="/account/logout">${hidden}<button>退出当前浏览器账户</button></form>`);
}


