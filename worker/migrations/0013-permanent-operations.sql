CREATE TABLE IF NOT EXISTS attachment_tombstones(
 workspace TEXT NOT NULL,attachment TEXT NOT NULL,approval_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,PRIMARY KEY(workspace,attachment)
);
CREATE TABLE IF NOT EXISTS attachment_purge_jobs(
 id TEXT PRIMARY KEY,approval_id TEXT NOT NULL,workspace TEXT NOT NULL,attachment TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','complete','failed')),
 cursor TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,error TEXT,
 UNIQUE(workspace,attachment)
);
CREATE INDEX IF NOT EXISTS attachment_purge_pending ON attachment_purge_jobs(status,lease_until);
-- Deny references racing with permanent deletion, including writes from offline
-- devices. Purged notes retain their terminal sync tombstone.
CREATE TRIGGER IF NOT EXISTS notes_attachment_tombstone_insert BEFORE INSERT ON notes_json WHEN NEW.purged=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_tree(NEW.document) j JOIN attachment_tombstones t ON j.value='sha256:'||t.attachment WHERE j.key='assetId' AND t.workspace=NEW.workspace) THEN RAISE(ABORT,'attachment permanently deleted') END;
END;
CREATE TRIGGER IF NOT EXISTS notes_attachment_tombstone_update BEFORE UPDATE ON notes_json WHEN NEW.purged=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_tree(NEW.document) j JOIN attachment_tombstones t ON j.value='sha256:'||t.attachment WHERE j.key='assetId' AND t.workspace=NEW.workspace) THEN RAISE(ABORT,'attachment permanently deleted') END;
END;
CREATE TRIGGER IF NOT EXISTS attachment_tombstone_terminal BEFORE DELETE ON attachment_tombstones BEGIN SELECT RAISE(ABORT,'permanent attachment tombstone'); END;
CREATE TRIGGER IF NOT EXISTS attachment_tombstone_immutable BEFORE UPDATE ON attachment_tombstones BEGIN SELECT RAISE(ABORT,'permanent attachment tombstone'); END;
