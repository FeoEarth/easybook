-- A chain window is committed only after all snapshotted order addresses are scanned.
CREATE TABLE IF NOT EXISTS membership_scan_windows(
 chain_id INTEGER PRIMARY KEY,from_block INTEGER NOT NULL,to_block INTEGER NOT NULL,
 last_address_id INTEGER NOT NULL DEFAULT 0,snapshot_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS membership_order_chain ON membership_orders(chain_id,id);
CREATE INDEX IF NOT EXISTS membership_receipt_order ON membership_receipts(order_id,created_at);
-- Never silently reinterpret existing addresses using a new wallet or index offset.
CREATE TABLE IF NOT EXISTS membership_wallet_config(id INTEGER PRIMARY KEY CHECK(id=1),wallet_hash TEXT NOT NULL,address_offset INTEGER NOT NULL CHECK(address_offset>=0));
