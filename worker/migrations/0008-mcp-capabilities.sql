-- Additive MCP control-plane metadata. Existing notes and sync feeds are untouched.
CREATE TABLE IF NOT EXISTS mcp_client_permissions(workspace TEXT NOT NULL,client TEXT NOT NULL,scopes TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(workspace,client));
CREATE TABLE IF NOT EXISTS mcp_approvals(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,client TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,expires INTEGER NOT NULL,approved INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS mcp_approvals_expiry ON mcp_approvals(expires);
CREATE TABLE IF NOT EXISTS mcp_downloads(token_hash TEXT PRIMARY KEY,workspace TEXT NOT NULL,client TEXT NOT NULL,attachment TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mcp_downloads_expiry ON mcp_downloads(expires);
CREATE TABLE IF NOT EXISTS mcp_attachment_retirements(workspace TEXT NOT NULL,attachment TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(workspace,attachment));
CREATE TABLE IF NOT EXISTS mcp_audit(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,client TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mcp_audit_space ON mcp_audit(workspace,created);
CREATE INDEX IF NOT EXISTS mcp_notes_recent ON notes_json(workspace,deleted,purged,updated,id);
-- Derived counts only, not a parallel task store. Old documents are indexed in bounded pages on demand.
CREATE TABLE IF NOT EXISTS mcp_note_metrics(workspace TEXT NOT NULL,note_id TEXT NOT NULL,version INTEGER NOT NULL,total INTEGER NOT NULL,completed INTEGER NOT NULL,PRIMARY KEY(workspace,note_id));
CREATE TRIGGER IF NOT EXISTS mcp_metrics_insert AFTER INSERT ON notes_json BEGIN
 INSERT OR REPLACE INTO mcp_note_metrics(workspace,note_id,version,total,completed) SELECT NEW.workspace,NEW.id,NEW.version,COUNT(*),COALESCE(SUM(json_extract(value,'$.attrs.checked')=1),0) FROM json_tree(NEW.document) WHERE type='object' AND json_extract(value,'$.type')='taskItem';
END;
CREATE TRIGGER IF NOT EXISTS mcp_metrics_update AFTER UPDATE ON notes_json BEGIN
 INSERT OR REPLACE INTO mcp_note_metrics(workspace,note_id,version,total,completed) SELECT NEW.workspace,NEW.id,NEW.version,COUNT(*),COALESCE(SUM(json_extract(value,'$.attrs.checked')=1),0) FROM json_tree(NEW.document) WHERE type='object' AND json_extract(value,'$.type')='taskItem';
END;
