-- Account-scoped BYOK credentials. API keys are encrypted by the Worker before
-- they reach D1; the key-encryption key is supplied as AI_CREDENTIAL_KEY.
CREATE TABLE IF NOT EXISTS account_ai_credentials(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider='openai'),
 provider_name TEXT NOT NULL DEFAULT 'OpenAI',
 base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
 key_ciphertext TEXT NOT NULL,
 key_iv TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);

