// Preserve non-production/self-hosted legacy compatibility, while the modern
// account deployment retires workspace-key pairing consistently at the boundary.
import {modernWorkspaces} from './oauth-workspace-policy.mjs';
export function legacyMcpRetirement(request,env,surface){
 if(!modernWorkspaces(env))return null;
 const url=new URL(request.url);
 if(surface==='sync'&&['/mcp','/api/mcp/attest','/api/mcp/approval'].includes(url.pathname))return Response.json({error:'Use account OAuth authorization'},{status:410,headers:{'Cache-Control':'no-store'}});
 if(surface==='identity'&&(url.pathname==='/pairing/complete'||url.pathname==='/callback'&&!url.searchParams.get('state')?.startsWith('account_')))return new Response('Legacy authorization retired; authorize your Easybook account',{status:410,headers:{'Cache-Control':'no-store'}});
 return null;
}
