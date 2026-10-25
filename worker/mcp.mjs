// Easybook MCP read-only bridge. Explicit opt-in via two Worker secrets.
// Streamable HTTP JSON responses; no SSE sessions or write tools.
const H = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const tools = [
 {name:'list_folders',description:'List non-deleted Easybook folders',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'search_notes',description:'Search active Easybook notes by title or document text',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:120},limit:{type:'integer',minimum:1,maximum:30}},required:['query'],additionalProperties:false}},
 {name:'get_note',description:'Read an Easybook note by UUID',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}}
];
const result = (id,value) => Response.json({jsonrpc:'2.0',id,result:value},{headers:H});
const error = (id,code,message,status=200) => Response.json({jsonrpc:'2.0',id,error:{code,message}},{status,headers:H});
const digest = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const equal = (a,b) => {if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0};
const textResult = data => ({content:[{type:'text',text:JSON.stringify(data)}]});
export async function mcp(request,env,workspaceId=null) {
 if(request.method==='GET')return new Response('MCP sessionless endpoint: POST JSON-RPC', {status:405,headers:{Allow:'POST'}});
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 // Intentionally do not enable cross-origin browser requests or reuse the sync bearer key.
 const origin=request.headers.get('Origin');if(origin)return new Response('Origin not allowed',{status:403});
 if(!env.MCP_ACCESS_TOKEN || (workspaceId===null && (!env.MCP_WORKSPACE_KEY || !/^[a-f0-9]{64}$/.test(env.MCP_WORKSPACE_KEY))))return new Response('MCP not configured',{status:503});
 if(workspaceId!==null && !/^[a-f0-9]{64}$/.test(workspaceId))return new Response('Invalid workspace grant',{status:403});
 const auth=request.headers.get('Authorization')||'';
 if(!auth.startsWith('Bearer ')||!equal(auth.slice(7),env.MCP_ACCESS_TOKEN))return new Response('Unauthorized',{status:401,headers:{'WWW-Authenticate':'Bearer realm="Easybook MCP"'}});
 if(Number(request.headers.get('Content-Length')||0)>16384)return new Response('Payload too large',{status:413});
 let raw;try{raw=await request.text();if(raw.length>16384)return new Response('Payload too large',{status:413});}catch{return new Response('Invalid body',{status:400})}
 let msg;try{msg=JSON.parse(raw)}catch{return error(null,-32700,'Parse error',400)}
 if(!msg||Array.isArray(msg)||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return error(msg?.id??null,-32600,'Invalid Request',400);
 if(msg.method==='notifications/initialized')return new Response(null,{status:202});
 const id=msg.id??null;
 if(msg.method==='initialize')return result(id,{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'easybook-mcp',version:'0.1.0'}});
 if(msg.method==='ping')return result(id,{});
 if(msg.method==='tools/list')return result(id,{tools});
 if(msg.method!=='tools/call')return error(id,-32601,'Method not found');
 const name=msg.params?.name,args=msg.params?.arguments||{};
 if(!tools.some(t=>t.name===name)||!args||typeof args!=='object'||Array.isArray(args))return error(id,-32602,'Invalid tool');
 const workspace=workspaceId===null?await digest(env.MCP_WORKSPACE_KEY):workspaceId;
 try {
  if(name==='list_folders'){
   const {results}=await env.DB.prepare('SELECT id,name,updated FROM folders WHERE workspace=? AND deleted=0 ORDER BY name,id LIMIT 500').bind(workspace).all();
   return result(id,textResult({folders:results}));
  }
  if(name==='get_note'){
   if(!UUID.test(args.id||''))return error(id,-32602,'Invalid note id');
   const note=await env.DB.prepare('SELECT id,title,document,icon,pinned,favorite,updated,folder_id FROM notes_json WHERE workspace=? AND id=? AND deleted=0 AND purged=0').bind(workspace,args.id).first();
   return result(id,textResult({note:note?{...note,document:JSON.parse(note.document)}:null}));
  }
  if(name==='search_notes'){
   if(typeof args.query!=='string'||!args.query.trim()||args.query.length>120||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>30))return error(id,-32602,'Invalid search arguments');
   const q='%'+args.query.trim().replace(/[\\%_]/g,c=>'\\'+c)+'%';
   const {results}=await env.DB.prepare("SELECT id,title,updated,folder_id FROM notes_json WHERE workspace=? AND deleted=0 AND purged=0 AND (title LIKE ? ESCAPE '\\' OR document LIKE ? ESCAPE '\\') ORDER BY updated DESC LIMIT ?").bind(workspace,q,q,args.limit||20).all();
   return result(id,textResult({notes:results}));
  }
 }catch(e){console.error('mcp_error',e?.name);return error(id,-32603,'Internal error')}
 return error(id,-32602,'Invalid tool');
}
