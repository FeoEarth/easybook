-- Additive WebAuthn records. Private keys remain with the user's authenticator.
CREATE TABLE IF NOT EXISTS account_passkeys(
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), public_key TEXT NOT NULL,
 counter INTEGER NOT NULL, transports TEXT NOT NULL, device_type TEXT NOT NULL,
 backed_up INTEGER NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_passkeys_owner ON account_passkeys(account_id,revoked_at);
CREATE TABLE IF NOT EXISTS account_passkey_challenges(
 browser_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, purpose TEXT NOT NULL,
 account_id TEXT, session_id TEXT, display_name TEXT, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_passkey_challenge_expiry ON account_passkey_challenges(expires_at);
CREATE TABLE IF NOT EXISTS account_session_passkeys(session_id TEXT PRIMARY KEY REFERENCES account_sessions(id),credential_id TEXT NOT NULL REFERENCES account_passkeys(id));
CREATE INDEX IF NOT EXISTS account_passkey_sessions ON account_session_passkeys(credential_id);

CREATE TABLE IF NOT EXISTS account_identity_link_requests(state_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
