-- Independent browser connector tokens. No cookie, native session or login proof
-- is valid across servers or client origins. Raw codes and tokens are not stored.
CREATE TABLE IF NOT EXISTS account_web_logins(
 id TEXT PRIMARY KEY,challenge TEXT NOT NULL,state_hash TEXT NOT NULL,
 client_origin TEXT NOT NULL,redirect_uri TEXT NOT NULL,server_origin TEXT NOT NULL,
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 account_id TEXT REFERENCES accounts(id),approved_session_id TEXT REFERENCES account_sessions(id),
 code_hash TEXT,approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_web_login_expiry ON account_web_logins(expires_at);
CREATE TABLE IF NOT EXISTS account_web_sessions(
 session_id TEXT PRIMARY KEY REFERENCES account_sessions(id),client_origin TEXT NOT NULL,
 server_origin TEXT NOT NULL,created_at INTEGER NOT NULL
);
