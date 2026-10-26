import {initializeCheckpoint,beginSecurityRestore,reconcileSecurityRestore,openSecurityRestore,checkpointEnabled} from './security-checkpoint.mjs';
// Administrative intent comes only from operator-controlled Worker configuration.
// This is a cron entry, never an HTTP endpoint, bridge command or MCP tool.
export async function runSecurityAdmin(env){
 const action=env.SECURITY_ADMIN_ACTION;if(!action)return false;
 const id=env.SECURITY_ADMIN_REQUEST,epoch=env.SECURITY_ADMIN_EPOCH;
 if(!checkpointEnabled(env)||!env.SECURITY_DB||!['initialize','begin-restore','reconcile','open'].includes(action)||typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid security administration configuration');
 if(['reconcile','open'].includes(action)&&(typeof epoch!=='string'||!/^[a-f0-9-]{36}$/.test(epoch)))throw Error('Security administration requires an exact epoch');
 const db=env.SECURITY_DB.withSession?env.SECURITY_DB.withSession('first-primary'):env.SECURITY_DB;
 if(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").first())throw Error('Security administration requires an independent database');
 const claimed=await db.prepare("INSERT INTO security_admin_runs(id,action,status,created_at) VALUES(?,?,'running',?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(id,action,Date.now()).first();
 if(!claimed){const previous=await db.prepare('SELECT action FROM security_admin_runs WHERE id=?').bind(id).first();if(previous?.action!==action)throw Error('Security administration request ID reused');return true;} // A duplicate cron never repeats a privileged action.
 try{
  const result=action==='initialize'?await initializeCheckpoint(env):action==='begin-restore'?await beginSecurityRestore(env):action==='reconcile'?await reconcileSecurityRestore(env,epoch):await openSecurityRestore(env,epoch);
  await db.prepare("UPDATE security_admin_runs SET status='complete',completed_at=?,result=? WHERE id=? AND status='running'").bind(Date.now(),JSON.stringify(result),id).run();
 }catch{
  // Crashes/unknown outcomes require inspection. A new config nonce must never
  // silently rerun initialization or change the restore epoch again.
  await db.prepare("UPDATE security_admin_runs SET status='uncertain',error='OPERATOR_REVIEW_REQUIRED' WHERE id=? AND status='running'").bind(id).run();
  throw Error('Security administration requires operator review');
 }
 return true;
}
