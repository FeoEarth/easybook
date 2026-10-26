import {registry} from './mcp-registry.mjs';
import {validate,need,fail,WRITE,McpError} from './mcp-common.mjs';
import {requestApproval,consumeApproval} from './mcp-access.mjs';
import {noteTool,get,revision,save} from './mcp-notes.mjs';
import {folderTool} from './mcp-folders.mjs';
import {taskTool} from './mcp-tasks.mjs';
import {attachmentTool} from './mcp-attachments.mjs';
import {workspaceTool} from './mcp-workspace.mjs';
export async function callTool(ctx,name,a){
 const t=registry.find(t=>t.name===name);if(!t)fail('INVALID_ARGUMENT','Unknown tool');validate(t.inputSchema,a);need(ctx,t.scope);
 if(name==='access_request_permissions'){if(a.scopes.some(s=>!WRITE.includes(s)))fail('INVALID_ARGUMENT','Invalid scopes');return requestApproval(ctx,'permissions',{scopes:[...new Set(a.scopes)]});}
 if(name==='operations_request_confirmation'){
  const target=registry.find(t=>t.name===a.tool&&t.risk);if(!target)fail('INVALID_ARGUMENT','Tool does not accept confirmation');need(ctx,target.scope);
  if(Object.hasOwn(a.arguments,'confirmation_id'))fail('INVALID_ARGUMENT','Do not include confirmation_id in preview');
  const properties={...target.inputSchema.properties};delete properties.confirmation_id;validate({...target.inputSchema,properties,required:target.inputSchema.required.filter(k=>k!=='confirmation_id')},a.arguments);
  return requestApproval(ctx,'operation',{tool:a.tool,arguments:a.arguments});
 }
 if(t.risk)await consumeApproval(ctx,name,a);
 let value;
 try{
  if(name.startsWith('notes_batch_')&&name!=='notes_batch_get'){
   const results=[];for(const item of a.items){try{const n=await get(ctx,item.id);revision(n,item.version);if(name==='notes_batch_delete')n.deleted=1;else if(name==='notes_batch_move')n.folder_id=a.folder_id;else for(const [k,v]of Object.entries(a.metadata))n[k]=typeof v==='boolean'?+v:v;results.push({id:item.id,ok:true,note:await save(ctx,n)})}catch(e){results.push({id:item.id,ok:false,error:e.code||'INTERNAL',message:e.code?e.message:'Operation failed'})}}value={results,atomic:false};
  }else if(name.startsWith('notes_'))value=await noteTool(ctx,name,a);
  else if(name.startsWith('folders_'))value=await folderTool(ctx,name,a);
  else if(name.startsWith('tasks_'))value=await taskTool(ctx,name,a);
  else if(name.startsWith('attachments_'))value=await attachmentTool(ctx,name,a);
  else value=await workspaceTool(ctx,name,a);
  if(!t.annotations.readOnlyHint)await audit(ctx,name,'ok');
  return value;
 }catch(e){if(e.message==='Invalid document schema v1')e=new McpError('INVALID_DOCUMENT','Document does not match shared schema v1');if(!t.annotations.readOnlyHint)await audit(ctx,name,e.code||'error');throw e}
}
async function audit(ctx,tool,status){try{await ctx.env.DB.prepare('INSERT INTO mcp_audit(id,workspace,client,tool,status,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),ctx.workspace,ctx.client||'legacy',tool,status,Date.now()).run();}catch{console.error(JSON.stringify({event:'mcp_audit_unavailable',tool}))}}
