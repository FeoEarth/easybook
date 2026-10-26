-- Apply ONLY to the independent easybook-security database. Never restore it
-- from business backups, copy business tables into it, or expire these records.
CREATE TABLE IF NOT EXISTS security_state(
 id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN('open','blocked')),
 not_before INTEGER NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_revocations(
 kind TEXT NOT NULL CHECK(kind IN('account','session','passkey','oauth','workspace')),
 subject TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(kind,subject)
);
CREATE TABLE IF NOT EXISTS workspace_security_floors(
 operation_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,min_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','committed','cancelled')),created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS security_workspace_floor ON workspace_security_floors(workspace_id,status,min_version);
CREATE TRIGGER IF NOT EXISTS security_revocation_no_delete BEFORE DELETE ON security_revocations BEGIN SELECT RAISE(ABORT,'permanent revocation checkpoint'); END;
CREATE TRIGGER IF NOT EXISTS security_revocation_no_update BEFORE UPDATE ON security_revocations BEGIN SELECT RAISE(ABORT,'permanent revocation checkpoint'); END;
CREATE TRIGGER IF NOT EXISTS security_floor_no_delete BEFORE DELETE ON workspace_security_floors BEGIN SELECT RAISE(ABORT,'permanent security floor'); END;
CREATE TRIGGER IF NOT EXISTS security_floor_committed BEFORE UPDATE ON workspace_security_floors WHEN OLD.status='committed' BEGIN SELECT RAISE(ABORT,'committed security floor'); END;
CREATE TABLE IF NOT EXISTS security_revocation_intents(
 operation_id TEXT NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','committed','cancelled')),
 created_at INTEGER NOT NULL,PRIMARY KEY(operation_id,kind,subject)
);
CREATE INDEX IF NOT EXISTS security_entity_intent ON security_revocation_intents(kind,subject,status);
CREATE TRIGGER IF NOT EXISTS security_intent_no_delete BEFORE DELETE ON security_revocation_intents BEGIN SELECT RAISE(ABORT,'permanent revocation intent'); END;
CREATE TRIGGER IF NOT EXISTS security_intent_committed BEFORE UPDATE ON security_revocation_intents WHEN OLD.status='committed' BEGIN SELECT RAISE(ABORT,'committed revocation intent'); END;
