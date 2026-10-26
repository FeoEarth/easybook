-- Add only missing lifecycle audit events. No note, key, token or payload is logged.
CREATE TRIGGER IF NOT EXISTS identity_passkey_added_audit AFTER INSERT ON account_passkeys BEGIN
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','account.passkey_added','ok',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_oauth_authorized_audit AFTER INSERT ON oauth_grants BEGIN
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','oauth.authorized','ok',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_child_revoked_audit AFTER UPDATE OF revoked_at ON oauth_grant_workspaces WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO account_audit_events SELECT lower(hex(randomblob(16))),g.account_id,NULL,'security','oauth.workspace_revoked','ok',NEW.revoked_at FROM oauth_grants g WHERE g.id=NEW.policy_id;
END;
