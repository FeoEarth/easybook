CREATE TABLE IF NOT EXISTS membership_addresses(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS membership_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,plan TEXT NOT NULL,months INTEGER NOT NULL,chain_id INTEGER NOT NULL,token TEXT NOT NULL,amount TEXT NOT NULL,address TEXT NOT NULL UNIQUE,idempotency TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,settled_at INTEGER,UNIQUE(account_id,idempotency));
CREATE INDEX IF NOT EXISTS membership_order_account ON membership_orders(account_id,created_at);
CREATE TABLE IF NOT EXISTS account_memberships(account_id TEXT PRIMARY KEY,permanent INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS membership_receipts(chain_id INTEGER NOT NULL,tx TEXT NOT NULL,log_index INTEGER NOT NULL,order_id TEXT NOT NULL,amount TEXT NOT NULL,block INTEGER NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(chain_id,tx,log_index));
CREATE TABLE IF NOT EXISTS membership_changes(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,permanent INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS membership_cursors(chain_id INTEGER PRIMARY KEY,block INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS membership_assertions(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE IF NOT EXISTS membership_web_sessions(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
