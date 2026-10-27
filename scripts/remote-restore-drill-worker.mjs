// Temporary operator-only harness. Bind exclusively to disposable resources
// carrying the same drill marker. Never bind production security or business D1.
import {createHash,timingSafeEqual} from 'node:crypto';
import {snapshot,verifyStored} from '../backup-worker/index.mjs';
import {createWorkspace,convertToShared,setWorkspaceMember,rotateWorkspaceKey,resolveWorkspaceKey,workspaceAccess,transferWorkspaceManager} from '../worker/workspace-identity.mjs';
import {initializeCheckpoint,requireRestoreAccess,beginSecurityRestore,reconcileSecurityRestore,openSecurityRestore,reserveRevocations,finishRevocations,accountAllowed,revoked} from '../worker/security-checkpoint.mjs';
import {deleteWorkspace} from '../worker/workspace-delete.mjs';
import {createSession,sessionToken} from '../mcp-oauth/src/accounts.mjs';
import {workspacePolicy} from '../worker/oauth-workspace-policy.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function check(value,message){if(!value)throw Error(message);}
async function rejects(fn,code){try{await fn();throw Error('expected_rejection_'+code);}catch(error){check(error.code===code || error.message===code,'wrong_rejection_'+code);}}
async function marker(db,env){const row=await db.prepare('SELECT marker FROM drill_disposable_marker WHERE id=1').first();check(env.DRILL_CONFIRMATION==='SYNTHETIC_ONLY'&&row?.marker===env.DRILL_MARKER,'disposable_marker_required');}
export async function prepare(env){
 const base={...env,DB:env.SOURCE_DB,WORKSPACE_IDENTITY_V2:'true'};
 await marker(env.SOURCE_DB,env);await marker(env.SECURITY_DB,env);
 check(!await env.TEST_OBJECTS.get('fixture.json'),'drill_already_prepared');
 check(!await base.DB.prepare('SELECT 1 FROM accounts LIMIT 1').first(),'source_not_empty');
 const alice={kind:'account',accountId:crypto.randomUUID()},bob={kind:'account',accountId:crypto.randomUUID()};
 for(const a of [alice,bob])await base.DB.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').bind(a.accountId,'Synthetic restore fixture',Date.now()).run();
 const personal=await createWorkspace(base,'Synthetic personal',alice),shared=await createWorkspace(base,'Synthetic shared',bob),transfer=await createWorkspace(base,'Synthetic transfer',bob),deleted=await createWorkspace(base,'Synthetic deleted',alice),unaffected=await createWorkspace(base,'Synthetic anonymous');
 await convertToShared(base,shared.workspace.id,bob,{confirm:true,firstAccountId:alice.accountId,role:'editor'});
 await convertToShared(base,transfer.workspace.id,bob,{confirm:true,firstAccountId:alice.accountId,role:'editor'});
 await initializeCheckpoint(base);const active={...base,SECURITY_CHECKPOINT_V2:'true'};
 const passkey='synthetic-passkey';await base.DB.prepare('INSERT INTO account_passkeys VALUES(?,?,?,0,?,?,0,?,?,NULL,NULL)').bind(passkey,alice.accountId,'synthetic-not-a-real-public-key','[]','singleDevice','Fixture',Date.now()).run();
 const session=await createSession(new Request('https://easybook.loonxy.com'),active,alice.accountId,passkey);
 const policy=crypto.randomUUID(),scopes=['notes.read','notes.write'];
 await base.DB.prepare('INSERT INTO oauth_grants(id,account_id,client_id,workspace_id,scopes,created_at) VALUES(?,?,?,?,?,?)').bind(policy,alice.accountId,'synthetic-client',personal.workspace.id,JSON.stringify(scopes),Date.now()).run();
 await base.DB.prepare('INSERT INTO oauth_grant_workspaces VALUES(?,?,?,?,NULL)').bind(policy,personal.workspace.id,JSON.stringify(scopes),Date.now()).run();
 const bytes=new TextEncoder().encode('Synthetic remote restore attachment'),attachment=sha(bytes),objectKey=personal.workspace.id+'/'+attachment;
 await env.TEST_OBJECTS.put('legacy-object',bytes,{customMetadata:{name:'synthetic.txt',mime:'text/plain'}});
 await base.DB.prepare('INSERT INTO notes_json(workspace,id,title,document,icon,favorite,deleted,version,mutation,updated) VALUES(?,?,?,?,?,0,0,1,?,?)').bind(personal.workspace.id,crypto.randomUUID(),'Synthetic',JSON.stringify({schemaVersion:1,doc:{type:'doc',content:[{type:'attachment',attrs:{assetId:'sha256:'+attachment}}]}}),'📄',crypto.randomUUID(),Date.now()).run();
 const dump=await snapshot(active);await env.TEST_OBJECTS.put('old-business.sql',dump.sql);
 await rotateWorkspaceKey(active,personal.workspace.id,alice);
 await setWorkspaceMember(active,shared.workspace.id,bob,alice.accountId,null);
 await transferWorkspaceManager(active,transfer.workspace.id,bob,alice.accountId,{confirm:true});
 await deleteWorkspace(active,deleted.workspace.id,{...alice,sessionId:session.id,authenticatedAt:Date.now()},{confirm:'DELETE',version:deleted.workspace.version});
 const intent=await reserveRevocations(active,[['account',alice.accountId],['session',session.id],['passkey',passkey],['oauth',policy]]);await finishRevocations(active,intent,'committed');
 const restore=await beginSecurityRestore(active);
 const fixture={alice,bob,personal,shared,transfer,deleted,unaffected,session,passkey,policy,restore,objectKey,attachment,size:bytes.length,sqlSha256:sha(dump.sql)};
 await env.TEST_OBJECTS.put('fixture.json',JSON.stringify(fixture));
 return {status:'prepared',sqlKey:'old-business.sql',sqlSha256:fixture.sqlSha256,restoreGate:'blocked',syntheticOnly:true};
}
export async function verify(env){
 await marker(env.RESTORED_DB,env);await marker(env.SECURITY_DB,env);
 const f=await (await env.TEST_OBJECTS.get('fixture.json')).json(),active={...env,DB:env.RESTORED_DB,WORKSPACE_IDENTITY_V2:'true',SECURITY_CHECKPOINT_V2:'true'};
 const previous=await env.TEST_OBJECTS.get('result.json');
 if(!previous){
  await rejects(()=>requireRestoreAccess(active),'security_restore_locked');
  await rejects(()=>openSecurityRestore(active,f.restore.epoch),'restore_not_reconciled');
  await rejects(()=>reconcileSecurityRestore(active,'wrong'),'restore_epoch_mismatch');
  await reconcileSecurityRestore(active,f.restore.epoch);await openSecurityRestore(active,f.restore.epoch);
 }
 await requireRestoreAccess(active);
 check(!await accountAllowed(active,f.alice.accountId),'deleted_account_revived');
 check(await sessionToken(f.session.token,active)===null,'session_revived');
 check(await revoked(active,'passkey',f.passkey),'passkey_revived');
 check(await workspacePolicy(active,f.policy)===null,'oauth_revived');
 check(await resolveWorkspaceKey(active,f.personal.key)===null,'old_key_revived');
 check(await workspaceAccess(active,f.shared.workspace.id,f.alice)===null,'member_revived');
 check(await workspaceAccess(active,f.transfer.workspace.id,f.bob)===null,'old_manager_revived');
 check(await resolveWorkspaceKey(active,f.deleted.key)===null,'deleted_workspace_revived');
 check(!!await resolveWorkspaceKey(active,f.unaffected.key),'unaffected_anonymous_denied');
 const object={key:f.objectKey,storageKey:'legacy-object',sha256:f.attachment,size:f.size};
 const manifest={objects:[object]},storage={BACKUPS:env.TEST_OBJECTS};
 await verifyStored(storage,manifest,[f.objectKey]);
 if(!previous){
  const saved=await (await env.TEST_OBJECTS.get('legacy-object')).arrayBuffer();
  await env.TEST_OBJECTS.delete('legacy-object');await rejects(()=>verifyStored(storage,manifest,[f.objectKey]),'object_missing_or_oversize');
  await env.TEST_OBJECTS.put('legacy-object','corrupt');await rejects(()=>verifyStored(storage,manifest,[f.objectKey]),'object_corrupt');
  await env.TEST_OBJECTS.put('legacy-object',saved);
 }
 const result={status:'passed',syntheticOnly:true,repeatedVerification:!!previous,checks:['remote_sql_import','recovery_gate','wrong_epoch_denied','deleted_account','revoked_session','revoked_passkey','revoked_oauth','rotated_key','removed_member','transferred_manager','deleted_workspace','anonymous_workspace','attachment_hash','missing_attachment_denied','corrupt_attachment_denied']};
 await env.TEST_OBJECTS.put('result.json',JSON.stringify(result));return result;
}
export default {async fetch(request,env){
 const hash=value=>createHash('sha256').update(value).digest();
 if(request.method!=='POST'||!env.BOOTSTRAP_TOKEN||!timingSafeEqual(hash(request.headers.get('Authorization')||''),hash('Bearer '+env.BOOTSTRAP_TOKEN)))return new Response('Not found',{status:404});
 try{const path=new URL(request.url).pathname;return path==='/prepare'?Response.json(await prepare(env)):path==='/verify'?Response.json(await verify(env)):new Response('Not found',{status:404});}catch(error){return Response.json({error:/^[a-z_]+$/.test(error.message)?error.message:'drill_failed'},{status:503});}
}};
