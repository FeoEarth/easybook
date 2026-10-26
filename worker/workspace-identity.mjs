import {accountAllowed,workspaceAllowed,allowedWorkspaces,requireRestoreAccess,checkpointEnabled,reserveWorkspaceFloor,finishWorkspaceFloor} from './security-checkpoint.mjs';
import {hash, READ, WRITE} from './mcp-common.mjs';

const HEX=/^[a-f0-9]{64}$/;
export class WorkspaceError extends Error {
 constructor(code,status=403){super(code);this.code=code;this.status=status;}
}
const deny=(code,status)=>{throw new WorkspaceError(code,status)};
export const newWorkspaceSecret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function nameValue(value){if(typeof value!=='string'||!value.trim()||value.trim().length>60)deny('invalid_name',400);return value.trim();}
function stmt(env,sql,...args){return env.DB.prepare(sql).bind(...args);}
const activeAccount=async(env,id)=>await accountAllowed(env,id)?stmt(env,'SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL',id).first():null;
const metadata=(env,id)=>stmt(env,'SELECT * FROM workspaces WHERE id=? AND deleted_at IS NULL',id).first();
const event=(env,id,actor,kind)=>stmt(env,'INSERT INTO workspace_security_events(id,workspace_id,actor_account_id,event,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),id,actor?.accountId||null,kind,Date.now());

// Called only with a server-verified principal. HTTP callers cannot supply one.
export async function workspaceAccess(env,id,principal){
 if(!HEX.test(id||''))return null;
 const w=await metadata(env,id);if(!w||!await workspaceAllowed(env,id,w.version))return null;
 if(principal?.kind==='key'&&w.mode==='personal'){
  const key=await stmt(env,'SELECT key_hash FROM workspace_keys WHERE workspace_id=? AND key_hash=? AND revoked_at IS NULL',id,principal.keyHash||'').first();
  return key?{...w,role:'manager',via:'key'}:null;
 }
 if(!['account','oauth'].includes(principal?.kind)||!await activeAccount(env,principal.accountId))return null;
 let role=w.manager_account_id===principal.accountId?'manager':null;
 if(!role&&w.mode==='shared')role=(await stmt(env,'SELECT role FROM workspace_members WHERE workspace_id=? AND account_id=?',id,principal.accountId).first())?.role;
 return role?{...w,role,via:principal.kind}:null;
}
export function roleScopes(role,granted){
 const allowed=role==='reader'?READ:role==='editor'?[...READ,...WRITE]:role==='manager'?[...READ,...WRITE,'workspace.write']:[];
 return granted.filter(s=>allowed.includes(s));
}
async function requireManager(env,id,principal,accountOnly=false){
 if(principal?.kind==='oauth')deny('account_security_operation_forbidden');
 const w=await workspaceAccess(env,id,principal);
 if(!w||w.role!=='manager'||accountOnly&&w.via!=='account')deny('manager_required');
 return w;
}
// Recheck authority and version inside the transaction, rather than trusting the
// earlier read. CHECK failure rolls back every following statement in D1.batch.
function guard(env,w,principal){
 const checkId=crypto.randomUUID();
 const authority=principal.kind==='key'
  ? "mode='personal' AND EXISTS(SELECT 1 FROM workspace_keys k WHERE k.workspace_id=workspaces.id AND k.key_hash=? AND k.revoked_at IS NULL)"
  : 'manager_account_id=? AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=workspaces.manager_account_id AND a.deleted_at IS NULL)';
 return {checkId,statement:stmt(env,`INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspaces WHERE id=? AND version=? AND deleted_at IS NULL AND ${authority})`,checkId,w.id,w.version,principal.kind==='key'?principal.keyHash:principal.accountId)};
}
async function change(env,w,principal,statements,{security=true}={}){
 const g=guard(env,w,principal),floor=security?await reserveWorkspaceFloor(env,w.id,w.version+1):null;
 try{const result=await env.DB.batch([g.statement,...statements,stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',g.checkId)]);await finishWorkspaceFloor(env,floor,'committed');return result;}
 catch(e){if(String(e.message).includes('workspace_tx_assertions')||String(e.message).includes('valid=1')){await finishWorkspaceFloor(env,floor,'cancelled');deny('workspace_changed_retry',409)}throw e;}
}
function invalidate(env,id,account=null){
 if(env.WORKSPACE_IDENTITY_V2==='true')return stmt(env,'UPDATE oauth_grant_workspaces SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL'+(account?' AND policy_id IN(SELECT id FROM oauth_grants WHERE account_id=?)':''),...[Date.now(),id,...(account?[account]:[])]);
 const suffix=account?' AND account_id=?':'';
 return stmt(env,'UPDATE oauth_grants SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL'+suffix,...[Date.now(),id,...(account?[account]:[])]);
}

export async function createWorkspace(env,name,principal=null,initialKey=null){
 await requireRestoreAccess(env);
 const id=newWorkspaceSecret(),key=initialKey||newWorkspaceSecret(),now=Date.now();name=nameValue(name);
 if(!HEX.test(key))deny('invalid_workspace_key',400);
 if(initialKey&&await stmt(env,'SELECT 1 FROM workspace_keys WHERE key_hash=?',await hash(initialKey)).first())deny('credential_already_registered',409);
 if(principal&&(!['account','oauth'].includes(principal.kind)||!await activeAccount(env,principal.accountId)))deny('account_required');
 if(principal?.kind==='oauth'&&!principal.scopes?.includes('workspace.create'))deny('insufficient_scope');
 // AI may create an account-associated personal workspace but never receives its key.
 const statements=[stmt(env,"INSERT INTO workspaces(id,name,mode,manager_account_id,created_at) VALUES(?,?,'personal',?,?)",id,name,principal?.accountId||null,now),
  stmt(env,'INSERT INTO workspace_keys(key_hash,workspace_id,created_at) VALUES(?,?,?)',await hash(key),id,now),event(env,id,principal,'workspace_created')];
 if(principal){const check=crypto.randomUUID();statements.unshift(stmt(env,'INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)',check,principal.accountId));statements.push(stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',check))}
 await env.DB.batch(statements);
 return {workspace:await metadata(env,id),...(principal?.kind==='oauth'?{}:{key})};
}

// Transition adapter for existing 256-bit keys. Never reinterpret a known/revoked
// verifier as a new workspace. Unknown keys are accepted only during migration.
export async function resolveWorkspaceKey(env,key,{allowLegacy=false}={}){
 if(!HEX.test(key||''))return null;
 const keyHash=await hash(key);
 let row=await stmt(env,'SELECT workspace_id,revoked_at FROM workspace_keys WHERE key_hash=?',keyHash).first();
 if(!row&&allowLegacy&&!checkpointEnabled(env)){
  const now=Date.now();
  await env.DB.batch([
   stmt(env,"INSERT INTO workspaces(id,name,mode,created_at) VALUES(?,'我的工作区','personal',?) ON CONFLICT(id) DO NOTHING",keyHash,now),
   stmt(env,'INSERT INTO workspace_keys(key_hash,workspace_id,created_at) SELECT ?,id,? FROM workspaces WHERE id=? AND mode=\'personal\' AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM workspace_keys WHERE workspace_id=?) ON CONFLICT(key_hash) DO NOTHING',keyHash,now,keyHash,keyHash)
  ]);
  row=await stmt(env,'SELECT workspace_id,revoked_at FROM workspace_keys WHERE key_hash=?',keyHash).first();
 }
 if(!row||row.revoked_at!==null)return null;
 const principal={kind:'key',keyHash};
 const access=await workspaceAccess(env,row.workspace_id,principal);
 return access?{workspace:access,principal}:null;
}

export async function rotateWorkspaceKey(env,id,principal){
 const w=await requireManager(env,id,principal);if(w.mode!=='personal')deny('shared_has_no_key',409);
 const key=newWorkspaceSecret(),now=Date.now();
 await change(env,w,principal,[
  stmt(env,'UPDATE workspace_keys SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL',now,id),
  stmt(env,'INSERT INTO workspace_keys(key_hash,workspace_id,created_at) VALUES(?,?,?)',await hash(key),id,now),
  stmt(env,'UPDATE workspaces SET version=version+1 WHERE id=?',id),event(env,id,principal,'key_rotated')
 ]);
 return {workspace:await metadata(env,id),key};
}

// Association is not transfer. Caller must prove BOTH a current account session
// and possession of the current key. Existing owners are never replaced by a key.
export async function associateWorkspace(env,id,keyPrincipal,accountPrincipal){
 if(accountPrincipal?.kind!=='account'||!await activeAccount(env,accountPrincipal.accountId))deny('account_required');
 const w=await requireManager(env,id,keyPrincipal);
 if(w.mode!=='personal')deny('personal_required',409);
 if(w.manager_account_id&&w.manager_account_id!==accountPrincipal.accountId)deny('already_associated',409);
 await change(env,w,keyPrincipal,[
  stmt(env,'INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)',id,accountPrincipal.accountId),
  stmt(env,'UPDATE workspaces SET manager_account_id=?,version=version+1 WHERE id=?',accountPrincipal.accountId,id),
  event(env,id,accountPrincipal,'account_associated'),stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',id)
 ]);
 return metadata(env,id);
}

export async function listWorkspaces(env,principal){
 if(principal?.kind!=='account'||!await activeAccount(env,principal.accountId))deny('account_required');
 const {results}=await stmt(env,"SELECT w.*,CASE WHEN w.manager_account_id=? THEN 'manager' ELSE m.role END role FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.account_id=? WHERE w.deleted_at IS NULL AND (w.manager_account_id=? OR (w.mode='shared' AND m.account_id=?)) ORDER BY w.created_at,w.id",...Array(4).fill(principal.accountId)).all();return allowedWorkspaces(env,results);
}

export async function renameWorkspace(env,id,principal,name){
 name=nameValue(name);const w=await workspaceAccess(env,id,principal);
 if(!w||w.role!=='manager')deny('manager_required');
 if(principal.kind==='oauth'&&!principal.scopes?.includes('workspace.write'))deny('insufficient_scope');
 await change(env,w,principal,[stmt(env,'UPDATE workspaces SET name=?,version=version+1 WHERE id=?',name,id)],{security:false});
 return metadata(env,id);
}

export async function convertToShared(env,id,principal,{confirm=false,firstAccountId,role='editor'}={}){
 const w=await requireManager(env,id,principal,true);
 if(w.mode!=='personal'||!confirm)deny('explicit_conversion_required',409);
 if(firstAccountId===principal.accountId||!['editor','reader'].includes(role)||!await activeAccount(env,firstAccountId))deny('invalid_member',400);
 await change(env,w,principal,[
  stmt(env,'UPDATE workspace_keys SET revoked_at=? WHERE workspace_id=? AND revoked_at IS NULL',Date.now(),id),
  stmt(env,"UPDATE workspaces SET mode='shared',version=version+1 WHERE id=?",id),
  stmt(env,'INSERT INTO workspace_members(workspace_id,account_id,role,created_at) VALUES(?,?,?,?)',id,firstAccountId,role,Date.now()),
  invalidate(env,id),event(env,id,principal,'converted_to_shared')
 ]);return metadata(env,id);
}

export async function convertToPersonal(env,id,principal,{confirm=false}={}){
 const w=await requireManager(env,id,principal,true);
 if(w.mode!=='shared'||!confirm)deny('explicit_conversion_required',409);
 const key=newWorkspaceSecret();
 await change(env,w,principal,[
  stmt(env,'INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=?)',id,id),
  stmt(env,"UPDATE workspaces SET mode='personal',version=version+1 WHERE id=?",id),
  stmt(env,'INSERT INTO workspace_keys(key_hash,workspace_id,created_at) VALUES(?,?,?)',await hash(key),id,Date.now()),
  invalidate(env,id),event(env,id,principal,'converted_to_personal'),stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',id)
 ]);return {workspace:await metadata(env,id),key};
}

export async function setWorkspaceMember(env,id,principal,accountId,role){
 const w=await requireManager(env,id,principal,true);
 if(w.mode!=='shared'||accountId===w.manager_account_id||!['editor','reader',null].includes(role))deny('invalid_member',400);
 if(role&&!await activeAccount(env,accountId))deny('invalid_member',400);
 const update=role
  ?stmt(env,'INSERT INTO workspace_members(workspace_id,account_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(workspace_id,account_id) DO UPDATE SET role=excluded.role',id,accountId,role,Date.now())
  :stmt(env,'DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?',id,accountId);
 // Revoke on any membership change. A later promotion cannot revive old grants.
 await change(env,w,principal,[update,invalidate(env,id,accountId),stmt(env,'UPDATE workspaces SET version=version+1 WHERE id=?',id),event(env,id,principal,role?'member_role_changed':'member_removed')]);
 return metadata(env,id);
}

export async function transferWorkspaceManager(env,id,principal,newManagerId,{confirm=false}={}){
 const w=await requireManager(env,id,principal,true);
 if(w.mode!=='shared'||!confirm||newManagerId===w.manager_account_id||!await activeAccount(env,newManagerId))deny('invalid_transfer',409);
 await change(env,w,principal,[
  stmt(env,'INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=? AND account_id=?)',id,id,newManagerId),
  stmt(env,'DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?',id,newManagerId),
  stmt(env,'UPDATE workspaces SET manager_account_id=?,version=version+1 WHERE id=?',newManagerId,id),
  stmt(env,"INSERT INTO workspace_members(workspace_id,account_id,role,created_at) VALUES(?,?,'editor',?)",id,w.manager_account_id,Date.now()),
  invalidate(env,id),event(env,id,principal,'manager_transferred'),stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',id)
 ]);return metadata(env,id);
}


// Members are resolved only after live account access, including the external floor.
export async function listWorkspaceMembers(env,id,principal){
 const w=await workspaceAccess(env,id,principal);if(!w||w.via!=='account')deny('account_required');
 const {results}=await stmt(env,"SELECT a.id account_id,a.display_name,'manager' role FROM accounts a WHERE a.id=? AND a.deleted_at IS NULL UNION ALL SELECT a.id,a.display_name,m.role FROM workspace_members m JOIN accounts a ON a.id=m.account_id WHERE m.workspace_id=? AND a.deleted_at IS NULL",w.manager_account_id,id).all();return {workspace:w,members:results};
}
export async function leaveWorkspace(env,id,principal){
 const w=await workspaceAccess(env,id,principal);
 if(!w||w.via!=='account'||w.mode!=='shared')deny('shared_member_required');
 if(w.role==='manager')deny('manager_transfer_required',409);
 const check=crypto.randomUUID(),floor=await reserveWorkspaceFloor(env,id,w.version+1);
 try{await env.DB.batch([
  stmt(env,"INSERT INTO workspace_tx_assertions(id,valid) SELECT ?,EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id JOIN accounts a ON a.id=m.account_id WHERE w.id=? AND w.version=? AND w.mode='shared' AND w.deleted_at IS NULL AND w.manager_account_id<>? AND m.account_id=? AND a.deleted_at IS NULL)",check,id,w.version,principal.accountId,principal.accountId),
  stmt(env,'DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?',id,principal.accountId),invalidate(env,id,principal.accountId),
  stmt(env,'UPDATE workspaces SET version=version+1 WHERE id=?',id),event(env,id,principal,'member_left'),stmt(env,'DELETE FROM workspace_tx_assertions WHERE id=?',check)
 ]);await finishWorkspaceFloor(env,floor,'committed');return {left:true};
 }catch(e){if(/workspace_tx_assertions|valid=1|CHECK constraint failed/.test(e.message)){await finishWorkspaceFloor(env,floor,'cancelled');deny('workspace_changed_retry',409)}throw e;}
}
