CREATE TABLE IF NOT EXISTS account_notification_preferences(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),normal_enabled INTEGER NOT NULL DEFAULT 1 CHECK(normal_enabled IN(0,1)),important_enabled INTEGER NOT NULL DEFAULT 1 CHECK(important_enabled IN(0,1))
);
CREATE TABLE IF NOT EXISTS account_notifications(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),
 severity TEXT NOT NULL CHECK(severity IN('normal','important','critical')),
 code TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_notifications_owner ON account_notifications(account_id,created_at);
CREATE INDEX IF NOT EXISTS account_notifications_expiry ON account_notifications(created_at);
CREATE TABLE IF NOT EXISTS account_audit_events(
 id TEXT PRIMARY KEY,account_id TEXT,workspace_id TEXT,
 category TEXT NOT NULL CHECK(category IN('activity','security','execution')),
 code TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_audit_owner ON account_audit_events(account_id,created_at);
CREATE INDEX IF NOT EXISTS account_audit_workspace ON account_audit_events(workspace_id,created_at);
CREATE INDEX IF NOT EXISTS account_audit_expiry ON account_audit_events(category,created_at);
CREATE TABLE IF NOT EXISTS identity_maintenance_runs(
 name TEXT PRIMARY KEY,completed_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease TEXT,error TEXT
);
-- Notification content consists only of fixed event codes, never notes, keys,
-- bearer tokens, arbitrary client labels or approval URLs.
CREATE TRIGGER IF NOT EXISTS identity_login_notice AFTER INSERT ON account_sessions BEGIN
 INSERT INTO account_notifications SELECT lower(hex(randomblob(16))),NEW.account_id,'important','account.login',NEW.created_at,NULL WHERE COALESCE((SELECT important_enabled FROM account_notification_preferences WHERE account_id=NEW.account_id),1)=1;
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','account.login','ok',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_session_revoked_notice AFTER UPDATE OF revoked_at ON account_sessions WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),NEW.account_id,'critical','account.session_revoked',NEW.revoked_at,NULL);
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','account.session_revoked','ok',NEW.revoked_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_passkey_revoked_notice AFTER UPDATE OF revoked_at ON account_passkeys WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),NEW.account_id,'critical','account.passkey_revoked',NEW.revoked_at,NULL);
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','account.passkey_revoked','ok',NEW.revoked_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_oauth_revoked_notice AFTER UPDATE OF revoked_at ON oauth_grants WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),NEW.account_id,'critical','oauth.revoked',NEW.revoked_at,NULL);
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NULL,'security','oauth.revoked','ok',NEW.revoked_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_mcp_audit AFTER INSERT ON mcp_audit BEGIN
 INSERT INTO account_audit_events SELECT NEW.id,g.account_id,NEW.workspace,'activity',NEW.tool,NEW.status,NEW.created FROM oauth_grants g WHERE NEW.client='easybook-account:'||g.id;
END;
CREATE TRIGGER IF NOT EXISTS identity_approval_requested AFTER INSERT ON account_operation_approvals BEGIN
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NEW.workspace_id,'activity',NEW.tool,'approval_pending',NEW.created_at);
 INSERT INTO account_notifications SELECT lower(hex(randomblob(16))),NEW.account_id,'important','operation.approval_pending',NEW.created_at,NULL WHERE COALESCE((SELECT important_enabled FROM account_notification_preferences WHERE account_id=NEW.account_id),1)=1;
END;
CREATE TRIGGER IF NOT EXISTS identity_approval_executed AFTER UPDATE OF status ON account_operation_approvals WHEN OLD.status='pending' AND NEW.status<>'pending' BEGIN
 INSERT INTO account_audit_events VALUES(lower(hex(randomblob(16))),NEW.account_id,NEW.workspace_id,'activity',NEW.tool,NEW.status,COALESCE(NEW.completed_at,NEW.created_at));
 INSERT INTO account_notifications SELECT lower(hex(randomblob(16))),NEW.account_id,'critical','operation.permanent_delete',COALESCE(NEW.completed_at,NEW.created_at),NULL WHERE NEW.status='completed' AND NEW.tool IN('notes_permanent_delete','attachments_permanent_delete');
END;
CREATE TRIGGER IF NOT EXISTS identity_purge_failed AFTER UPDATE OF status ON attachment_purge_jobs WHEN OLD.status<>'failed' AND NEW.status='failed' BEGIN
 INSERT INTO account_notifications SELECT lower(hex(randomblob(16))),a.account_id,'critical','operation.cleanup_failed',NEW.updated_at,NULL FROM account_operation_approvals a WHERE a.id=NEW.approval_id;
 INSERT INTO account_audit_events SELECT lower(hex(randomblob(16))),a.account_id,NEW.workspace,'execution','attachment.cleanup','failed',NEW.updated_at FROM account_operation_approvals a WHERE a.id=NEW.approval_id;
END;
CREATE TRIGGER IF NOT EXISTS identity_workspace_security_notice AFTER INSERT ON workspace_security_events WHEN NEW.actor_account_id IS NOT NULL BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),NEW.actor_account_id,'critical','workspace.security_changed',NEW.created_at,NULL);
 INSERT INTO account_audit_events VALUES(NEW.id,NEW.actor_account_id,NULL,'security',NEW.event,'ok',NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS identity_member_removed_notice AFTER DELETE ON workspace_members BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),OLD.account_id,'critical','workspace.security_changed',CAST(strftime('%s','now') AS INTEGER)*1000,NULL);
END;
CREATE TRIGGER IF NOT EXISTS identity_member_role_notice AFTER UPDATE OF role ON workspace_members WHEN OLD.role<>NEW.role BEGIN
 INSERT INTO account_notifications VALUES(lower(hex(randomblob(16))),NEW.account_id,'critical','workspace.security_changed',CAST(strftime('%s','now') AS INTEGER)*1000,NULL);
END;
