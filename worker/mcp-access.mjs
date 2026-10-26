import {READ,WRITE,fail,hash,canonical,boundedJSON,validate,schema,uuid} from './mcp-common.mjs';
export async function requestApproval(ctx,kind,payload){
 if(!ctx.client)fail('PERMISSION_DENIED','Owner approval requires a paired OAuth client');
 const pending=await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_approvals WHERE workspace=? AND client=? AND expires>? AND consumed=0').bind(ctx.workspace,ctx.client,Date.now()).first();
 if(pending.n>=10)fail('RATE_LIMITED','Too many pending approvals');
 await ctx.env.DB.prepare('DELETE FROM mcp_approvals WHERE id IN (SELECT id FROM mcp_approvals WHERE expires<? LIMIT 100)').bind(Date.now()).run();
 const id=crypto.randomUUID(),expires=Date.now()+600000;
 await ctx.env.DB.prepare('INSERT INTO mcp_approvals(id,workspace,client,kind,payload,payload_hash,expires) VALUES(?,?,?,?,?,?,?)').bind(id,ctx.workspace,ctx.client,kind,JSON.stringify(payload),await hash(canonical(payload)),expires).run();
 return {approval_id:id,expires_at:expires,approval_url:'https://easybook.loonxy.com/mcp/approve#'+id,instructions:'用户须在已连接该工作区的 Easybook Web 中检查具体权限或操作并点击批准。AI 不得代替用户批准，不要向 AI 提供工作区密钥。'};
}
export async function consumeApproval(ctx,name,args){
 const {confirmation_id,...payload}=args;
 const r=await ctx.env.DB.prepare("UPDATE mcp_approvals SET consumed=1 WHERE id=? AND workspace=? AND client=? AND kind='operation' AND approved=1 AND consumed=0 AND expires>? AND payload_hash=? RETURNING id").bind(confirmation_id,ctx.workspace,ctx.client,Date.now(),await hash(canonical({tool:name,arguments:payload}))).all();
 if(!r.results.length)fail('CONFIRMATION_REQUIRED','Missing, expired, mismatched or consumed owner confirmation');
}
export async function permissions(env,workspace,client){
 if(!client)return READ;
 const row=await env.DB.prepare('SELECT scopes FROM mcp_client_permissions WHERE workspace=? AND client=?').bind(workspace,client).first();
 return [...READ,...(row?JSON.parse(row.scopes).filter(s=>WRITE.includes(s)):[])];
}
export async function approvalAPI(request,env,workspace){
 const input=await boundedJSON(request,2048);validate(schema({id:uuid,approve:{type:'boolean'}},['id']),input);
 const row=await env.DB.prepare('SELECT id,client,kind,payload,expires,approved,consumed FROM mcp_approvals WHERE id=? AND workspace=? AND expires>? AND consumed=0').bind(input.id,workspace,Date.now()).first();
 if(!row)return Response.json({error:'Approval unavailable'},{status:404});
 const grant=await env.DB.prepare('SELECT id FROM mcp_workspace_grants WHERE workspace_id=? AND oauth_client_id=? AND revoked_at IS NULL').bind(workspace,row.client).first();
 if(!grant)return Response.json({error:'Client grant revoked'},{status:403});
 if(input.approve===true){
  if(row.kind==='permissions'){
   const scopes=JSON.parse(row.payload).scopes;
   if(!Array.isArray(scopes)||scopes.some(s=>!WRITE.includes(s)))fail('INVALID_ARGUMENT','Invalid scopes');
   await env.DB.batch([
    env.DB.prepare("INSERT INTO mcp_client_permissions(workspace,client,scopes,updated) SELECT workspace,client,?,? FROM mcp_approvals WHERE id=? AND workspace=? AND consumed=0 AND expires>? ON CONFLICT(workspace,client) DO UPDATE SET scopes=excluded.scopes,updated=excluded.updated").bind(JSON.stringify(scopes),Date.now(),row.id,workspace,Date.now()),
    env.DB.prepare('UPDATE mcp_approvals SET approved=1,consumed=1 WHERE id=? AND workspace=? AND consumed=0').bind(row.id,workspace)
   ]);
  }else await env.DB.prepare('UPDATE mcp_approvals SET approved=1 WHERE id=? AND workspace=? AND expires>? AND consumed=0').bind(row.id,workspace,Date.now()).run();
  return Response.json({approved:true},{headers:{'Cache-Control':'no-store'}});
 }
 return Response.json({...row,payload:JSON.parse(row.payload)},{headers:{'Cache-Control':'no-store'}});
}
export const approvalPage=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>Easybook · MCP 授权确认</title><style>
:root{--ink:#1c1c1e;--muted:#8e8e93;--accent:#b88a00;--bg:#f2f2f7;--paper:#fff;--line:#e5e5ea;--control-fill:rgba(118,118,128,.12);--on-accent:#241c00;--danger:#ff3b30;--radius-control:22px;--radius-group:20px;--touch:44px;--row:56px;--nav-height:64px}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--ink:#f2f2f7;--muted:#98989f;--accent:#e6bb32;--bg:#000;--paper:#1c1c1e;--line:#38383a;--control-fill:rgba(118,118,128,.24)}}
:root[data-theme=dark]{--ink:#f2f2f7;--muted:#98989f;--accent:#e6bb32;--bg:#000;--paper:#1c1c1e;--line:#38383a;--control-fill:rgba(118,118,128,.24)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}body{margin:0;background:var(--bg);color:var(--ink);font:17px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere}button,a{font:inherit;color:inherit;min-height:44px;border:0;border-radius:var(--radius-control);padding:10px 16px;cursor:pointer;transition:opacity .14s,background .14s}button:active,a:active{opacity:.65}button:disabled{opacity:.35;cursor:default}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}[hidden]{display:none!important}
nav{position:sticky;top:0;z-index:2;min-height:calc(var(--nav-height) + env(safe-area-inset-top));padding:calc(8px + env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 8px max(12px,env(safe-area-inset-left));background:var(--bg);display:flex;align-items:center}nav a{display:inline-flex;align-items:center;gap:2px;color:var(--accent);text-decoration:none;white-space:nowrap;padding-left:0}nav svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.75}
main{max-width:680px;margin:auto;padding:0 max(20px,env(safe-area-inset-right)) max(30px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}h1{font-size:clamp(26px,8vw,34px);font-weight:720;letter-spacing:-1px;line-height:1.2;margin:4px 0 24px}.settings-label{font-size:13px;color:var(--muted);padding-left:16px;margin:24px 0 7px}.settings-group{background:var(--paper);border-radius:var(--radius-group);padding:0 16px;margin-bottom:22px}.settings-row{display:flex;gap:16px;align-items:baseline;min-height:var(--row);padding:16px 0;border-bottom:1px solid var(--line);font-size:15px}.settings-row:last-child{border:0}.settings-row span{flex-shrink:0;color:var(--muted)}.settings-row strong{min-width:0;margin-left:auto;text-align:right;font-weight:450;overflow-wrap:anywhere}p{font-size:13px;line-height:1.65;color:var(--muted)}.note{padding:0 16px}.detail-group{padding:16px}pre{margin:0;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink);max-height:50dvh;overflow:auto}#feedback{min-height:3.3em;margin:14px 0}#feedback[data-state=error]{color:var(--danger)}.actions{display:flex;flex-wrap:wrap;gap:12px;padding:0 0 8px}.actions>*{flex:1 1 220px;text-align:center;text-decoration:none}.primary{background:var(--accent);color:var(--on-accent);font-weight:600}.secondary{background:var(--control-fill);color:var(--accent)}@media(prefers-reduced-motion:reduce){*{transition:none}}
</style><body><nav aria-label="授权页面导航"><a href="/"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg><span>Easybook</span></a></nav><main><h1>MCP 授权确认</h1><p class="note">仅在你主动请求这些权限或操作时批准。请检查客户端和下方完整参数；批准权限将替换该客户端原有写入权限。操作确认仅能使用一次。</p>
<div class="settings-label">请求信息</div><div class="settings-group"><div class="settings-row"><span>客户端</span><strong id="client">等待加载</strong></div><div class="settings-row"><span>请求类型</span><strong id="kind">等待加载</strong></div><div class="settings-row"><span>有效期至</span><strong id="expires">等待加载</strong></div></div>
<div class="settings-label">完整请求参数</div><div class="settings-group detail-group"><pre id="detail" tabindex="0">加载中…</pre></div><p id="feedback" role="status" aria-live="polite">正在读取授权请求…</p><div class="actions"><button id="allow" class="primary" disabled>批准上述权限或操作</button><a class="secondary" href="/">取消并返回</a></div></main><script>
const theme=localStorage.getItem('easybook-theme');if(['light','dark','auto'].includes(theme))document.documentElement.dataset.theme=theme;
const id=location.hash.slice(1),key=localStorage.getItem('easybook-key');history.replaceState(null,'','/mcp/approve');
const detail=document.getElementById('detail'),allow=document.getElementById('allow'),feedback=document.getElementById('feedback');
function status(state,text){feedback.dataset.state=state;feedback.textContent=text}
async function call(approve){const r=await fetch('/api/mcp/approval',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({id,...(approve?{approve:true}:{})})});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d}
if(!key){detail.textContent='尚未连接工作区';status('error','请先在当前浏览器连接 Easybook Web 工作区，再重新打开确认链接。不要把工作区密钥发送给 AI。')}
else if(!id){detail.textContent='未提供授权请求';status('error','请从 AI 客户端打开完整的授权确认链接。')}
else call(false).then(d=>{detail.textContent=JSON.stringify(d,null,2);document.getElementById('client').textContent=d.client;document.getElementById('kind').textContent=d.kind==='permissions'?'权限授权':d.kind==='operation'?'单次操作确认':d.kind;document.getElementById('expires').textContent=new Date(d.expires).toLocaleString();if(d.approved){status('success','此请求已批准，请返回 AI 客户端继续。')}else{allow.disabled=false;status('ready','请核对完整请求后再批准。')}}).catch(e=>{detail.textContent='无法加载授权请求';status('error',e.message+'。请确认工作区或获取新的授权链接。')});
allow.onclick=async()=>{allow.disabled=true;allow.textContent='正在批准…';allow.setAttribute('aria-busy','true');status('loading','正在提交授权…');try{await call(true);allow.textContent='已批准';status('success','已批准。请返回 AI 客户端继续。')}catch(e){allow.textContent='授权未完成';status('error',e.message+'。请重新打开确认链接核实状态。')}finally{allow.setAttribute('aria-busy','false')}};
</script></body></html>`;
