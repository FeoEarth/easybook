-- QR cross-device login staging only. No production route uses this table until the full
-- initiator-bound challenge, authenticated approval and one-time redemption ship together.
CREATE TABLE IF NOT EXISTS account_qr_logins (
  id_hash TEXT PRIMARY KEY,
  initiator_kind TEXT NOT NULL CHECK (initiator_kind IN ('web','android')),
  challenge TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_account_id TEXT REFERENCES accounts(id),
  approved_session_id TEXT REFERENCES account_sessions(id),
  approved_at INTEGER,
  consumed_at INTEGER,
  cancelled_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK ((approved_account_id IS NULL AND approved_session_id IS NULL AND approved_at IS NULL)
      OR (approved_account_id IS NOT NULL AND approved_session_id IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_account_qr_expiry ON account_qr_logins(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_qr_approved_session ON account_qr_logins(approved_session_id);
