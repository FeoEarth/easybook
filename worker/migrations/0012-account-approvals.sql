-- Durable operation state is independent of expiring activity logs.
CREATE TABLE IF NOT EXISTS account_operation_approvals(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
 policy_id TEXT NOT NULL REFERENCES oauth_grants(id),client_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),scope TEXT NOT NULL,
 tool TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
 payload_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','completed','conflict','cancelled')),
 result TEXT,completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_operation_pending ON account_operation_approvals(account_id,status,expires_at);
-- Shared across OAuth clients: splitting writes between clients cannot bypass it.
CREATE TABLE IF NOT EXISTS account_operation_budget(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL,workspace_id TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_operation_budget_window ON account_operation_budget(account_id,workspace_id,created_at);
