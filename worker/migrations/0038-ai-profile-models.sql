ALTER TABLE account_ai_profiles ADD COLUMN models_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE account_ai_profiles ADD COLUMN models_updated_at INTEGER NOT NULL DEFAULT 0;
