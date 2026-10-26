// Sessionless Streamable HTTP bridge. Legacy aliases and tokens remain read-only.
import {registry,aliases,publicTool} from './mcp-registry.mjs';
import {READ,fail,boundedJSON,hash,object} from './mcp-common.mjs';
import {callTool} from './mcp-services.mjs';
import {listResources,resourceTemplates,readResource} from './mcp-resources.mjs';
import {listPrompts,getPrompt} from './mcp-prompts.mjs';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const result=(id,value)=>Response.json({jsonrpc:'2.0',id,result:value},{headers:H});
const error=(id,code,message,data)=>Response.json({jsonrpc:'2.0',id,error:{code,message,...(data?{data}:{})}},{headers:H});
const equal=(a,b)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const textResult=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
export async function mcp(request,env,workspaceId=null,access={}){
 if(request.method!=='POST')return new Response('MCP sessionless endpoint: POST JSON-RPC',{status:405,headers:{Allow:'POST'}});
 if(request.headers.get('Origin'))return new Response('Origin not allowed',{status:403});
 if(!env.MCP_ACCESS_TOKEN||workspaceId===null&&(!env.MCP_WORKSPACE_KEY||!/^[a-f0-9]{64}$/.test(env.MCP_WORKSPACE_KEY)))return new Response('MCP not configured',{status:503});
 if(workspaceId!==null&&!/^[a-f0-9]{64}$/.test(workspaceId))return new Response('Invalid workspace grant',{status:403});
 const auth=request.headers.get('Authorization')||'';if(!auth.startsWith('Bearer ')||!equal(auth.slice(7),env.MCP_ACCESS_TOKEN))return new Response('Unauthorized',{status:401,headers:{'WWW-Authenticate':'Bearer realm="Easybook MCP"'}});
 let msg;try{msg=await boundedJSON(request)}catch(e){return error(null,e.code==='PARSE_ERROR'?-32700:-32600,e.message)}
 if(!object(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string'||msg.id!==undefined&&msg.id!==null&&!['number','string'].includes(typeof msg.id))return error(null,-32600,'Invalid Request');
 if(msg.id===undefined)return new Response(null,{status:202});
 const id=msg.id,params=msg.params||{};
 if(!object(params))return error(id,-32602,'Invalid params');
 try{
  if(msg.method==='initialize')return result(id,{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false},prompts:{listChanged:false}},serverInfo:{name:'easybook-mcp',version:'0.8.0'}});
  if(msg.method==='ping')return result(id,{});
  if(params.cursor!==undefined&&['tools/list','resources/list','resources/templates/list','prompts/list'].includes(msg.method))fail('INVALID_ARGUMENT','Catalog is a single page; cursor is invalid');
  if(msg.method==='tools/list')return result(id,{tools:[...registry.filter(t=>!t.modernOnly||env.WORKSPACE_IDENTITY_V2==='true').map(publicTool),...Object.entries(aliases).map(([name,target])=>({...publicTool(registry.find(t=>t.name===target)),name,description:'Legacy compatible alias: '+target}))]});
  if(msg.method==='resources/list')return result(id,{resources:listResources()});
  if(msg.method==='resources/templates/list')return result(id,{resourceTemplates});
  if(msg.method==='prompts/list')return result(id,{prompts:listPrompts()});
  if(msg.method==='prompts/get')return result(id,getPrompt(params.name,params.arguments));
  const ctx={env,workspace:workspaceId??await hash(env.MCP_WORKSPACE_KEY),client:access.client||null,scopes:access.scopes||READ,uploadOrigin:access.uploadOrigin};
  if(msg.method==='resources/read')return limited(id,await readResource(ctx,params.uri,callTool));
  if(msg.method==='tools/call'){
   const original=params.name,name=Object.hasOwn(aliases,original)?aliases[original]:original;
   if(registry.find(t=>t.name===name)?.modernOnly&&env.WORKSPACE_IDENTITY_V2!=='true')return error(id,-32602,'Unknown tool');
   if(!registry.some(t=>t.name===name))return error(id,-32602,'Unknown tool');
   try{let value=await callTool(ctx,name,params.arguments||{});
    // Preserve old get_note/search/list wrapper shapes.
    if(original==='get_note')value={note:value};
    return limited(id,textResult(value));
   }catch(e){if(!e.code)console.error(JSON.stringify({event:'mcp_error',name:e.name}));return result(id,{isError:true,...textResult({error:{code:e.code||'INTERNAL',message:e.code?e.message:'Internal error',...(e.data?{data:e.data}:{})}})});}
  }
  return error(id,-32601,'Method not found');
 }catch(e){if(!e.code)console.error(JSON.stringify({event:'mcp_error',name:e.name}));return error(id,e.code==='NOT_FOUND'?-32002:e.code==='PERMISSION_DENIED'?-32001:e.code?-32602:-32603,e.code?e.message:'Internal error');}
}
function limited(id,value){if(new TextEncoder().encode(JSON.stringify(value)).length>220000)fail('RESOURCE_TOO_LARGE','Result exceeds limit; use smaller pages or text segments');return result(id,value)}

