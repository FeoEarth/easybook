-- Multiple encrypted BYOK profiles. The legacy single-row table remains intact
-- and is imported lazily so existing accounts keep working during rollout.
CREATE TABLE IF NOT EXISTS account_ai_profiles(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 80),
 provider TEXT NOT NULL,
 protocol TEXT NOT NULL CHECK(protocol IN ('openai','anthropic')),
 provider_name TEXT NOT NULL,
 base_url TEXT NOT NULL,
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
 key_ciphertext TEXT NOT NULL,
 key_iv TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_ai_profiles_account ON account_ai_profiles(account_id,active DESC,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS account_ai_profiles_one_active ON account_ai_profiles(account_id) WHERE active=1;
