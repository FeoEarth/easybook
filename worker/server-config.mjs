export const DEFAULT_PUBLIC_ORIGIN='https://easybook.loonxy.com';

function origin(value,{httpsOnly=false}={}){
 if(typeof value!=='string'||!value||value.length>2048)throw new Error('Invalid server origin');
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||httpsOnly&&url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid server origin');
 return url.origin;
}
function configuredList(value){
 if(value===undefined||value===null||value==='')return [];
 if(typeof value!=='string')throw new Error('Invalid Web client configuration');
 const items=value.trim().startsWith('[')?JSON.parse(value):value.split(/[\n,]/);
 if(!Array.isArray(items)||items.length>100||items.some(x=>typeof x!=='string'))throw new Error('Invalid Web client configuration');
 return [...new Set(items.map(x=>x.trim()).filter(Boolean))];
}
export function publicOrigin(env={}){return origin(env.PUBLIC_ORIGIN===undefined?DEFAULT_PUBLIC_ORIGIN:env.PUBLIC_ORIGIN);}
export function validateServerConfig(env={}){
 const own=publicOrigin(env),clients=new Set([own]);
 for(const value of configuredList(env.WEB_CLIENT_ORIGINS))clients.add(origin(value,{httpsOnly:true}));
 const redirects=new Set(own.startsWith('https:')?[own+'/server-callback']:[]);
 for(const value of configuredList(env.WEB_CLIENT_REDIRECT_URIS)){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/server-callback'||url.search||url.hash||!clients.has(url.origin))throw new Error('Invalid Web login redirect URI');
  redirects.add(url.href);
 }
 return {publicOrigin:own,webClientOrigins:[...clients],webClientRedirectUris:[...redirects]};
}
export function isWebClientOriginAllowed(env,clientOrigin){
 if(typeof clientOrigin!=='string'||clientOrigin==='null')return false;
 try{return origin(clientOrigin)===clientOrigin&&validateServerConfig(env).webClientOrigins.includes(clientOrigin)}catch{return false}
}
export function webLoginRedirect(env,value,clientOrigin){
 if(!isWebClientOriginAllowed(env,clientOrigin)||typeof value!=='string')return null;
 try{const url=new URL(value);return url.origin===clientOrigin&&url.href===value&&validateServerConfig(env).webClientRedirectUris.includes(value)?value:null}catch{return null}
}
export function webCorsHeaders(request,env){
 const client=request.headers.get('Origin');
 return isWebClientOriginAllowed(env,client)?{'Access-Control-Allow-Origin':client,'Access-Control-Allow-Methods':'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Easybook-Workspace, X-Easybook-CSRF','Access-Control-Max-Age':'600','Vary':'Origin'}:{};
}
