import {publicOrigin,validateServerConfig,webCorsHeaders} from './server-config.mjs';
import {identityEnabled,identityPath} from './identity-origin.mjs';

export function selectedConnectOrigin(url){
 const value=url.searchParams.get('server_origin');
 if(!value||!/^https:\/\/[^/?#]+\/?$/i.test(value))return null;
 try{const parsed=new URL(value);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&parsed.pathname==='/'&&!parsed.search&&!parsed.hash?parsed.origin:null}catch{return null}
}
export function allowConnect(policy,origin){return origin?policy.replace(/connect-src ([^;]*);/,(_,sources)=>'connect-src '+sources+' '+origin+';'):policy}
export function serverDocument(source,url){
 const origin=selectedConnectOrigin(url);
 return origin?source.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/,(_,start,policy,end)=>start+allowConnect(policy,origin)+end):source;
}
export function serverCallback(){
 // The one-time code is delivered only to the matching client flow. Remove it
 // from history before creating the channel; no token is carried in this URL.
 const script=`(()=>{const q=new URLSearchParams(location.search);history.replaceState(null,'','/server-callback');let server;try{const u=new URL(q.get('server'));if(u.protocol!=='https:'||u.origin!==q.get('server'))throw Error();server=u.origin}catch{return}const flow=q.get('flow'),state=q.get('state'),code=q.get('code'),error=q.get('error');if(!/^[a-f0-9]{64}$/.test(flow||'')||!/^[a-f0-9]{64}$/.test(state||'')||(!/^[a-f0-9]{64}$/.test(code||'')&&error!=='access_denied'))return;const channel=new BroadcastChannel('easybook-server-login:'+flow);channel.postMessage({type:'easybook-server-login',server,flow,state,...(error?{error}:{code})});channel.close();document.getElementById('status').textContent='登录结果已发送，可关闭此页面。';window.close()})()`;
 return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Easybook 登录</title><p id="status">正在完成登录…</p><script>'+script+'</script></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
export function serverDiscovery(request,env){
 const url=new URL(request.url),secure=url.protocol==='https:',sync=env.WORKSPACE_IDENTITY_V2==='true';
 const accounts=secure&&identityEnabled(env)&&url.origin===publicOrigin(env)&&!!env.IDENTITY_SERVICE;
 const config=validateServerConfig(env);
 return Response.json({protocolVersion:1,serverOrigin:url.origin,capabilities:{sync,keySync:sync,accounts,webConnector:accounts&&config.webClientRedirectUris.length>0,passkeys:accounts,httpKeyOnly:!secure}},{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function serveWithServerPolicy(request,env,handle){
 const url=new URL(request.url);
 if(url.pathname==='/.well-known/easybook.json'&&request.method==='GET')return serverDiscovery(request,env);
 if(url.pathname==='/.well-known/easybook.json'&&request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS'}});
 if(url.pathname==='/server-callback'&&request.method==='GET')return serverCallback();
 const api=env.WORKSPACE_IDENTITY_V2==='true'&&(url.pathname.startsWith('/api/')||identityPath(url.pathname));
 if(api&&url.protocol!=='https:'&&(identityPath(url.pathname)||/^(Easybook-Web|Easybook-Native|Easybook-Session) /i.test(request.headers.get('Authorization')||'')))return Response.json({error:'account_https_required'},{status:403});
 const cors=api?webCorsHeaders(request,env):null;
 if(api&&request.method==='OPTIONS'&&request.headers.has('Origin'))return new Response(null,{status:cors['Access-Control-Allow-Origin']?204:403,headers:cors});
 const response=await handle(request,env);
 if(!api)return response;
 const headers=new Headers(response.headers);
 for(const key of [...headers.keys()])if(key.toLowerCase().startsWith('access-control-'))headers.delete(key);
 for(const [key,value] of Object.entries(cors))key==='Vary'?headers.append(key,value):headers.set(key,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
