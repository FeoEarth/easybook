CREATE TABLE IF NOT EXISTS workspace_deletion_jobs(
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN('queued','running','complete','failed')),
 cursor TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,error TEXT
);
CREATE INDEX IF NOT EXISTS workspace_deletion_pending ON workspace_deletion_jobs(status,lease_until);
