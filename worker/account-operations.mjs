import {sessionAllowed,oauthAllowed,workspaceAllowed} from './security-checkpoint.mjs';
import {manifest} from './mcp-attachments.mjs';
import {attachmentDeleted} from './attachment-purge.mjs';
import {validateDocument} from '../shared/document.mjs';
import {canonical,hash,fail} from './mcp-common.mjs';
import {workspacePolicy} from './oauth-workspace-policy.mjs';
import {atomicNoteBatch} from './mcp-atomic-notes.mjs';
const scopes={notes_batch_move:'notes.write',notes_batch_update:'notes.write',notes_batch_delete:'notes.delete',notes_permanent_delete:'notes.delete',notes_overwrite:'notes.write',folders_clear:'notes.delete',attachments_permanent_delete:'attachments.write'};
export const operationScope=tool=>scopes[tool];
function assertion(env,sql,params){return env.DB.prepare('INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS('+sql+')').bind(crypto.randomUUID(),...params)}
function authority(env,row){
 return assertion(env,`SELECT 1 FROM oauth_grants g JOIN oauth_grant_workspaces c ON c.policy_id=g.id JOIN accounts a ON a.id=g.account_id JOIN workspaces w ON w.id=c.workspace_id LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.account_id=g.account_id WHERE g.id=? AND g.account_id=? AND g.client_id=? AND c.workspace_id=? AND g.revoked_at IS NULL AND c.revoked_at IS NULL AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND (w.manager_account_id=g.account_id OR (w.mode='shared' AND m.role='editor')) AND EXISTS(SELECT 1 FROM json_each(g.scopes) WHERE value=?) AND EXISTS(SELECT 1 FROM json_each(c.scopes) WHERE value=?)`,[row.policy_id,row.account_id,row.client_id,row.workspace_id,row.scope,row.scope]);
}
export async function prepareAccountOperation(env,{policyId,accountId,clientId,workspaceId,tokenScopes},tool,args){
 const scope=scopes[tool];if(!scope)fail('OPERATION_UNAVAILABLE','This operation is not supported by account approval yet');
 const policy=await workspacePolicy(env,policyId,{accountId,clientId,tokenScopes}),child=policy?.workspaces.find(w=>w.id===workspaceId);
 if(!child?.scopes.includes(scope))fail('PERMISSION_DENIED','Operation is outside the account authorization');
 let {confirmation_id,...payload}=args;
 if(confirmation_id!==undefined)fail('INVALID_ARGUMENT','Do not supply a confirmation identifier');
 if(tool==='folders_clear'){
  if(!child.scopes.includes('folders.manage'))fail('PERMISSION_DENIED','Folder management authorization is required');
  const folder=await env.DB.prepare('SELECT updated FROM folders WHERE workspace=? AND id=? AND deleted=0').bind(workspaceId,payload.folder_id).first();if(!folder)fail('NOT_FOUND','Folder not found');
  const targets=(await env.DB.prepare('SELECT id,version FROM notes_json WHERE workspace=? AND folder_id=? AND purged=0 AND deleted=0 ORDER BY id LIMIT 101').bind(workspaceId,payload.folder_id).all()).results;
  if(!targets.length)fail('NOT_FOUND','Folder has no active notes');if(targets.length>100)fail('OPERATION_TOO_LARGE','This approval supports up to 100 direct notes');
  payload={folder_id:payload.folder_id,folder_updated:folder.updated,items:targets};
 }
 if(tool==='notes_overwrite')payload.document=validateDocument(payload.document);
 if(tool==='attachments_permanent_delete'){
  if(await attachmentDeleted(env,workspaceId,payload.attachment_id))fail('NOT_FOUND','Attachment permanently deleted');
  await manifest({env,workspace:workspaceId},payload.attachment_id);
  payload={attachment_id:payload.attachment_id,content_version:payload.attachment_id,items:[]};
 }
 if(tool!=='attachments_permanent_delete'&&(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>100||new Set(payload.items.map(i=>i.id)).size!==payload.items.length))fail('INVALID_ARGUMENT','Expected unique operation targets');
 const targets=(await env.DB.prepare('SELECT id,version FROM notes_json WHERE workspace=? AND purged=0 AND (deleted=0 OR ?=1) AND id IN(SELECT value FROM json_each(?))').bind(workspaceId,tool==='notes_permanent_delete'?1:0,JSON.stringify(payload.items.map(i=>i.id))).all()).results;
 if(payload.items.some(item=>!targets.some(n=>n.id===item.id&&n.version===item.version)))fail('CONFLICT','A target changed before approval');
 if(tool==='attachments_permanent_delete'&&await env.DB.prepare("SELECT 1 FROM notes_json WHERE workspace=? AND purged=0 AND EXISTS(SELECT 1 FROM json_tree(document) WHERE key='assetId' AND value=?) LIMIT 1").bind(workspaceId,'sha256:'+payload.attachment_id).first())fail('ATTACHMENT_IN_USE','Remove references including recently deleted notes first');
 const now=Date.now(),row={id:crypto.randomUUID(),policy_id:policyId,account_id:accountId,client_id:clientId,workspace_id:workspaceId,scope},guards=[authority(env,row)];
 guards.push(assertion(env,'SELECT 1 WHERE (SELECT COUNT(*) FROM account_operation_approvals WHERE account_id=? AND status=\'pending\' AND expires_at>?)<10',[accountId,now]));
 guards.push(env.DB.prepare("INSERT INTO account_operation_approvals(id,account_id,policy_id,client_id,workspace_id,scope,tool,payload,payload_hash,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')").bind(row.id,accountId,policyId,clientId,workspaceId,scope,tool,JSON.stringify(payload),await hash(canonical({tool,arguments:payload})),now,now+600000),env.DB.prepare('DELETE FROM workspace_tx_assertions'));
 try{await env.DB.batch(guards)}catch(error){if(/constraint/i.test(error.message))fail('AUTHORIZATION_CHANGED','Authorization changed or too many pending approvals');throw error}
 return {approval_id:row.id,approval_url:'https://easybook.loonxy.com/account/operations/'+row.id,expires_at:now+600000,status:'pending',instructions:'由发起此 OAuth 授权的账户本人登录 Easybook 审批。批准后服务端自动执行；AI 只能查询状态，不得重新提交执行。'};
}
export async function operationStatus(env,id,{accountId,policyId,clientId}){
 const row=await env.DB.prepare('SELECT id,account_id,policy_id,client_id,status,result,expires_at FROM account_operation_approvals WHERE id=? AND account_id=? AND policy_id=? AND client_id=?').bind(id,accountId,policyId,clientId).first();
 if(!row)fail('NOT_FOUND','Operation not found');
 return {approval_id:row.id,status:row.status==='pending'&&row.expires_at<=Date.now()?'expired':row.status,result:row.result?JSON.parse(row.result):null,...(row.result&&JSON.parse(row.result).cleanup_job?{cleanup:(await env.DB.prepare('SELECT status,attempts,error FROM attachment_purge_jobs WHERE id=?').bind(id).first())}: {})};
}
export async function executeAccountOperation(env,id,s){
 const row=await env.DB.prepare('SELECT * FROM account_operation_approvals WHERE id=? AND account_id=?').bind(id,s.account_id).first();if(!row)fail('NOT_FOUND','Operation not found');
 const grant=await env.DB.prepare('SELECT * FROM oauth_grants WHERE id=?').bind(row.policy_id).first(),workspace=await env.DB.prepare('SELECT version FROM workspaces WHERE id=?').bind(row.workspace_id).first();
 if(!grant||!workspace||!await sessionAllowed(env,s)||!await oauthAllowed(env,grant)||!await workspaceAllowed(env,row.workspace_id,workspace.version))fail('PERMISSION_DENIED','Account or workspace security state changed');
 const policy=await workspacePolicy(env,row.policy_id,{accountId:row.account_id,clientId:row.client_id});if(!policy?.workspaces.some(w=>w.id===row.workspace_id&&w.scopes.includes(row.scope)))fail('PERMISSION_DENIED','Workspace authorization was revoked');
 if(row.status==='completed')return JSON.parse(row.result);
 if(row.status!=='pending'||row.expires_at<=Date.now())fail('APPROVAL_EXPIRED','Operation is no longer pending');
 const payload=JSON.parse(row.payload);if(await hash(canonical({tool:row.tool,arguments:payload}))!==row.payload_hash)fail('INVALID_OPERATION','Frozen operation integrity check failed');
 const now=Date.now(),guards=[authority(env,row),assertion(env,"SELECT 1 FROM account_operation_approvals WHERE id=? AND status='pending' AND expires_at>?",[id,now]),assertion(env,'SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys p ON p.id=sp.credential_id WHERE sp.session_id=s.id AND p.revoked_at IS NOT NULL)',[s.id,s.account_id,now])];
 // Completion receipt and note changes commit together. A lost HTTP response can
 // be retried safely: completed operations never reapply their mutation.
 const receipt={atomic:true,approval_id:id,results:payload.items.map(i=>({id:i.id,version:i.version+1,ok:true}))};
 if(row.tool==='attachments_permanent_delete'){delete receipt.results;Object.assign(receipt,{attachment_id:payload.attachment_id,access_revoked:true,cleanup_job:id})}
 if(row.tool==='folders_clear')guards.push(authority(env,{...row,scope:'folders.manage'}));
 guards.push(env.DB.prepare("UPDATE account_operation_approvals SET status='completed',result=?,completed_at=? WHERE id=? AND status='pending'").bind(JSON.stringify(receipt),now,id));
 try{
  if(row.tool==='attachments_permanent_delete'){
   guards.push(assertion(env,"SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM notes_json WHERE workspace=? AND purged=0 AND EXISTS(SELECT 1 FROM json_tree(document) WHERE key='assetId' AND value=?))",[row.workspace_id,'sha256:'+payload.attachment_id]),env.DB.prepare('INSERT INTO attachment_tombstones(workspace,attachment,approval_id,created_at) VALUES(?,?,?,?)').bind(row.workspace_id,payload.attachment_id,id,now),env.DB.prepare("INSERT INTO attachment_purge_jobs(id,approval_id,workspace,attachment,status,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)").bind(id,id,row.workspace_id,payload.attachment_id,now,now),env.DB.prepare('DELETE FROM mcp_downloads WHERE workspace=? AND attachment=?').bind(row.workspace_id,payload.attachment_id),env.DB.prepare('DELETE FROM workspace_tx_assertions'));
   try{await env.DB.batch(guards)}catch(error){if(/constraint/i.test(error.message))fail('CONFLICT','Attachment references or authority changed; no deletion occurred');throw error}
  }else await atomicNoteBatch(env,row.workspace_id,row.tool,payload,{guards});return receipt}catch(error){if(error.code==='CONFLICT')await env.DB.prepare("UPDATE account_operation_approvals SET status='conflict',completed_at=? WHERE id=? AND status='pending'").bind(Date.now(),id).run();throw error}
}
export async function reserveSmallOperation(env,accountId,workspaceId){
 const now=Date.now();
 try{await env.DB.batch([
  assertion(env,'SELECT 1 WHERE (SELECT COUNT(*) FROM account_operation_budget WHERE account_id=? AND workspace_id=? AND created_at>?)<20',[accountId,workspaceId,now-600000]),
  env.DB.prepare('INSERT INTO account_operation_budget(id,account_id,workspace_id,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),accountId,workspaceId,now),
  env.DB.prepare('DELETE FROM workspace_tx_assertions'),
  env.DB.prepare('DELETE FROM account_operation_budget WHERE id IN(SELECT id FROM account_operation_budget WHERE created_at<? LIMIT 100)').bind(now-600000)
 ])}catch(error){if(/constraint/i.test(error.message))return false;throw error}return true;
}

