export const IDENTITY_ORIGIN='https://easybook.loonxy.com';
export const LEGACY_IDENTITY_ORIGIN='https://easybook-mcp-oauth.1902521952.workers.dev';
export const NATIVE_REDIRECT='easybook://account/callback';
export function identityEnabled(env){return env.IDENTITY_CANONICAL_V2==='true'}
export function githubCallback(request,env){
 const target=env.GITHUB_REDIRECT_URI||(identityEnabled(env)?LEGACY_IDENTITY_ORIGIN+'/callback':new URL('/callback',request.url).href);
 if(![IDENTITY_ORIGIN+'/callback',LEGACY_IDENTITY_ORIGIN+'/callback'].includes(target))throw new Error('Invalid configured GitHub callback');
 return target;
}
export function identityPath(path){return /^\/(account|oauth)(\/|$)/.test(path)||['/callback','/authorize','/token','/register','/mcp'].includes(path)||path.startsWith('/.well-known/oauth-')||path.startsWith('/uploads/')}
