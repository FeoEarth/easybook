import {fail} from './mcp-common.mjs';
const pageSize=50;
export async function auditHistory(env,accountId,{workspaceId=null,cursor=null}={}){
 const clauses=[],params=[];
 if(workspaceId){
  if(!/^[a-f0-9]{64}$/.test(workspaceId))fail('INVALID_ARGUMENT','Invalid workspace');
  const manager=await env.DB.prepare('SELECT 1 FROM workspaces WHERE id=? AND manager_account_id=? AND deleted_at IS NULL').bind(workspaceId,accountId).first();
  clauses.push('workspace_id=?');params.push(workspaceId);if(!manager){clauses.push('account_id=?');params.push(accountId)}
 }else {clauses.push('account_id=?');params.push(accountId)}
 if(cursor){let value;try{value=JSON.parse(atob(cursor))}catch{fail('INVALID_ARGUMENT','Invalid cursor')}
  if(!Array.isArray(value)||value.length!==2||!Number.isSafeInteger(value[0])||typeof value[1]!=='string'||!/^[a-f0-9-]{32,36}$/.test(value[1]))fail('INVALID_ARGUMENT','Invalid cursor');
  clauses.push('(created_at<? OR (created_at=? AND id<?))');params.push(value[0],value[0],value[1]);
 }
 const {results}=await env.DB.prepare('SELECT id,account_id,workspace_id,category,code,status,created_at FROM account_audit_events WHERE '+clauses.join(' AND ')+' ORDER BY created_at DESC,id DESC LIMIT ?').bind(...params,pageSize+1).all();
 const more=results.length>pageSize;results.length=Math.min(results.length,pageSize);const last=results.at(-1);
 return {events:results,next_cursor:more?btoa(JSON.stringify([last.created_at,last.id])):null};
}
export async function notifications(env,accountId){const {results}=await env.DB.prepare('SELECT id,severity,code,created_at,read_at FROM account_notifications WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(accountId).all();return results}
