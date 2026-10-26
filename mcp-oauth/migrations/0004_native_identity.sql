-- Additive native/browser handoff. Raw codes/tokens/verifiers are never stored.
CREATE TABLE IF NOT EXISTS account_login_handoffs(
 id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('native','browser')),
 challenge TEXT NOT NULL,state_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,
 account_id TEXT,approved_session_id TEXT,code_hash TEXT,approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_login_handoff_expiry ON account_login_handoffs(expires_at);
CREATE TABLE IF NOT EXISTS account_native_sessions(
 session_id TEXT PRIMARY KEY REFERENCES account_sessions(id),created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_passkey_rps(
 credential_id TEXT PRIMARY KEY REFERENCES account_passkeys(id),rp_id TEXT NOT NULL
);
