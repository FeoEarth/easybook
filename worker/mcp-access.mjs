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
export const approvalPage=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Easybook MCP 授权确认</title><style>body{font:17px system-ui;max-width:680px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f2f7;padding:20px;border-radius:12px}button{font:inherit;padding:14px;margin:8px}p{line-height:1.6}</style><h1>MCP 授权确认</h1><p>仅在你主动请求这些权限或操作时批准。请检查客户端和下方完整参数；批准权限将替换该客户端原有写入权限。操作确认仅能使用一次。</p><pre id="detail">加载中…</pre><button id="allow" disabled>批准上述权限或操作</button><button onclick="location.href='/'">取消并返回</button><script>
const id=location.hash.slice(1),key=localStorage.getItem('easybook-key');history.replaceState(null,'','/mcp/approve');
async function call(approve){const r=await fetch('/api/mcp/approval',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({id,...(approve?{approve:true}:{})})});const d=await r.json();if(!r.ok)throw Error(d.error||'请求失败');return d}
if(!key)document.getElementById('detail').textContent='请先在当前浏览器连接 Easybook Web 工作区，再重新打开确认链接。不要把工作区密钥发送给 AI。';
else call(false).then(d=>{document.getElementById('detail').textContent=JSON.stringify(d,null,2);document.getElementById('allow').disabled=false}).catch(e=>document.getElementById('detail').textContent=e.message);
document.getElementById('allow').onclick=async()=>{document.getElementById('allow').disabled=true;try{await call(true);document.getElementById('detail').textContent='已批准。请返回 AI 客户端继续。'}catch(e){document.getElementById('detail').textContent=e.message}};
</script></html>`;
