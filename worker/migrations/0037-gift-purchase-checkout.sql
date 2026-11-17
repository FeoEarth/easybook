-- A reserved purchase issues no card until its ordinary cash payment settles.
CREATE TABLE membership_gift_orders(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL,idempotency TEXT NOT NULL,
 card_kind TEXT NOT NULL CHECK(card_kind IN ('balance','subscription')),card_plan TEXT NOT NULL DEFAULT '',card_months INTEGER NOT NULL DEFAULT 0,card_plan_name TEXT NOT NULL DEFAULT '',price_version TEXT NOT NULL DEFAULT '',
 amount TEXT NOT NULL,code_hash TEXT NOT NULL UNIQUE,chain_id INTEGER NOT NULL,token TEXT NOT NULL,address TEXT NOT NULL,
 payment_method TEXT NOT NULL DEFAULT 'unselected' CHECK(payment_method IN ('unselected','chain','balance')),funding_cursor INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,settled_at INTEGER,cancelled_at INTEGER,cancel_reason TEXT NOT NULL DEFAULT '',
 UNIQUE(account_id,idempotency),CHECK(settled_at IS NULL OR cancelled_at IS NULL),
 CHECK((card_kind='balance' AND card_plan='' AND card_months=0 AND price_version='' AND CAST(amount AS INTEGER) BETWEEN 1000000 AND 999999000000 AND CAST(amount AS INTEGER)%1000000=0) OR (card_kind='subscription' AND card_months>0))
);
CREATE UNIQUE INDEX membership_one_pending_gift ON membership_gift_orders(account_id) WHERE settled_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX membership_gift_order_history ON membership_gift_orders(account_id,created_at);
CREATE TRIGGER membership_gift_order_price BEFORE INSERT ON membership_gift_orders WHEN NEW.card_kind='subscription' AND NOT (NEW.price_version=(SELECT version FROM membership_pricing_state WHERE id=1) AND EXISTS(SELECT 1 FROM membership_price_entries p WHERE p.version=NEW.price_version AND p.plan=NEW.card_plan AND p.months=NEW.card_months AND p.units=NEW.amount)) BEGIN SELECT RAISE(ABORT,'price_changed'); END;
CREATE TRIGGER membership_gift_order_locked BEFORE UPDATE OF id,account_id,idempotency,card_kind,card_plan,card_months,card_plan_name,price_version,amount,code_hash,address,created_at,expires_at ON membership_gift_orders BEGIN SELECT RAISE(ABORT,'quote_is_locked'); END;
-- A fixed account address can fund only one pending invoice, across both products.
CREATE TRIGGER membership_gift_order_exclusive BEFORE INSERT ON membership_gift_orders WHEN EXISTS(SELECT 1 FROM membership_purchases WHERE account_id=NEW.account_id AND settled_at IS NULL AND cancelled_at IS NULL) BEGIN SELECT RAISE(ABORT,'pending_order_exists'); END;
CREATE TRIGGER membership_purchase_exclusive BEFORE INSERT ON membership_purchases WHEN EXISTS(SELECT 1 FROM membership_gift_orders WHERE account_id=NEW.account_id AND settled_at IS NULL AND cancelled_at IS NULL) BEGIN SELECT RAISE(ABORT,'pending_order_exists'); END;
CREATE TRIGGER membership_gift_cancel_guard AFTER UPDATE OF cancelled_at ON membership_gift_orders WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND OLD.payment_method='chain' AND NEW.cancel_reason IN ('user','expired') BEGIN UPDATE membership_account_state SET cancel_version=cancel_version+1,needs_ack=CASE WHEN EXISTS(SELECT 1 FROM membership_balances WHERE account_id=NEW.account_id AND units<>'0') THEN 1 ELSE needs_ack END WHERE account_id=NEW.account_id; END;
-- A card may use its reserved price snapshot even when the current price has changed.
DROP TRIGGER membership_gift_purchase_terms;
CREATE TRIGGER membership_gift_purchase_terms BEFORE INSERT ON membership_gift_cards WHEN NOT (
 (NEW.card_kind='balance' AND NEW.card_plan='' AND NEW.card_months=0 AND NEW.price_version='') OR
 (NEW.card_kind='subscription' AND EXISTS(SELECT 1 FROM membership_price_entries p WHERE p.version=NEW.price_version AND p.plan=NEW.card_plan AND p.months=NEW.card_months AND p.units=NEW.units) AND (
 NEW.price_version=(SELECT version FROM membership_pricing_state WHERE id=1) OR EXISTS(SELECT 1 FROM membership_gift_orders o WHERE o.id=NEW.id AND o.account_id=NEW.purchaser_id AND o.idempotency=NEW.request_id AND o.card_kind=NEW.card_kind AND o.card_plan=NEW.card_plan AND o.card_months=NEW.card_months AND o.card_plan_name=NEW.card_plan_name AND o.price_version=NEW.price_version AND o.amount=NEW.units AND o.code_hash=NEW.code_hash AND o.settled_at IS NULL AND o.cancelled_at IS NULL))))
 BEGIN SELECT RAISE(ABORT,'price_changed'); END;
CREATE TRIGGER membership_gift_order_card BEFORE INSERT ON membership_gift_cards WHEN EXISTS(SELECT 1 FROM membership_gift_orders WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM membership_gift_orders o WHERE o.id=NEW.id AND o.account_id=NEW.purchaser_id AND o.amount=NEW.units AND o.code_hash=NEW.code_hash AND o.idempotency=NEW.request_id AND o.card_kind=NEW.card_kind AND o.card_plan=NEW.card_plan AND o.card_months=NEW.card_months AND o.card_plan_name=NEW.card_plan_name AND o.price_version=NEW.price_version AND NEW.code_version=2 AND NEW.origin='purchase' AND NEW.balance_type='cash' AND o.settled_at IS NULL AND o.cancelled_at IS NULL) BEGIN SELECT RAISE(ABORT,'gift_order_changed'); END;
