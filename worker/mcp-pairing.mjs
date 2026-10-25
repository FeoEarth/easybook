// Server-verifiable, short-lived workspace ownership proof for MCP pairing.
// Called only after the sync Worker has authenticated the workspace bearer key.
const hex=/^[a-f0-9]{64}$/;
const challengePattern=/^[A-Za-z0-9_-]{24,128}$/;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function attestMcpWorkspace(request,env,workspace){
 if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
 if(!hex.test(workspace)||typeof env.MCP_PAIRING_SIGNING_KEY!=='string'||env.MCP_PAIRING_SIGNING_KEY.length<32)
  return Response.json({error:'Pairing unavailable'},{status:503});
 let body;
 try{
  if(Number(request.headers.get('Content-Length')||0)>1024)return Response.json({error:'Too large'},{status:413});
  const raw=await request.text();
  if(raw.length>1024)throw Error('Too large');
  body=JSON.parse(raw);
 }catch{return Response.json({error:'Invalid request'},{status:400})}
 if(!challengePattern.test(body?.challenge||''))return Response.json({error:'Invalid challenge'},{status:400});
 const issuedAt=Math.floor(Date.now()/1000);
 const payload={v:1,workspace,challenge:body.challenge,iat:issuedAt,exp:issuedAt+120};
 const message=encode(new TextEncoder().encode(JSON.stringify(payload)));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MCP_PAIRING_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))));
 return Response.json({assertion:message+'.'+signature,expiresAt:payload.exp},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
