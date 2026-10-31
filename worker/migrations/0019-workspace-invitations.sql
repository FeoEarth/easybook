-- Invitations are account-bound or single-use bearer links; neither grants
-- access until the invited account explicitly accepts.
CREATE TABLE IF NOT EXISTS workspace_invitations (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 created_by TEXT NOT NULL REFERENCES accounts(id),
 invited_account_id TEXT REFERENCES accounts(id),
 token_hash TEXT UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('editor','reader')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','revoked')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 responded_at INTEGER,
 accepted_by TEXT REFERENCES accounts(id),
 CHECK((invited_account_id IS NULL) != (token_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS workspace_invites_inbox ON workspace_invitations(invited_account_id,status,expires_at);
CREATE INDEX IF NOT EXISTS workspace_invites_workspace ON workspace_invitations(workspace_id,status,expires_at);
CREATE TRIGGER IF NOT EXISTS workspace_invites_mode_revoke AFTER UPDATE OF mode ON workspaces
 WHEN NEW.mode<>OLD.mode BEGIN
 UPDATE workspace_invitations SET status='revoked',responded_at=unixepoch()*1000
 WHERE workspace_id=NEW.id AND status='pending';
END;
CREATE TRIGGER IF NOT EXISTS workspace_invites_manager_revoke AFTER UPDATE OF manager_account_id ON workspaces
 WHEN NEW.manager_account_id IS NOT OLD.manager_account_id BEGIN
 UPDATE workspace_invitations SET status='revoked',responded_at=unixepoch()*1000
 WHERE workspace_id=NEW.id AND status='pending';
END;
CREATE TRIGGER IF NOT EXISTS workspace_invites_delete_revoke AFTER UPDATE OF deleted_at ON workspaces
 WHEN NEW.deleted_at IS NOT NULL BEGIN
 UPDATE workspace_invitations SET status='revoked',responded_at=unixepoch()*1000
 WHERE workspace_id=NEW.id AND status='pending';
END;
