-- Additive folder OCC. Existing rows start at version 1; legacy clients remain
-- accepted by the compatibility path until the supported-client floor advances.
CREATE TABLE IF NOT EXISTS folder_revisions(
 workspace TEXT NOT NULL,folder_id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),mutation TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(workspace,folder_id)
);
CREATE TABLE IF NOT EXISTS folder_receipts(
 workspace TEXT NOT NULL,mutation TEXT NOT NULL,folder_id TEXT NOT NULL,response TEXT NOT NULL,
 PRIMARY KEY(workspace,mutation)
);
