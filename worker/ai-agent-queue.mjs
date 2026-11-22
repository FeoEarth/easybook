// Durable, account- and workspace-scoped research execution checkpoints.
// The caller encrypts state (including model context and any read-tool results)
// before it reaches D1. Leases prevent duplicate concurrent resumes.
const TTL_MS=60*60*1000,LEASE_MS=90*1000;
export async function ensureAgentQueue(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_agent_run_queue(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,workspace_id TEXT NOT NULL,state_ciphertext TEXT NOT NULL,state_iv TEXT NOT NULL,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)").run();
 await env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_agent_run_queue_account ON ai_agent_run_queue(account_id,expires_at)").run();
}
export async function createAgentQueue(env,account,workspace,id,lease,encrypted){
 const now=Date.now();
 await ensureAgentQueue(env);
 await env.DB.prepare('DELETE FROM ai_agent_run_queue WHERE expires_at<?').bind(now).run();
 const active=await env.DB.prepare('SELECT count(*) AS n FROM ai_agent_run_queue WHERE account_id=? AND expires_at>?').bind(account,now).first();
 if((active?.n||0)>=4)throw Object.assign(Error('Too many active Agent research tasks'),{code:'agent_queue_limit',status:429});
 await env.DB.prepare('INSERT INTO ai_agent_run_queue(id,account_id,workspace_id,state_ciphertext,state_iv,lease_id,lease_until,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .bind(id,account,workspace,encrypted.ciphertext,encrypted.iv,lease,now+LEASE_MS,now+TTL_MS,now,now).run();
 return id;
}
export async function claimAgentQueue(env,account,workspace,id,lease){
 await ensureAgentQueue(env);
 const now=Date.now();
 const row=await env.DB.prepare('UPDATE ai_agent_run_queue SET lease_id=?,lease_until=?,updated_at=? WHERE id=? AND account_id=? AND workspace_id=? AND expires_at>? AND (lease_until<? OR lease_id IS NULL) RETURNING state_ciphertext,state_iv')
  .bind(lease,now+LEASE_MS,now,id,account,workspace,now,now).first();
 if(row)return row;
 const exists=await env.DB.prepare('SELECT id FROM ai_agent_run_queue WHERE id=? AND account_id=? AND workspace_id=? AND expires_at>?')
  .bind(id,account,workspace,now).first();
 throw Object.assign(Error(exists?'Agent research task is already running':'Agent research task expired'),{code:exists?'agent_queue_busy':'agent_queue_expired',status:exists?409:404});
}
export async function checkpointAgentQueue(env,account,workspace,id,lease,encrypted){
 const now=Date.now();
 const saved=await env.DB.prepare('UPDATE ai_agent_run_queue SET state_ciphertext=?,state_iv=?,lease_id=NULL,lease_until=0,expires_at=?,updated_at=? WHERE id=? AND account_id=? AND workspace_id=? AND lease_id=? AND expires_at>? RETURNING id')
  .bind(encrypted.ciphertext,encrypted.iv,now+TTL_MS,now,id,account,workspace,lease,now).first();
 if(!saved)throw Object.assign(Error('Research task lease was lost'),{code:'agent_queue_conflict',status:409});
}
export async function finishAgentQueue(env,account,workspace,id,lease){
 const done=await env.DB.prepare('DELETE FROM ai_agent_run_queue WHERE id=? AND account_id=? AND workspace_id=? AND lease_id=? RETURNING id')
  .bind(id,account,workspace,lease).first();
 if(!done)throw Object.assign(Error('Research task lease was lost'),{code:'agent_queue_conflict',status:409});
}
export async function releaseAgentQueue(env,account,workspace,id,lease){
 await env.DB.prepare('UPDATE ai_agent_run_queue SET lease_id=NULL,lease_until=0 WHERE id=? AND account_id=? AND workspace_id=? AND lease_id=?')
  .bind(id,account,workspace,lease).run();
}
