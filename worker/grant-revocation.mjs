import {reserveRevocations,finishRevocations} from './security-checkpoint.mjs';
export async function revokeWorkspaceGrant(env,accountId,id,workspace){
 if(!/^[a-f0-9-]{36}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(workspace||''))return false;
 if(!await env.DB.prepare('SELECT 1 FROM oauth_grants g JOIN oauth_grant_workspaces c ON c.policy_id=g.id WHERE g.id=? AND g.account_id=? AND c.workspace_id=? AND g.revoked_at IS NULL AND c.revoked_at IS NULL').bind(id,accountId,workspace).first())return false;
 const intent=await reserveRevocations(env,[['oauth',id+':'+workspace]]);
 await env.DB.prepare('UPDATE oauth_grant_workspaces SET revoked_at=? WHERE policy_id=? AND workspace_id=?').bind(Date.now(),id,workspace).run();await finishRevocations(env,intent,'committed');return true;
}
