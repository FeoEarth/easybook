-- Apply after account migrations 0002/0003. Additive: content and R2 paths stay put.
CREATE TABLE IF NOT EXISTS workspaces (
 id TEXT PRIMARY KEY CHECK(length(id)=64),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
 mode TEXT NOT NULL DEFAULT 'personal' CHECK(mode IN ('personal','shared')),
 manager_account_id TEXT REFERENCES accounts(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at INTEGER NOT NULL,
 deleted_at INTEGER,
 CHECK(mode='personal' OR manager_account_id IS NOT NULL)
);
-- The manager is a single pointer on workspaces, never a duplicated member role.
CREATE TABLE IF NOT EXISTS workspace_members (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 role TEXT NOT NULL CHECK(role IN ('editor','reader')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,account_id)
);
CREATE INDEX IF NOT EXISTS workspace_member_account ON workspace_members(account_id,workspace_id);
-- One current key. Revoked hashes are tombstones, never alternative access keys.
CREATE TABLE IF NOT EXISTS workspace_keys (
 key_hash TEXT PRIMARY KEY CHECK(length(key_hash)=64),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 created_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_current_key ON workspace_keys(workspace_id) WHERE revoked_at IS NULL;
-- Assertion statements fail the entire D1.batch on stale state or lost authority.
CREATE TABLE IF NOT EXISTS workspace_tx_assertions (
 id TEXT PRIMARY KEY,
 valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE IF NOT EXISTS workspace_security_events (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_account_id TEXT,
 event TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_security_event_expiry ON workspace_security_events(created_at);
-- A personal workspace cannot contain extra account members. First invitation
-- must convert the mode explicitly in the same transaction that revokes keys.
CREATE TRIGGER IF NOT EXISTS workspace_member_insert_guard BEFORE INSERT ON workspace_members BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND mode='shared' AND deleted_at IS NULL AND manager_account_id<>NEW.account_id)
 OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND deleted_at IS NULL)
 THEN RAISE(ABORT,'invalid workspace membership') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_member_update_guard BEFORE UPDATE ON workspace_members BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND mode='shared' AND deleted_at IS NULL AND manager_account_id<>NEW.account_id)
 OR NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND deleted_at IS NULL)
 THEN RAISE(ABORT,'invalid workspace membership') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_personal_guard BEFORE UPDATE OF mode ON workspaces WHEN NEW.mode='personal' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=NEW.id)
 THEN RAISE(ABORT,'workspace still has members') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_shared_key_guard BEFORE INSERT ON workspace_keys WHEN NEW.revoked_at IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND mode='personal' AND deleted_at IS NULL)
 THEN RAISE(ABORT,'shared workspace cannot have a sync key') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_shared_mode_guard BEFORE UPDATE OF mode ON workspaces WHEN NEW.mode='shared' BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM workspace_keys WHERE workspace_id=NEW.id AND revoked_at IS NULL)
 THEN RAISE(ABORT,'revoke sync key before mode conversion') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_manager_update_guard BEFORE UPDATE OF manager_account_id ON workspaces WHEN NEW.manager_account_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.manager_account_id AND deleted_at IS NULL)
 OR EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=NEW.id AND account_id=NEW.manager_account_id)
 THEN RAISE(ABORT,'invalid workspace manager') END;
END;
CREATE TRIGGER IF NOT EXISTS workspace_key_no_resurrection BEFORE UPDATE OF revoked_at ON workspace_keys WHEN OLD.revoked_at IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'revoked key cannot be reactivated');
END;
