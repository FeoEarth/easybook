-- Additive metadata only: no note, folder or attachment row is rewritten.
CREATE TABLE IF NOT EXISTS management_state(workspace TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0,items TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS management_receipts(workspace TEXT NOT NULL,mutation TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(workspace,mutation));
