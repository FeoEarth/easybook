import {runAttachmentPurges} from './attachment-purge.mjs';
import {androidAssetLinks} from './android-identity.mjs';
import {IDENTITY_ORIGIN,identityEnabled,identityPath} from './identity-origin.mjs';
import {accountConnect} from './account-connect.mjs';
import {workspaceAPI,workspacePrincipal} from './workspace-api.mjs';
import {workspaceAccess,WorkspaceError} from './workspace-identity.mjs';
import {cleanupUploads} from './mcp-uploads.mjs';
import {mcp} from './mcp.mjs';
import {mcpHealth} from './mcp-health.mjs';
import {approvalPage,approvalAPI} from './mcp-access.mjs';
import {download} from './mcp-attachments.mjs';
import {attestMcpWorkspace} from './mcp-pairing.mjs';
import {management} from './management.mjs';
import {notes} from './notes.mjs';
import html from './ui.mjs';
import pdfStatic from './pdf-static.mjs';
import editor from './editor.mjs';
import {attachments} from './attachments.mjs';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (data, status=200) => Response.json(data, {status, headers});
export default {
 async scheduled(controller,env){await cleanupUploads(env,10);await runAttachmentPurges(env,10)},
 async fetch(request, env) {
  const url = new URL(request.url);
  if(url.pathname==='/.well-known/assetlinks.json'&&identityEnabled(env)&&url.origin===IDENTITY_ORIGIN&&request.method==='GET')return Response.json(androidAssetLinks,{headers:{'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
  // Deliberately unset on production until the coordinated identity cutover.
  const identityV2=env.WORKSPACE_IDENTITY_V2==='true';
  if(identityEnabled(env)&&url.origin===IDENTITY_ORIGIN&&identityPath(url.pathname)){if(!env.IDENTITY_SERVICE)return json({error:'Identity service unavailable'},503);return env.IDENTITY_SERVICE.fetch(request);}
  if(identityV2&&url.pathname.startsWith('/api/workspaces'))return workspaceAPI(request,env);
  if(identityV2&&(url.pathname==='/mcp'||url.pathname==='/api/mcp/attest'||url.pathname==='/api/mcp/approval'))return json({error:'Use account OAuth authorization'},410);
  if(url.pathname==='/account/connect'&&request.method==='GET')return new Response(accountConnect,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"}});
  if(url.pathname==='/health/mcp'&&request.method==='GET')return mcpHealth(env);
  if(url.pathname === '/mcp') return mcp(request,env);
  if(url.pathname==='/mcp/approve'&&request.method==='GET')return new Response(approvalPage,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
  if(url.pathname==='/api/mcp/download'&&request.method==='GET'){try{return await download(request,env)}catch{return new Response('Download unavailable',{status:404})}}
  // Browser pairing uses a cross-origin authenticated POST; ordinary sync CORS only permits GET/PUT.
  const pairingOrigin=request.headers.get('Origin');
  const pairingAllowed=pairingOrigin==='https://easybook.loonxy.com'||pairingOrigin==='https://easybook-sync.1902521952.workers.dev';
  const pairingCors=pairingAllowed?{'Access-Control-Allow-Origin':pairingOrigin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}:{};
  const pairingResponse=(response)=>{const h=new Headers(response.headers);for(const [name,value] of Object.entries(pairingCors))h.set(name,value);h.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,headers:h});};
  if(url.pathname==='/api/mcp/attest'&&pairingOrigin&&!pairingAllowed)return pairingResponse(Response.json({error:'Origin not allowed'},{status:403}));
  if(url.pathname==='/api/mcp/attest'&&request.method==='OPTIONS')
   return new Response(null,{status:pairingAllowed?204:403,headers:pairingCors});
  if(request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  // Keep published UI modules aligned with the HTML; vendor data remains in existing assets.
  if(request.method==='GET'&&Object.hasOwn(pdfStatic,url.pathname))return new Response(pdfStatic[url.pathname],{headers:{'Content-Type':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
  // Compatibility-only static PDF resources; attachment/auth/sync routes are unchanged.
  if(request.method==='GET'&&(url.pathname.startsWith('/pdf/')||url.pathname==='/pdf-sw.js')){
   if(!env.PDF_ASSETS)return new Response('PDF assets unavailable',{status:503});
   const assetUrl=new URL(request.url);assetUrl.pathname=url.pathname==='/pdf-sw.js'?'/sw.js':url.pathname.slice(4);
   const response=await env.PDF_ASSETS.fetch(new Request(assetUrl,request));
   const resourceHeaders=new Headers(response.headers);resourceHeaders.set('X-Content-Type-Options','nosniff');
   if(url.pathname==='/pdf-sw.js'){resourceHeaders.set('Service-Worker-Allowed','/');resourceHeaders.set('Cache-Control','no-cache');}
   return new Response(response.body,{status:response.status,headers:resourceHeaders});
  }
  if(url.pathname === '/editor.js' && request.method === 'GET')return new Response(editor,{headers:{'Content-Type':'application/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}});
  if(url.pathname === '/health') return json({ok:true,app:'Easybook',version:'0.8.0',build:25,commit:env.RELEASE_SHA||'',schemaVersion:1});
  if(url.pathname === '/' && request.method === 'GET') return new Response(identityV2?html.replace('name="easybook-identity" content="legacy"','name="easybook-identity" content="v2"'):html,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-cache'}});
  if(!url.pathname.startsWith('/api/')) return json({error:'Not found'},404);
  const token = (request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  if(!identityV2&&!/^[a-f0-9]{64}$/.test(token)) {
   const response=json({error:'Invalid workspace key'},401);
   return url.pathname==='/api/mcp/attest'?pairingResponse(response):response;
  }
  let workspace;
  if(identityV2){
   try{
    const principal=await workspacePrincipal(request,env,{mutation:!['GET','HEAD'].includes(request.method)});
    workspace=principal.kind==='key'?principal.workspaceId:request.headers.get('X-Easybook-Workspace');
    const access=await workspaceAccess(env,workspace,principal);
    if(!access)return json({error:'Workspace access denied'},403);
    if(access.role==='reader'&&!['GET','HEAD'].includes(request.method))return json({error:'Read only workspace'},403);
   }catch(e){if(e instanceof WorkspaceError)return json({error:e.code},e.status);return json({error:'Authentication unavailable'},503);}
  }else workspace=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  try {
   if(url.pathname==='/api/mcp/attest'){
    return pairingResponse(await attestMcpWorkspace(request,env,workspace));
   }
   if(url.pathname==='/api/mcp/approval'&&request.method==='POST'){
    if(request.headers.get('Origin')!==url.origin)return json({error:'Origin not allowed'},403);
    return await approvalAPI(request,env,workspace);
   }
   if(url.pathname==='/api/management')return await management(request,env,workspace,json);
   const attachmentId=url.pathname.match(/^\/api\/attachments\/([a-f0-9]{64})$/)?.[1];if(attachmentId)return await attachments(request,env,workspace,attachmentId,headers);
   if(url.pathname==='/api/notes'||url.pathname.startsWith('/api/notes/'))return await notes(request,env,workspace,url,json);
   if(url.pathname === '/api/folders' && request.method === 'GET') {
    const after=url.searchParams.get('after')||'';
    if(after.length>80)return json({error:'Invalid cursor'},400);
    const {results}=await env.DB.prepare('SELECT id,name,updated,deleted FROM folders WHERE workspace=? AND id>? ORDER BY id LIMIT 100').bind(workspace,after).all();
    return json({folders:results,next:results.length===100?results.at(-1).id:null});
   }
   const folderId=url.pathname.match(/^\/api\/folders\/([a-f0-9-]{36})$/)?.[1];
   const id = url.pathname.match(/^\/api\/notes\/([a-f0-9-]{36})$/)?.[1];
   if((!id&&!folderId) || request.method!=='PUT') return json({error:'Not found'},404);
   const reader=request.body?.getReader(); let size=0; const chunks=[];
   if(!reader) return json({error:'Missing body'},400);
   while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>260000){await reader.cancel();return json({error:'Note too large'},413);} chunks.push(value); }
   const bytes=new Uint8Array(size); let pos=0; for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
   let n; try {n=JSON.parse(new TextDecoder().decode(bytes));} catch{return json({error:'Invalid JSON'},400);}
   if(!n||typeof n!=='object'||Array.isArray(n))return json({error:'Invalid JSON object'},400);
   if(folderId){
    if(typeof n.name!=='string'||!n.name.trim()||n.name.length>60)return json({error:'Invalid folder'},400);
    if(n.deleted!==undefined&&![0,1].includes(n.deleted)||n.updated!==undefined&&(!Number.isSafeInteger(n.updated)||n.updated<0||n.updated>Date.now()+86400000))return json({error:'Invalid folder revision'},400);
    await env.DB.prepare('INSERT INTO folders(workspace,id,name,updated,deleted) VALUES(?,?,?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET name=CASE WHEN folders.deleted=0 AND excluded.updated>folders.updated THEN excluded.name ELSE folders.name END,updated=MAX(folders.updated,excluded.updated),deleted=MAX(folders.deleted,excluded.deleted)').bind(workspace,folderId,n.name.trim(),n.updated??Date.now(),n.deleted||0).run();
    const folder=await env.DB.prepare('SELECT id,name,updated,deleted FROM folders WHERE workspace=? AND id=?').bind(workspace,folderId).first();
    return json({folder});
   }
   return json({error:'Not found'},404);
  } catch(e) { console.error(JSON.stringify({event:'request_failed',name:e.name})); const response=json({error:'Service temporarily unavailable'},503); return url.pathname==='/api/mcp/attest'?pairingResponse(response):response; }
 }
};








