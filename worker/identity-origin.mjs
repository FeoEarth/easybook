import {publicOrigin} from './server-config.mjs';
export {publicOrigin};
export const IDENTITY_ORIGIN='https://easybook.loonxy.com';
export const LEGACY_IDENTITY_ORIGIN='https://easybook-mcp-oauth.1902521952.workers.dev';
export const NATIVE_REDIRECT='easybook://account/callback';
export function identityEnabled(env){return env.IDENTITY_CANONICAL_V2==='true'}
export function hasLegacyIdentity(env){return publicOrigin(env)===IDENTITY_ORIGIN}
export function identityHttpsAllowed(request,env){return new URL(request.url).protocol==='https:'&&new URL(publicOrigin(env)).protocol==='https:'}
export function githubCallback(request,env){
 const origin=publicOrigin(env),legacy=hasLegacyIdentity(env);
 const target=env.GITHUB_REDIRECT_URI||(legacy?(identityEnabled(env)?LEGACY_IDENTITY_ORIGIN+'/callback':new URL('/callback',request.url).href):origin+'/callback');
 if(!(legacy?[IDENTITY_ORIGIN+'/callback',LEGACY_IDENTITY_ORIGIN+'/callback']:[origin+'/callback']).includes(target))throw new Error('Invalid configured GitHub callback');
 return target;
}
export function identityPath(path){return /^\/(account|oauth)(\/|$)/.test(path)||['/callback','/authorize','/token','/register','/mcp'].includes(path)||path.startsWith('/.well-known/oauth-')||path.startsWith('/uploads/')}
