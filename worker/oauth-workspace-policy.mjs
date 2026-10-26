import {oauthAllowed,allowedWorkspaces,allowedPolicies} from './security-checkpoint.mjs';
import {READ,WRITE} from './mcp-common.mjs';
import {roleScopes} from './workspace-identity.mjs';
export const V2_SCOPES=[...READ,...WRITE,'workspace.create','workspace.write'];
export const modernWorkspaces=env=>env.WORKSPACE_IDENTITY_V2==='true';
const parentSQL='SELECT g.*,active.workspace_id AS active_workspace FROM oauth_grants g JOIN accounts a ON a.id=g.account_id LEFT JOIN oauth_active_workspaces active ON active.policy_id=g.id WHERE g.revoked_at IS NULL AND a.deleted_at IS NULL';
const childSQL="SELECT c.policy_id,c.workspace_id,c.scopes,w.name,w.mode,w.version,CASE WHEN w.manager_account_id=g.account_id THEN 'manager' ELSE m.role END AS role FROM oauth_grant_workspaces c JOIN oauth_grants g ON g.id=c.policy_id JOIN accounts a ON a.id=g.account_id JOIN workspaces w ON w.id=c.workspace_id LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.account_id=g.account_id WHERE c.revoked_at IS NULL AND g.revoked_at IS NULL AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND (w.manager_account_id=g.account_id OR (w.mode='shared' AND m.role IS NOT NULL))";
function shape(row,children,tokenScopes){
 const approved=JSON.parse(row.scopes),token=new Set(tokenScopes),globalScopes=approved.filter(s=>s==='workspace.create'&&token.has(s));
 const workspaces=children.map(child=>({id:child.workspace_id,name:child.name,role:child.role,mode:child.mode,scopes:roleScopes(child.role,JSON.parse(child.scopes)).filter(s=>approved.includes(s)&&token.has(s))})).filter(w=>w.scopes.length);
 const selected=workspaces.find(w=>w.id===row.active_workspace)||null;
 return {...row,workspaces,selected,workspace_id:selected?.id||null,scopes:[...new Set([...globalScopes,...workspaces.flatMap(w=>w.scopes)])],globalScopes};
}
export async function workspacePolicy(env,policyId,{accountId=null,clientId=null,tokenScopes=V2_SCOPES}={}){
 if(typeof policyId!=='string'||!/^[a-f0-9-]{36}$/.test(policyId))return null;
 const row=await env.DB.prepare(parentSQL+' AND g.id=?').bind(policyId).first();
 if(!row||!await oauthAllowed(env,row)||accountId&&row.account_id!==accountId||clientId&&row.client_id!==clientId)return null;
 const {results}=await env.DB.prepare(childSQL+' AND c.policy_id=? ORDER BY c.created_at,c.workspace_id LIMIT 50').bind(row.id).all();
 return shape(row,await allowedWorkspaces(env,results,'workspace_id'),tokenScopes);
}
export async function accountPolicies(env,accountId){
 const {results:rows}=await env.DB.prepare(parentSQL+' AND g.account_id=? ORDER BY g.created_at DESC LIMIT 50').bind(accountId).all();if(!rows.length)return [];
 // Two bounded queries for the whole dashboard, rather than one role lookup per
 // policy/workspace (which would exceed Worker/D1 request limits as usage grows).
 const {results:children}=await env.DB.prepare(childSQL+' AND c.policy_id IN ('+rows.map(()=>'?').join(',')+') ORDER BY c.created_at,c.workspace_id').bind(...rows.map(r=>r.id)).all();
 const permittedRows=await allowedPolicies(env,rows),permittedChildren=await allowedWorkspaces(env,children,'workspace_id');return permittedRows.map(row=>shape(row,permittedChildren.filter(c=>c.policy_id===row.id),V2_SCOPES));
}
export async function policyWorkspace(env,policyId,workspaceId){const policy=await workspacePolicy(env,policyId);if(!policy)return null;const child=policy.workspaces.find(w=>w.id===workspaceId);return child?{id:policy.id,account_id:policy.account_id,scopes:JSON.stringify(child.scopes)}:null}
export async function selectPolicyWorkspace(env,policy,workspaceId){
 if(!policy.workspaces.some(w=>w.id===workspaceId))return false;
 const selected=await env.DB.prepare('INSERT INTO oauth_active_workspaces(policy_id,workspace_id) SELECT g.id,c.workspace_id FROM oauth_grants g JOIN accounts a ON a.id=g.account_id JOIN oauth_grant_workspaces c ON c.policy_id=g.id WHERE g.id=? AND c.workspace_id=? AND g.revoked_at IS NULL AND a.deleted_at IS NULL AND c.revoked_at IS NULL ON CONFLICT(policy_id) DO UPDATE SET workspace_id=excluded.workspace_id RETURNING workspace_id').bind(policy.id,workspaceId).first();return !!selected;
}
