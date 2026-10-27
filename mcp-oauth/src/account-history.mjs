import {listWorkspaces} from '../../worker/workspace-identity.mjs';
import {session,csrf,requireForm,page,redirect,json} from './accounts.mjs';
import {escape} from './appearance.mjs';
import {auditHistory,notifications} from '../../worker/account-history.mjs';
const titles={'operation.backup_failed':'数据备份未完成，需要检查附件','account.passkey_added':'已添加通行密钥','oauth.authorized':'已授权 AI/MCP 客户端','oauth.workspace_revoked':'已撤销工作区子授权','account.login':'账户发生新登录','account.session_revoked':'设备会话已撤销','account.passkey_revoked':'通行密钥已撤销','oauth.revoked':'AI / MCP 授权已撤销','operation.approval_pending':'有操作等待本人审批','operation.permanent_delete':'已执行永久删除','operation.cleanup_failed':'附件清理需要处理','workspace.security_changed':'工作区安全设置已变更'};
export async function accountHistoryRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;if(!['/account/notifications','/account/activity','/account/notification-preferences'].includes(path))return null;
 const s=await session(request,env);if(!s)return redirect('/account/passkeys');
 if(request.method==='POST'){
  const form=await requireForm(request,s);
  if(path==='/account/notification-preferences'){
   // Critical alerts have no preference field and cannot be disabled.
   if([...form.keys()].some(k=>!['csrf','normal','important'].includes(k)))return json({error:'invalid_preference'},400);
   await env.DB.prepare('INSERT INTO account_notification_preferences(account_id,normal_enabled,important_enabled) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET normal_enabled=excluded.normal_enabled,important_enabled=excluded.important_enabled').bind(s.account_id,form.get('normal')==='on'?1:0,form.get('important')==='on'?1:0).run();
  }else if(path==='/account/notifications')await env.DB.prepare('UPDATE account_notifications SET read_at=? WHERE account_id=? AND read_at IS NULL').bind(Date.now(),s.account_id).run();
  else return json({error:'method_not_allowed'},405);
  return redirect('/account/notifications');
 }
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 if(path==='/account/activity'){
  let data;try{data=await auditHistory(env,s.account_id,{workspaceId:url.searchParams.get('workspace'),cursor:url.searchParams.get('cursor'),category:url.searchParams.get('category')})}catch(e){return json({error:e.code||'unavailable'},400)}
  if(url.searchParams.get('format')==='json')return json(data);
  const next=new URL(url);if(data.next_cursor)next.searchParams.set('cursor',data.next_cursor);
  const workspaces=await listWorkspaces(env,{kind:'account',accountId:s.account_id});
  return page('活动与安全记录',`<form method="get" action="/account/activity"><label>范围<select name="workspace"><option value="">我的账户</option>${workspaces.map(w=>`<option value="${w.id}" ${url.searchParams.get('workspace')===w.id?'selected':''}>${escape(w.name)}</option>`).join('')}</select></label><label>类型<select name="category">${[['','全部'],['security','账户安全'],['activity','AI/MCP 活动'],['execution','执行记录']].map(([value,label])=>`<option value="${value}" ${url.searchParams.get('category')===value?'selected':''}>${label}</option>`).join('')}</select></label><button>筛选</button></form><p>私人账户安全记录仅本人可见。多人工作区管理者可查看工作区成员的 AI / MCP 活动，成员只能查看自己的活动。</p><div class="group">${data.events.map(e=>`<div class="row"><strong>${escape(titles[e.code]||e.code)}</strong><small>${escape(e.status)} · ${escape(new Date(e.created_at).toISOString())}</small></div>`).join('')||'<p>暂无记录。</p>'}</div>${data.next_cursor?`<a class="link" href="${escape(next.pathname+next.search)}">更早记录 ›</a>`:''}`);
 }
 const [rows,prefs]=await Promise.all([notifications(env,s.account_id),env.DB.prepare('SELECT normal_enabled,important_enabled FROM account_notification_preferences WHERE account_id=?').bind(s.account_id).first()]);const hidden=`<input type="hidden" name="csrf" value="${await csrf(request,s)}">`;
 if(url.searchParams.get('format')==='json')return json({notifications:rows,preferences:{normal:prefs?.normal_enabled??1,important:prefs?.important_enabled??1,critical:true}});
 return page('安全通知',`<p>严重安全事件始终保留应用内记录，不提供关闭开关。外部渠道仍需完成邮箱验证或启用 Android 系统推送，系统权限和解绑始终有效。</p><form method="post" action="/account/notification-preferences">${hidden}<label><input type="checkbox" name="normal" ${(prefs?.normal_enabled??1)?'checked':''}>普通通知</label><label><input type="checkbox" name="important" ${(prefs?.important_enabled??1)?'checked':''}>重要通知</label><button>保存偏好</button></form><div class="group">${rows.map(n=>`<div class="row"><strong>${escape(titles[n.code]||n.code)}</strong>${n.code==='operation.backup_failed'?'<a class="link" href="/account/backup-status">查看备份与缺失附件 ›</a>':''}<small>${n.severity==='critical'?'严重 · ':''}${escape(new Date(n.created_at).toISOString())}${n.read_at?'':' · 未读'}</small></div>`).join('')||'<p>暂无通知。</p>'}</div><form method="post" action="/account/notifications">${hidden}<button>全部标为已读</button></form><a class="link" href="/account/activity">活动与安全记录 ›</a>`);
}


