// Temporary public-only OAuth discovery diagnostic. No keys, cookies or authorization.
// Print only protocol metadata fields; never include tokens or response bodies.
const base='https://mcp.parallel.ai';
const valid=url=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='parallel.ai'||u.hostname.endsWith('.parallel.ai'))&&!u.username&&!u.password}catch{return false}};
const read=async(url,probe=false)=>{
 if(!valid(url)){console.log('SKIP non-Parallel metadata URL');return null}
 try{
  const opts={redirect:'manual',signal:AbortSignal.timeout(9000)};
  if(probe){opts.method='POST';opts.headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
   opts.body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Easybook-Auth-Probe',version:'1'}}})}
  const res=await fetch(url,opts),auth=res.headers.get('www-authenticate')||'';
  const hint=auth.match(/\bresource_metadata\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s,]+))/i);
  const metadataUrl=hint?.[1]||hint?.[2]||hint?.[3]||'';
  let json=null;
  if((res.headers.get('content-type')||'').includes('json'))json=await res.json().catch(()=>null);
  else await res.body?.cancel().catch(()=>{});
  const fields=json&&typeof json==='object'?{
   resource:json.resource,authorization_servers:json.authorization_servers,issuer:json.issuer,
   authorization_endpoint:json.authorization_endpoint,token_endpoint:json.token_endpoint,
   registration_endpoint:json.registration_endpoint,
   code_challenge_methods_supported:json.code_challenge_methods_supported,
   grant_types_supported:json.grant_types_supported,scopes_supported:json.scopes_supported
  }:null;
  console.log(JSON.stringify({url,status:res.status,contentType:res.headers.get('content-type'),metadataUrl,authIsBearer:/^Bearer/i.test(auth),fields}));
  return {metadataUrl,fields};
 }catch(e){console.log(JSON.stringify({url,error:e.name||'fetch_failed'}));return null}
};
const direct=await read(base+'/mcp?login',true);
const candidates=[direct?.metadataUrl,base+'/.well-known/oauth-protected-resource/mcp',base+'/.well-known/oauth-protected-resource'];
const issuers=new Set();
for(const url of [...new Set(candidates.filter(Boolean))]){const info=await read(url);for(const issuer of info?.fields?.authorization_servers||[])if(valid(issuer))issuers.add(issuer)}
for(const issuer of issuers){
 const u=new URL(issuer);
 const suffix=u.pathname.endsWith('/')?u.pathname.slice(0,-1):u.pathname;
 for(const url of [u.origin+'/.well-known/oauth-authorization-server'+suffix,u.origin+'/.well-known/openid-configuration'+suffix,u.origin+'/.well-known/oauth-authorization-server'])await read(url)
}
