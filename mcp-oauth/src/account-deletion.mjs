import {checkpointEnabled} from '../../worker/security-checkpoint.mjs';
import {session,csrf,requireForm,page,reauthenticationPage,json,redirect,cookie,ACCOUNT_COOKIE} from './accounts.mjs';
import {escape} from './appearance.mjs';
import {deletionPreview,deleteAccount} from '../../worker/account-deletion.mjs';
import {runWorkspacePurges} from '../../worker/workspace-purge.mjs';
export async function accountDeletionRoutes(request,env){
 const path=new URL(request.url).pathname;if(path!=='/account/delete')return null;
 if(!checkpointEnabled(env))return json({error:'account_deletion_requires_independent_checkpoint'},409);
 const s=await session(request,env);if(!s)return redirect('/account/passkeys');
 if(Date.now()-s.authenticated_at>300000)return reauthenticationPage('删除账户前需要最近五分钟内重新验证身份。','/account/delete');
 const preview=await deletionPreview(env,s.account_id);
 if(request.method==='POST'){
  const form=await requireForm(request,s,65536);
  if(form.get('confirm')!=='DELETE')return json({error:'explicit_confirmation_required'},400);
  const choices=preview.personal.map(w=>({id:w.id,version:Number(form.get('version:'+w.id)),action:form.get('choice:'+w.id),key:form.get('key:'+w.id)||undefined}));
  try{await deleteAccount(env,s,choices);try{await runWorkspacePurges(env,2)}catch{console.error(JSON.stringify({event:'workspace_purge_deferred'}))}return redirect('/account/passkeys',[cookie(ACCOUNT_COOKIE,'',0)])}catch(e){return json({error:e.code||'deletion_temporarily_unavailable'},e.code==='CONFLICT'?409:e.code?403:503)}
 }
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 if(preview.requires_transfer.length)return page('先交接多人工作区',`<p>删除账户前，必须先将这些多人工作区的管理者身份交给其他成员。</p><div class="group">${preview.requires_transfer.map(w=>`<div class="row">${escape(w.name)}</div>`).join('')}</div><a class="link" href="/">工作区管理 ›</a>`);
 return page('删除账户',`<p>此操作需要最近五分钟内重新验证身份。将撤销所有账户会话与 OAuth 授权、删除认证资料，并取消待审批操作。共享审计保留必要记录并去标识化。</p><p>每个单人工作区必须主动选择保留或删除。保留时需验证当前统一密钥，避免删除账户后无法恢复访问。已缓存的数据无法保证远程擦除。</p><form method="post"><input type="hidden" name="csrf" value="${await csrf(request,s)}">${preview.personal.map(w=>`<fieldset style="border:0;padding:12px 0"><legend>${escape(w.name)}</legend><input type="hidden" name="version:${w.id}" value="${w.version}"><label><input type="radio" name="choice:${w.id}" value="keep" required>保留数据，解除账户关联</label><label>保留时输入当前统一密钥<input type="password" name="key:${w.id}" autocomplete="off" maxlength="64"></label><label><input type="radio" name="choice:${w.id}" value="delete" required>永久删除工作区及数据</label></fieldset>`).join('')}<label>输入 DELETE 确认<input name="confirm" autocomplete="off" required></label><button class="danger">删除账户并执行所选操作</button><a class="link" href="/account">取消</a></form>`);
}
