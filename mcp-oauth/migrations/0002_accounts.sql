-- Additive, retryable. OAuth cryptographic records remain in the existing Provider KV.
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS account_identities(provider TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), PRIMARY KEY(provider,subject));
CREATE TABLE IF NOT EXISTS account_sessions(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL REFERENCES accounts(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, authenticated_at INTEGER NOT NULL, device TEXT NOT NULL, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS account_session_owner ON account_sessions(account_id,expires_at);
CREATE TABLE IF NOT EXISTS account_login_states(state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_memberships(workspace_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id), role TEXT NOT NULL CHECK(role IN ('owner','member')), created_at INTEGER NOT NULL, revoked_at INTEGER, PRIMARY KEY(workspace_id,account_id));
CREATE UNIQUE INDEX IF NOT EXISTS workspace_single_owner ON workspace_memberships(workspace_id) WHERE role='owner' AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS account_workspace_claims(challenge_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_grants(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, client_id TEXT NOT NULL, workspace_id TEXT NOT NULL, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER, provider_grant_id TEXT);
CREATE INDEX IF NOT EXISTS oauth_grant_owner ON oauth_grants(account_id,created_at);
CREATE TABLE IF NOT EXISTS oauth_token_uses(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_grant_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS account_rate_limits(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS oauth_issued_tokens(token_hash TEXT PRIMARY KEY, policy_id TEXT NOT NULL, client_id TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS account_rate_expiry ON account_rate_limits(expires_at);
