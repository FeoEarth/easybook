CREATE TABLE IF NOT EXISTS security_restore_state(
 id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,reconciled_at INTEGER NOT NULL
);
