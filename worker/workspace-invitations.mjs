import {hash} from './mcp-common.mjs';
import {WorkspaceError,workspaceAccess,newWorkspaceSecret} from './workspace-identity.mjs';
import {accountAllowed,workspaceAllowed,reserveWorkspaceFloor,finishWorkspaceFloor} from './security-checkpoint.mjs';
import qrcode from '../mcp-oauth/src/vendor/qrcode-generator.mjs';

const UUID=/^[a-f0-9-]{36}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const fail=(code,status=400)=>{throw new WorkspaceError(code,status)};
const sql=(env,query,...args)=>env.DB.prepare(query).bind(...args);
const origin='https://easybook.loonxy.com';
const active=async(env,id)=>Boolean(id&&await accountAllowed(env,id)&&await sql(env,'SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL',id).first());

function qrRows(url){
 const image=qrcode(0,'M');image.addData(url);image.make();
 const n=image.getModuleCount();return Array.from({length:n},(_,y)=>Array.from({length:n},(_,x)=>image.isDark(y,x)?'1':'0').join(''));
}
function publicInvite(row){return {id:row.id,workspaceId:row.workspace_id,workspaceName:row.name,role:row.role,kind:row.invited_account_id?'account':'link',accountId:row.invited_account_id||null,status:row.status,expiresAt:row.expires_at,createdAt:row.created_at};}
async function managerWorkspace(env,id,principal){
 const w=await workspaceAccess(env,id,principal);
 if(!w||w.via!=='account'||w.role!=='manager')fail('manager_required',403);
 if(w.mode!=='shared')fail('shared_workspace_required',409);
 return w;
}
export async function createInvitation(env,id,principal,input){
 const w=await managerWorkspace(env,id,principal);
 if(Date.now()-principal.authenticatedAt>300000)fail('reauthentication_required',403);
 const role=input.role,kind=input.kind,hours=input.expiresHours??24;
 if(!['reader','editor'].includes(role)||!['account','link'].includes(kind)||!Number.isInteger(hours)||hours<1||hours>72)fail('invalid_invitation');
 const accountId=kind==='account'?input.accountId:null;
 if(kind==='account'){
  if(!UUID.test(accountId||'')||accountId===principal.accountId||!await active(env,accountId))fail('invalid_member');
  if(await sql(env,'SELECT 1 FROM workspace_members WHERE workspace_id=? AND account_id=?',id,accountId).first())fail('already_member',409);
 }
 const now=Date.now(),expiresAt=now+hours*3600000;
 const pending=await sql(env,"SELECT COUNT(*) count FROM workspace_invitations WHERE workspace_id=? AND status='pending' AND expires_at>?",id,now).first();
 if(pending.count>=100)fail('too_many_invitations',429);
 const token=kind==='link'?newWorkspaceSecret():null;
 const invitationId=crypto.randomUUID(),check=crypto.randomUUID();
 try{await env.DB.batch([
  sql(env,"INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspaces WHERE id=? AND version=? AND mode='shared' AND manager_account_id=? AND deleted_at IS NULL)",check,id,w.version,principal.accountId),
  sql(env,'INSERT INTO workspace_invitations(id,workspace_id,created_by,invited_account_id,token_hash,role,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',invitationId,id,principal.accountId,accountId,token?await hash(token):null,role,now,expiresAt),
  sql(env,'DELETE FROM workspace_tx_assertions WHERE id=?',check)
 ])}catch(e){if(/workspace_tx_assertions|valid=1|CHECK constraint failed/.test(String(e.message)))fail('workspace_changed_retry',409);throw e}
 const url=token?origin+'/?workspaceInvite='+token:null;
 return {invitation:{id:invitationId,workspaceId:id,workspaceName:w.name,role,kind,accountId,expiresAt,createdAt:now,status:'pending'},...(url?{url,qrRows:qrRows(url)}:{})};
}
export async function managedInvitations(env,id,principal){
 await managerWorkspace(env,id,principal);
 const rows=(await sql(env,'SELECT i.*,w.name FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.workspace_id=? ORDER BY i.created_at DESC LIMIT 100',id).all()).results;
 return {invitations:rows.map(publicInvite)};
}
export async function inboxInvitations(env,principal){
 if(principal?.kind!=='account'||!await active(env,principal.accountId))fail('account_required',403);
 const rows=(await sql(env,"SELECT i.*,w.name,w.version FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.invited_account_id=? AND i.status='pending' AND i.expires_at>? AND w.mode='shared' AND w.deleted_at IS NULL AND w.manager_account_id=i.created_by ORDER BY i.created_at DESC LIMIT 100",principal.accountId,Date.now()).all()).results;
 const permitted=await Promise.all(rows.map(async row=>await workspaceAllowed(env,row.workspace_id,row.version)?publicInvite(row):null));
 return {invitations:permitted.filter(Boolean)};
}
export async function previewInvitation(env,principal,token){
 if(principal?.kind!=='account'||!await active(env,principal.accountId))fail('account_required',401);
 if(!TOKEN.test(token||''))fail('invalid_invitation');
 const row=await sql(env,'SELECT i.*,w.name,w.mode,w.version,w.deleted_at,w.manager_account_id FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?',await hash(token)).first();
 if(!row||row.status!=='pending'||row.expires_at<=Date.now()||row.mode!=='shared'||row.deleted_at!==null||row.manager_account_id!==row.created_by||!await workspaceAllowed(env,row.workspace_id,row.version))fail('invitation_expired_or_used',410);
 return {invitation:publicInvite(row)};
}
export async function revokeInvitation(env,id,principal,invitationId){
 await managerWorkspace(env,id,principal);
 if(Date.now()-principal.authenticatedAt>300000)fail('reauthentication_required',403);
 if(!UUID.test(invitationId||''))fail('invalid_invitation');
 const changed=await sql(env,"UPDATE workspace_invitations SET status='revoked',responded_at=? WHERE id=? AND workspace_id=? AND status='pending' RETURNING id",Date.now(),invitationId,id).first();
 if(!changed)fail('invitation_expired_or_used',409);
 return {revoked:true};
}
export async function respondInvitation(env,principal,input){
 if(principal?.kind!=='account'||!await active(env,principal.accountId))fail('account_required',401);
 const {id,decision,token}=input;
 if(!UUID.test(id||'')||!['accept','reject'].includes(decision)||token!==undefined&&!TOKEN.test(token))fail('invalid_invitation');
 const row=await sql(env,'SELECT i.*,w.name,w.version,w.mode,w.deleted_at,w.manager_account_id FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.id=?',id).first();
 if(!row||row.status!=='pending'||row.expires_at<=Date.now()||row.mode!=='shared'||row.deleted_at!==null||row.manager_account_id!==row.created_by||!await workspaceAllowed(env,row.workspace_id,row.version))fail('invitation_expired_or_used',410);
 if(row.invited_account_id){if(row.invited_account_id!==principal.accountId||token!==undefined)fail('invitation_not_for_account',403)}
 else if(!token||await hash(token)!==row.token_hash)fail('invalid_invitation',403);
 if(await workspaceAccess(env,row.workspace_id,principal))fail('already_member',409);
 const now=Date.now();
 if(decision==='reject'){
  const updated=await sql(env,"UPDATE workspace_invitations SET status='rejected',responded_at=?,accepted_by=? WHERE id=? AND status='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND mode='shared' AND deleted_at IS NULL AND manager_account_id=?) RETURNING id",now,principal.accountId,id,now,row.workspace_id,row.created_by).first();
  if(!updated)fail('invitation_expired_or_used',409);
  return {rejected:true};
 }
 const floor=await reserveWorkspaceFloor(env,row.workspace_id,row.version+1),check=crypto.randomUUID();
 try{
  await env.DB.batch([
   sql(env,"INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id JOIN accounts a ON a.id=? WHERE i.id=? AND i.status='pending' AND i.expires_at>? AND (i.invited_account_id=? OR (i.invited_account_id IS NULL AND i.token_hash=?)) AND w.version=? AND w.mode='shared' AND w.deleted_at IS NULL AND w.manager_account_id=i.created_by AND a.deleted_at IS NULL AND a.id<>w.manager_account_id AND NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.account_id=a.id))",check,principal.accountId,id,now,principal.accountId,token?await hash(token):null,row.version),
   sql(env,"UPDATE workspace_invitations SET status='accepted',responded_at=?,accepted_by=? WHERE id=? AND status='pending'",now,principal.accountId,id),
   sql(env,'INSERT INTO workspace_members(workspace_id,account_id,role,created_at) VALUES(?,?,?,?)',row.workspace_id,principal.accountId,row.role,now),
   sql(env,'UPDATE workspaces SET version=version+1 WHERE id=?',row.workspace_id),
   sql(env,'INSERT INTO workspace_security_events(id,workspace_id,actor_account_id,event,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),row.workspace_id,principal.accountId,'invitation_accepted',now),
   sql(env,'DELETE FROM workspace_tx_assertions WHERE id=?',check)
  ]);
  await finishWorkspaceFloor(env,floor,'committed');
  return {accepted:true,workspaceId:row.workspace_id};
 }catch(e){await finishWorkspaceFloor(env,floor,'cancelled');if(/workspace_tx_assertions|valid=1|CHECK constraint failed|UNIQUE constraint failed/.test(String(e.message)))fail('invitation_changed_retry',409);throw e}
}
