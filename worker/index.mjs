import html from './ui.mjs';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (data, status=200) => Response.json(data, {status, headers});
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  if(request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if(url.pathname === '/health') return json({ok:true,app:'Easybook',version:'0.1.0'});
  if(url.pathname === '/' && request.method === 'GET') return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-cache'}});
  if(!url.pathname.startsWith('/api/')) return json({error:'Not found'},404);
  const token = (request.headers.get('Authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{64}$/.test(token)) return json({error:'Invalid workspace key'},401);
  const workspace = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  try {
   if(url.pathname === '/api/notes' && request.method === 'GET') {
    const after = url.searchParams.get('after')||'';
    if(after.length>80) return json({error:'Invalid cursor'},400);
    const {results} = await env.DB.prepare('SELECT id,title,body,icon,favorite,deleted,version,mutation,updated FROM notes WHERE workspace=? AND id>? ORDER BY id LIMIT 100').bind(workspace,after).all();
    return json({notes:results,next:results.length===100?results.at(-1).id:null});
   }
   const id = url.pathname.match(/^\/api\/notes\/([a-f0-9-]{36})$/)?.[1];
   if(!id || request.method!=='PUT') return json({error:'Not found'},404);
   const reader=request.body?.getReader(); let size=0; const chunks=[];
   if(!reader) return json({error:'Missing body'},400);
   while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>260000){await reader.cancel();return json({error:'Note too large'},413);} chunks.push(value); }
   const bytes=new Uint8Array(size); let pos=0; for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
   let n; try {n=JSON.parse(new TextDecoder().decode(bytes));} catch{return json({error:'Invalid JSON'},400);}
   if(typeof n.title!=='string'||n.title.length>200||typeof n.body!=='string'||n.body.length>60000||typeof n.icon!=='string'||n.icon.length>16||!Number.isSafeInteger(n.version)||n.version<0||!/^[-a-f0-9]{36}$/.test(n.mutation)||![0,1].includes(n.favorite)||![0,1].includes(n.deleted))return json({error:'Invalid note'},400);
   const updated=Date.now();
   const result=await env.DB.prepare(`INSERT INTO notes (workspace,id,title,body,icon,favorite,deleted,version,mutation,updated) SELECT ?,?,?,?,?,?,?,1,?,? WHERE ?=0 ON CONFLICT(workspace,id) DO UPDATE SET title=excluded.title,body=excluded.body,icon=excluded.icon,favorite=excluded.favorite,deleted=excluded.deleted,version=notes.version+1,mutation=excluded.mutation,updated=excluded.updated WHERE notes.version=?`)
    .bind(workspace,id,n.title,n.body,n.icon,n.favorite,n.deleted,n.mutation,updated,n.version,n.version).run();
   // Existing rows need UPDATE: INSERT SELECT is intentionally empty when expected version > 0.
   let changed=result.meta.changes;
   if(n.version>0){ const r=await env.DB.prepare('UPDATE notes SET title=?,body=?,icon=?,favorite=?,deleted=?,version=version+1,mutation=?,updated=? WHERE workspace=? AND id=? AND version=?').bind(n.title,n.body,n.icon,n.favorite,n.deleted,n.mutation,updated,workspace,id,n.version).run(); changed=r.meta.changes; }
   const current=await env.DB.prepare('SELECT id,title,body,icon,favorite,deleted,version,mutation,updated FROM notes WHERE workspace=? AND id=?').bind(workspace,id).first();
   if(!changed && current?.mutation!==n.mutation) return json({error:'Conflict',note:current},409);
   return json({note:current});
  } catch(e) { console.error(JSON.stringify({event:'request_failed',name:e.name})); return json({error:'Service temporarily unavailable'},503); }
 }
};
