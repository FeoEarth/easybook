// Public readiness exposes only a schema revision, never workspace data.
export async function mcpHealth(env){
 try{
  const r=await env.DB.prepare("SELECT COUNT(*) AS ready FROM sqlite_master WHERE (type='table' AND name IN ('mcp_client_permissions','mcp_approvals','mcp_downloads','mcp_attachment_retirements','mcp_audit','mcp_note_metrics','mcp_uploads','mcp_upload_budgets')) OR (type='trigger' AND name IN ('mcp_metrics_insert','mcp_metrics_update'))").bind().first();
  return Response.json({ok:r?.ready===10,mcp_schema_revision:r?.ready===10?9:0,release_sha:env.RELEASE_SHA||''},{status:r?.ready===10?200:503,headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({ok:false,mcp_schema_revision:0},{status:503,headers:{'Cache-Control':'no-store'}})}
}
