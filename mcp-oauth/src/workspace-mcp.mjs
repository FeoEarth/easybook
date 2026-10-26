import {boundedJSON,object,validate,schema,str} from '../../worker/mcp-common.mjs';
import {workspacePolicy,selectPolicyWorkspace} from '../../worker/oauth-workspace-policy.mjs';
import {createWorkspace,renameWorkspace} from '../../worker/workspace-identity.mjs';
import {grantClient} from '../../worker/account-grants.mjs';
import {mcp} from '../../worker/mcp.mjs';
const workspaceId={type:'string',pattern:'^[a-f0-9]{64}$'};
const tools=[
 {name:'list_authorized_workspaces',description:'列出本次 OAuth 授权仍允许访问的工作区',inputSchema:schema()},
 {name:'select_authorized_workspace',description:'切换到本次授权中明确选择的工作区',inputSchema:schema({workspaceId},['workspaceId'])},
 {name:'workspace_access_status',description:'检查当前工作区及有效操作范围',inputSchema:schema()},
 {name:'revoke_workspace_access',description:'撤销本次授权对指定工作区的访问',inputSchema:schema({workspace_id:workspaceId})},
 {name:'workspaces_create',description:'创建账户关联的单人工作区；不返回同步密钥，也不会自动获得新工作区内容授权',inputSchema:schema({name:str(60,1)},['name'])},
 {name:'workspaces_rename',description:'重命名当前授权工作区；需要管理者角色及 workspace.write',inputSchema:schema({name:str(60,1),workspace_id:workspaceId},['name'])}
];
const catalogs=new Set(['initialize','ping','tools/list','resources/list','resources/templates/list','prompts/list','prompts/get']);
export async function workspaceMcp(request,env,ctx){
 if(!ctx?.props?.accountId||typeof ctx?.auth?.clientId!=='string'||!ctx.auth.clientId)return new Response('Account OAuth authorization required',{status:403});
 const policy=await workspacePolicy(env,ctx.props.policyId,{accountId:ctx.props.accountId,clientId:ctx.auth?.clientId,tokenScopes:ctx.auth?.scope||[]});
 if(!policy)return new Response('Authorization revoked',{status:403});
 let msg;try{msg=await boundedJSON(request)}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid or oversized request'}})}
 if(!object(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||msg.id!==undefined&&msg.id!==null&&!['string','number'].includes(typeof msg.id))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
 if(msg.id===undefined)return new Response(null,{status:202});
 const reply=value=>Response.json({jsonrpc:'2.0',id:msg.id,result:value},{headers:{'Cache-Control':'no-store'}}),text=value=>reply({content:[{type:'text',text:JSON.stringify(value)}]}),error=code=>msg.method==='tools/call'?reply({isError:true,content:[{type:'text',text:JSON.stringify({error:{code}})}]}):Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32001,message:code}},{headers:{'Cache-Control':'no-store'}});
 const control=msg.method==='tools/call'?tools.find(t=>t.name===msg.params?.name):null;
 let originalUri=null,resourceWorkspace;
 if(msg.method==='resources/read'&&typeof msg.params?.uri==='string'){try{const uri=new URL(msg.params.uri),ids=uri.searchParams.getAll('workspace_id');if(ids.length>1)return error('INVALID_WORKSPACE_SELECTOR');if(ids.length){resourceWorkspace=ids[0];originalUri=msg.params.uri;uri.searchParams.delete('workspace_id');msg.params.uri=uri.href}}catch{/* The core resource handler reports malformed URIs. */}}
 const metadataWorkspace=msg.params?._meta?.workspace_id;
 if(resourceWorkspace!==undefined&&metadataWorkspace!==undefined&&resourceWorkspace!==metadataWorkspace)return error('WORKSPACE_SELECTOR_MISMATCH');
 const explicit=msg.method==='tools/call'?msg.params?.arguments?.workspace_id:resourceWorkspace??metadataWorkspace;
 if(explicit!==undefined&&(typeof explicit!=='string'||!/^[a-f0-9]{64}$/.test(explicit)||!policy.workspaces.some(w=>w.id===explicit)))return error('WORKSPACE_NOT_AUTHORIZED');
 const selected=explicit?policy.workspaces.find(w=>w.id===explicit):policy.selected;
 if(control){
  try{validate(control.inputSchema,msg.params.arguments||{})}catch{return Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'Invalid tool arguments'}})}
  const a=msg.params.arguments||{};
  if(control.name==='list_authorized_workspaces')return text({workspaces:policy.workspaces.map(w=>({...w,active:w.id===policy.selected?.id}))});
  if(control.name==='workspace_access_status')return text({authorized:true,selected:policy.selected?.id||null,scopes:policy.selected?.scopes||[],global_scopes:policy.globalScopes});
  if(control.name==='select_authorized_workspace')return await selectPolicyWorkspace(env,policy,a.workspaceId)?text({selected:true,workspace_id:a.workspaceId}):error('WORKSPACE_NOT_AUTHORIZED');
  if(control.name==='revoke_workspace_access'){
   if(!explicit&&policy.workspaces.length>1)return error('WORKSPACE_REQUIRED');
   if(!selected)return error('NO_WORKSPACE_SELECTED');
   await env.DB.prepare('UPDATE oauth_grant_workspaces SET revoked_at=? WHERE policy_id=? AND workspace_id=? AND revoked_at IS NULL').bind(Date.now(),policy.id,selected.id).run();return text({revoked:true});
  }
  if(control.name==='workspaces_create'){
   if(!policy.globalScopes.includes('workspace.create'))return error('PERMISSION_DENIED');
   const now=Date.now(),budget=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind('ai-workspace-create:'+policy.account_id+':'+Math.floor(now/60000),now+120000).first();
   if(budget.count>5)return error('RATE_LIMITED');
   try{const created=await createWorkspace(env,a.name,{kind:'oauth',accountId:policy.account_id,scopes:policy.globalScopes});return text({workspace:{id:created.workspace.id,name:created.workspace.name,mode:created.workspace.mode},requires_new_workspace_authorization:true})}catch(e){return error(e.code||'OPERATION_FAILED')}
  }
  if(control.name==='workspaces_rename'){
   if(!explicit&&policy.workspaces.length>1)return error('WORKSPACE_REQUIRED');
   if(!selected||!selected.scopes.includes('workspace.write')||selected.role!=='manager')return error('PERMISSION_DENIED');
   try{const updated=await renameWorkspace(env,selected.id,{kind:'oauth',accountId:policy.account_id,scopes:selected.scopes},a.name);return text({workspace:{id:updated.id,name:updated.name,mode:updated.mode}})}catch(e){return error(e.code||'OPERATION_FAILED')}
  }
 }
 if(!catalogs.has(msg.method)&&!explicit&&policy.workspaces.length>1)return error('WORKSPACE_REQUIRED');
 if(!selected&&!catalogs.has(msg.method))return error('WORKSPACE_SELECTION_REQUIRED');
 if(msg.method==='tools/call'&&object(msg.params?.arguments)){const {workspace_id,...args}=msg.params.arguments;msg.params.arguments=args;}
 const headers=new Headers(request.headers);headers.delete('Origin');headers.set('Authorization','Bearer internal-oauth-bridge');
 const response=await mcp(new Request(request,{headers,body:JSON.stringify(msg)}),{...env,MCP_ACCESS_TOKEN:'internal-oauth-bridge'},selected?.id||'0'.repeat(64),{client:grantClient(policy.id),scopes:selected?.scopes||[],uploadOrigin:'https://easybook.loonxy.com'});
 if(msg.method==='tools/list'&&response.ok){const value=await response.json();if(value.result?.tools){value.result.tools=value.result.tools.filter(t=>t.name!=='access_request_permissions');value.result.tools=value.result.tools.map(t=>({...t,description:t.description+'；内容操作可显式指定已授权 workspace_id',inputSchema:{...t.inputSchema,properties:{...t.inputSchema.properties,workspace_id:workspaceId},required:[...new Set([...(t.inputSchema.required||[]),...(policy.workspaces.length>1?['workspace_id']:[])])]}}));value.result.tools.push(...tools.map(t=>['workspaces_rename','revoke_workspace_access'].includes(t.name)?{...t,inputSchema:{...t.inputSchema,required:[...t.inputSchema.required,...(policy.workspaces.length>1?['workspace_id']:[])]}}:t))}return Response.json(value,{headers:{'Cache-Control':'no-store'}})}
 if(['resources/list','resources/templates/list','resources/read'].includes(msg.method)&&response.ok){const value=await response.json();if(value.result?.resources)value.result.resources=value.result.resources.flatMap(r=>policy.workspaces.map(w=>({...r,uri:r.uri+'?workspace_id='+w.id,name:w.name+' · '+r.name})));if(value.result?.resourceTemplates)value.result.resourceTemplates=value.result.resourceTemplates.map(r=>({...r,uriTemplate:r.uriTemplate+'?workspace_id={workspace_id}'}));if(originalUri&&value.result?.contents)value.result.contents=value.result.contents.map(c=>({...c,uri:originalUri}));return Response.json(value,{headers:{'Cache-Control':'no-store'}})}
 return response;
}
