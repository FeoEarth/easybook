-- Apply after 0010 workspace identity. No key, note or attachment data is moved.
CREATE TABLE IF NOT EXISTS oauth_grant_workspaces(
 policy_id TEXT NOT NULL REFERENCES oauth_grants(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 scopes TEXT NOT NULL CHECK(json_valid(scopes)),created_at INTEGER NOT NULL,revoked_at INTEGER,
 PRIMARY KEY(policy_id,workspace_id)
);
CREATE INDEX IF NOT EXISTS oauth_workspace_policies ON oauth_grant_workspaces(workspace_id,revoked_at);
CREATE TABLE IF NOT EXISTS oauth_active_workspaces(
 policy_id TEXT PRIMARY KEY REFERENCES oauth_grants(id),workspace_id TEXT NOT NULL,
 FOREIGN KEY(policy_id,workspace_id) REFERENCES oauth_grant_workspaces(policy_id,workspace_id)
);
-- A later role increase must never revive an old authorization. A changed child
-- grant requires fresh consent; unrelated workspaces on the same policy survive.
CREATE TRIGGER IF NOT EXISTS oauth_membership_role_changed AFTER UPDATE OF role ON workspace_members WHEN OLD.role<>NEW.role BEGIN
 UPDATE oauth_grant_workspaces SET revoked_at=COALESCE(revoked_at,CAST(strftime('%s','now') AS INTEGER)*1000)
 WHERE workspace_id=NEW.workspace_id AND policy_id IN(SELECT id FROM oauth_grants WHERE account_id=NEW.account_id);
END;
CREATE TRIGGER IF NOT EXISTS oauth_membership_removed AFTER DELETE ON workspace_members BEGIN
 UPDATE oauth_grant_workspaces SET revoked_at=COALESCE(revoked_at,CAST(strftime('%s','now') AS INTEGER)*1000)
 WHERE workspace_id=OLD.workspace_id AND policy_id IN(SELECT id FROM oauth_grants WHERE account_id=OLD.account_id);
END;
CREATE TRIGGER IF NOT EXISTS oauth_workspace_security_changed AFTER UPDATE OF mode,manager_account_id,deleted_at ON workspaces BEGIN
 UPDATE oauth_grant_workspaces SET revoked_at=COALESCE(revoked_at,CAST(strftime('%s','now') AS INTEGER)*1000)
 WHERE workspace_id=NEW.id AND (OLD.mode<>NEW.mode OR NEW.deleted_at IS NOT NULL OR
 (OLD.manager_account_id IS NOT NEW.manager_account_id AND policy_id IN(SELECT id FROM oauth_grants WHERE account_id IN(OLD.manager_account_id,NEW.manager_account_id))));
END;
