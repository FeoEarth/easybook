import {runAttachmentPurges} from '../../worker/attachment-purge.mjs';
import {session,csrf,requireForm,page,redirect} from './accounts.mjs';
import {escape} from './appearance.mjs';
import {executeAccountOperation} from '../../worker/account-operations.mjs';
const errorPage=(title,content,status)=>{const r=page(title,content);return new Response(r.body,{status,headers:r.headers})};
export async function operationApprovalRoutes(request,env){
 const path=new URL(request.url).pathname,match=path.match(/^\/account\/operations\/([a-f0-9-]{36})$/);if(!match)return null;
 const s=await session(request,env);if(!s)return redirect('/account/passkeys?return='+encodeURIComponent(path));
 const row=await env.DB.prepare('SELECT id,client_id,workspace_id,scope,tool,payload,status,expires_at FROM account_operation_approvals WHERE id=? AND account_id=?').bind(match[1],s.account_id).first();
 if(!row)return errorPage('操作不可用','<p>此审批不存在，或不属于当前账户。</p>',404);
 if(request.method==='POST'){
  const form=await requireForm(request,s);if(form.get('decision')==='deny'){await env.DB.prepare("UPDATE account_operation_approvals SET status='cancelled',completed_at=? WHERE id=? AND account_id=? AND status='pending'").bind(Date.now(),row.id,s.account_id).run();return redirect(path)}
  if(form.get('decision')!=='approve')return errorPage('操作不可用','<p>请选择批准或取消。</p>',400);
  try{await executeAccountOperation(env,row.id,s);try{await runAttachmentPurges(env,2)}catch{console.error(JSON.stringify({event:'attachment_purge_deferred'}))}return redirect(path)}catch(error){return errorPage('操作未执行',`<p>${escape(error.code||'暂时无法执行，请稍后安全重试。')}</p><a class="link" href="${path}">查看状态</a>`,error.code?409:503)}
 }
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const expired=row.expires_at<=Date.now(),pending=row.status==='pending'&&!expired,payload=JSON.parse(row.payload),count=payload.attachment_id?1:payload.items.length;
 return page('高风险操作审批',`<p>仅发起此 OAuth 授权的账户本人可以批准。批准后 Easybook 服务端自动执行，AI 不再提交执行请求。</p><div class="group"><div class="row"><strong>${escape(row.tool)}</strong><small>客户端：${escape(row.client_id)}<br>工作区：${escape(row.workspace_id)}<br>Scope：${escape(row.scope)}<br>${count} ${payload.attachment_id?'个附件':'条笔记'} · ${escape(expired&&row.status==='pending'?'已过期':row.status)}</small></div></div><h2>冻结的目标与参数</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(JSON.stringify(payload,null,2))}</pre><p>有效期十分钟。任何目标版本、账户权限或 OAuth 授权发生变化，整个批次终止，不会部分执行。</p>${pending?`<form method="post"><input type="hidden" name="csrf" value="${await csrf(request,s)}"><button name="decision" value="approve">批准并执行 ${count} 条操作</button><button name="decision" value="deny">取消操作</button></form>`:''}<a class="link" href="/account">账户与安全</a>`);
}

