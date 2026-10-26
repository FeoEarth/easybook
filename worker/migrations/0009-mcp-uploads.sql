-- Upload control-plane only. Files remain in the existing R2 v2 manifest/chunk store.
CREATE TABLE IF NOT EXISTS mcp_uploads(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,client TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,expected_sha TEXT,provenance TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',created INTEGER NOT NULL,expires INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,attachment_id TEXT,error TEXT,UNIQUE(workspace,client,request_id));
CREATE INDEX IF NOT EXISTS mcp_uploads_expiry ON mcp_uploads(status,expires);
CREATE INDEX IF NOT EXISTS mcp_uploads_space ON mcp_uploads(workspace,status);
CREATE TABLE IF NOT EXISTS mcp_upload_budgets(workspace TEXT NOT NULL,day INTEGER NOT NULL,requests INTEGER NOT NULL,reserved_bytes INTEGER NOT NULL,PRIMARY KEY(workspace,day));
