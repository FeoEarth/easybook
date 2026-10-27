import {backupDiagnostics} from '../../worker/backup-diagnostics.mjs';
import {session,page,redirect,json,rateLimit} from './accounts.mjs';
import {escape} from './appearance.mjs';
export async function backupDiagnosticsRoute(request,env){
 const url=new URL(request.url);if(url.pathname!=='/account/backup-status')return null;
 const s=await session(request,env);if(!s)return redirect('/account/passkeys?return='+encodeURIComponent(url.pathname+url.search));
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 await rateLimit(request,env,'backup-diagnostics',30);
 let data;try{data=await backupDiagnostics(env,s.account_id,{workspaceId:url.searchParams.get('workspace'),cursor:url.searchParams.get('cursor')});}catch(error){
  const status=error.status||503;if(url.searchParams.get('format')==='json')return json({error:error.code||'attachment_check_unavailable'},status);
  const response=page('备份与附件检查',`<p>${status===403?'仅工作区管理者可以检查本工作区的附件。':status===400?'检查链接已失效，请重新开始。':'暂时无法完成检查，请稍后重试。'}</p><a class="link" href="/account/notifications">返回安全通知 ›</a>`);return new Response(response.body,{status,headers:response.headers});
 }
 if(url.searchParams.get('format')==='json')return json(data);
 const titles={running:'备份正在执行',failed:'最近一次备份未完成',complete:'已有完成的备份',not_completed:'尚无已完成备份'};
 const next=new URL(url);if(data.next_cursor)next.searchParams.set('cursor',data.next_cursor);
 return page('备份与附件检查',`<div class="group"><div class="row"><strong>${titles[data.backup.state]}</strong><small>${data.backup.last_success?'最近成功：'+escape(new Date(data.backup.last_success).toLocaleString('zh-CN',{timeZone:'Asia/Singapore'}))+'（新加坡时间）':'尚无成功记录'}</small>${data.backup.error==='missing_attachments'?'<small>备份发现缺失附件，尚未通过完整性检查。</small>':''}</div></div><p>仅检查你管理的工作区。本页读取附件目录，不会修改笔记、上传文件或执行恢复。</p><h2>本页检查</h2><div class="group"><div class="row">已检查 ${data.checked} 个附件引用，发现 ${data.missing.length} 项需要处理。</div></div>${data.missing.length?`<h2>需要处理的附件</h2><div class="group">${data.missing.map(item=>`<div class="row"><strong>${escape(item.title||'无标题笔记')}</strong><small>${escape(item.workspace_name)}${item.deleted?' · 回收站':''}</small><small>${escape(item.attachment_name||'未命名附件')} · ${item.reason==='invalid_reference'?'引用格式异常':item.placeholder?'缺少文件，占位式引用':'云端找不到对应文件'}</small></div>`).join('')}</div><p>请在仍保有原文件的设备上打开这些笔记并重新同步附件。如果是测试占位内容，可在笔记中手动移除，再等待下一次备份检查。</p>`:'<p>本页未发现缺失文件。这不是全部备份或附件内容哈希校验通过的证明。</p>'}${data.next_cursor?`<a class="link" href="${escape(next.pathname+next.search)}">继续检查更多引用 ›</a>`:''}<a class="link" href="/account/backup-status">从头检查</a><a class="link" href="/account/notifications">安全通知 ›</a>`);
}
