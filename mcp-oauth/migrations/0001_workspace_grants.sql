CREATE TABLE IF NOT EXISTS mcp_workspace_grants (
 id TEXT PRIMARY KEY,
 github_user_id TEXT NOT NULL,
 oauth_client_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL CHECK(length(workspace_id)=64),
 scope TEXT NOT NULL DEFAULT 'mcp:read' CHECK(scope='mcp:read'),
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 UNIQUE(github_user_id,oauth_client_id,workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_grants_active ON mcp_workspace_grants(github_user_id,oauth_client_id,revoked_at);
CREATE TABLE IF NOT EXISTS mcp_active_workspaces (
 github_user_id TEXT NOT NULL,
 oauth_client_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(github_user_id,oauth_client_id)
);
CREATE TABLE IF NOT EXISTS mcp_pairing_challenges (
 challenge_hash TEXT PRIMARY KEY,
 github_user_id TEXT NOT NULL,
 oauth_client_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mcp_pairing_expiry ON mcp_pairing_challenges(expires_at);
