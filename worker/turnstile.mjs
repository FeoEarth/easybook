import {WorkspaceError} from './workspace-identity.mjs';

const ACTION='create_workspace';
const deny=()=>{throw new WorkspaceError('turnstile_verification_failed',403)};

export async function verifyWorkspaceCreation(request,env,token,fetcher=env.TURNSTILE_VERIFY?.fetch?.bind(env.TURNSTILE_VERIFY)||fetch){
 if(typeof token!=='string'||!token||token.length>2048||typeof env.TURNSTILE_SECRET!=='string'||!env.TURNSTILE_SECRET)deny();
 const hostnames=new Set((env.TURNSTILE_HOSTNAMES||'').split(',').map(value=>value.trim()).filter(Boolean));
 if(!hostnames.size)deny();
 let response,result;
 try{
  response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(10000),body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,remoteip:request.headers.get('CF-Connecting-IP')||''})});
  if(!response.ok)deny();result=await response.json();
 }catch(error){if(error instanceof WorkspaceError)throw error;deny()}
 if(result?.success!==true||result.action!==ACTION||!hostnames.has(result.hostname))deny();
}

export function turnstileConfig(env){
 const sitekey=typeof env.TURNSTILE_SITE_KEY==='string'&&!env.TURNSTILE_SITE_KEY.startsWith('REPLACE_')?env.TURNSTILE_SITE_KEY:'';
 return Response.json({sitekey,action:ACTION},{status:sitekey?200:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
