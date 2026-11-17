CREATE TABLE IF NOT EXISTS account_ai_preferences (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 data_json TEXT NOT NULL
);
