-- Durable, encrypted, short-lived Agent tool-call batches.
-- Ciphertext is AES-256-GCM bound to the account and per-run ID.
CREATE TABLE IF NOT EXISTS ai_agent_run_queue(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 state_ciphertext TEXT NOT NULL,
 state_iv TEXT NOT NULL,
 lease_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_agent_run_queue_account
 ON ai_agent_run_queue(account_id,expires_at);
