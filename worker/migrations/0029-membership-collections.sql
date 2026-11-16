CREATE TABLE IF NOT EXISTS membership_collection_watch(
 address_id INTEGER NOT NULL,chain_id INTEGER NOT NULL,balance_units TEXT NOT NULL DEFAULT '0',first_funded_at INTEGER,last_checked_at INTEGER NOT NULL,last_collected_at INTEGER,PRIMARY KEY(address_id,chain_id));
CREATE TABLE IF NOT EXISTS membership_collection_jobs(
 id TEXT PRIMARY KEY,address_id INTEGER NOT NULL,chain_id INTEGER NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,token TEXT NOT NULL,amount_units TEXT NOT NULL,
 state TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,completed_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS membership_collection_one_open ON membership_collection_jobs(address_id,chain_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS membership_collection_due ON membership_collection_jobs(chain_id,next_attempt_at);
CREATE TABLE IF NOT EXISTS membership_collection_tx(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL,chain_id INTEGER NOT NULL,kind TEXT NOT NULL,from_address TEXT NOT NULL,to_address TEXT NOT NULL,nonce INTEGER NOT NULL,
 value_units TEXT NOT NULL,gas_limit TEXT NOT NULL,gas_price TEXT NOT NULL,cost_units TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,raw_tx TEXT NOT NULL,state TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,block_number INTEGER,UNIQUE(chain_id,from_address,nonce));
CREATE TABLE IF NOT EXISTS membership_collection_lease(chain_id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS membership_collection_cursor(chain_id INTEGER PRIMARY KEY,last_address_id INTEGER NOT NULL DEFAULT 0);
