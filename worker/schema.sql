-- Additive development-stage schema. Never drops or imports legacy HTML notes.
CREATE TABLE IF NOT EXISTS notes_json (
 workspace TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,document TEXT NOT NULL CHECK(json_valid(document)),
 icon TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),favorite INTEGER NOT NULL CHECK(favorite IN (0,1)),deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
 purged INTEGER NOT NULL DEFAULT 0 CHECK(purged IN (0,1)),
 folder_id TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL CHECK(version>0),mutation TEXT NOT NULL,updated INTEGER NOT NULL,
 PRIMARY KEY(workspace,id)
);
CREATE TABLE IF NOT EXISTS folders(workspace TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,updated INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS note_receipts (
 workspace TEXT NOT NULL,mutation TEXT NOT NULL,note_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,
 PRIMARY KEY(workspace,mutation)
);
CREATE TABLE IF NOT EXISTS note_changes (
 cursor INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT NOT NULL,note_id TEXT NOT NULL,note_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS note_changes_space ON note_changes(workspace,cursor);
-- Trigger makes receipt and feed atomic with each CAS write, even across concurrent requests.
CREATE TRIGGER IF NOT EXISTS notes_json_insert AFTER INSERT ON notes_json BEGIN
 INSERT INTO note_changes(workspace,note_id,note_version) VALUES(NEW.workspace,NEW.id,NEW.version);
END;
CREATE TRIGGER IF NOT EXISTS notes_json_update AFTER UPDATE ON notes_json BEGIN
 INSERT INTO note_changes(workspace,note_id,note_version) VALUES(NEW.workspace,NEW.id,NEW.version);
END;

