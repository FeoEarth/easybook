// Cloudflare global deployment propagation is asynchronous. Bound the wait and verify exact source.
export async function verifyMcpReadiness(origin,schema=9){
 let last='No response';for(let attempt=0;attempt<30;attempt++){
  try{const response=await fetch(origin+'/health/mcp?readiness='+attempt,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(5000)});const data=await response.json();last=JSON.stringify({status:response.status,schema:data.mcp_schema_revision,release:data.release_sha});if(response.status===200&&data.mcp_schema_revision===schema&&(!process.env.GITHUB_SHA||data.release_sha===process.env.GITHUB_SHA))return data;}catch(error){last=error.name;}
  if(attempt<29)await new Promise(resolve=>setTimeout(resolve,1000));
 }throw Error('MCP deployment did not reach expected readiness: '+last);
}
