import {modernWorkspaces,policyWorkspace} from './oauth-workspace-policy.mjs';
// Internal client namespace binds derived upload/download tickets and confirmations to one grant.
const prefix='easybook-account:';
export const grantClient=id=>prefix+id;
export const accountPolicyId=client=>typeof client==='string'&&/^easybook-account:[a-f0-9-]{36}$/.test(client)?client.slice(prefix.length):null;
export async function accountGrant(env,workspace,client){
 const id=accountPolicyId(client);if(!id)return null;
 if(modernWorkspaces(env))return policyWorkspace(env,id,workspace);
 return env.DB.prepare('SELECT g.id,g.scopes FROM oauth_grants g JOIN accounts a ON a.id=g.account_id JOIN workspace_memberships m ON m.account_id=g.account_id AND m.workspace_id=g.workspace_id WHERE g.id=? AND g.workspace_id=? AND g.revoked_at IS NULL AND a.deleted_at IS NULL AND m.revoked_at IS NULL').bind(id,workspace).first();
}
export async function hasWorkspaceGrant(env,workspace,client){
 if(accountPolicyId(client))return accountGrant(env,workspace,client);
 if(modernWorkspaces(env))return null;
 return env.DB.prepare('SELECT id FROM mcp_workspace_grants WHERE workspace_id=? AND oauth_client_id=? AND revoked_at IS NULL').bind(workspace,client).first();
}

