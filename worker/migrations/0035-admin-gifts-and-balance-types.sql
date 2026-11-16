ALTER TABLE membership_bonus_grants ADD COLUMN balance_type TEXT NOT NULL DEFAULT 'bonus' CHECK(balance_type IN ('cash','bonus'));
CREATE TRIGGER membership_grant_type_locked BEFORE UPDATE OF balance_type ON membership_bonus_grants BEGIN SELECT RAISE(ABORT,'grant_type_locked'); END;
ALTER TABLE membership_gift_cards ADD COLUMN origin TEXT NOT NULL DEFAULT 'purchase' CHECK(origin IN ('purchase','admin'));
ALTER TABLE membership_gift_cards ADD COLUMN balance_type TEXT NOT NULL DEFAULT 'cash' CHECK(balance_type IN ('cash','bonus'));
ALTER TABLE membership_gift_cards ADD COLUMN issued_by TEXT NOT NULL DEFAULT '';
ALTER TABLE membership_gift_cards ADD COLUMN issue_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE membership_gift_cards ADD COLUMN issue_batch TEXT NOT NULL DEFAULT '';
CREATE TRIGGER membership_gift_origin_locked BEFORE UPDATE OF origin,balance_type,issued_by,issue_reason,issue_batch ON membership_gift_cards BEGIN SELECT RAISE(ABORT,'gift_definition_locked'); END;
CREATE TABLE membership_gift_issue_batches(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,card_kind TEXT NOT NULL,units TEXT NOT NULL,plan TEXT NOT NULL,plan_name TEXT NOT NULL,months INTEGER NOT NULL,price_version TEXT NOT NULL,balance_type TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),reason TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(actor_id,request_id));
CREATE TABLE membership_admin_gift_secrets(card_id TEXT PRIMARY KEY REFERENCES membership_gift_cards(id),batch_id TEXT NOT NULL REFERENCES membership_gift_issue_batches(id),nonce TEXT NOT NULL,ciphertext TEXT NOT NULL);
CREATE INDEX membership_admin_gift_batches ON membership_admin_gift_secrets(batch_id);
CREATE TRIGGER membership_admin_gift_terms BEFORE INSERT ON membership_gift_cards WHEN (NEW.origin='admin' AND (NEW.purchaser_id<>'' OR NEW.issued_by='' OR NEW.issue_batch='')) OR (NEW.origin='purchase' AND (NEW.balance_type<>'cash' OR NEW.purchaser_id='')) OR (NEW.card_kind='subscription' AND NEW.balance_type<>'cash') BEGIN SELECT RAISE(ABORT,'invalid_gift_settings'); END;
-- Older workers must not refund free cards or convert gifted credit into cash.
CREATE TRIGGER membership_admin_gift_no_refund BEFORE INSERT ON membership_balance_events WHEN NEW.kind='gift_refund' AND EXISTS(SELECT 1 FROM membership_gift_cards c WHERE c.id=NEW.order_id AND c.origin='admin') BEGIN SELECT RAISE(ABORT,'admin_gift_no_refund'); END;
CREATE TRIGGER membership_bonus_gift_claim BEFORE UPDATE OF redeemed_at ON membership_gift_cards WHEN OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL AND NEW.card_kind='balance' AND NEW.balance_type='bonus' AND NOT EXISTS(SELECT 1 FROM membership_balance_events e WHERE e.id='gift_redeem:'||NEW.id AND e.kind='gift_bonus' AND e.account_id=NEW.redeemed_by AND e.units=NEW.units) BEGIN SELECT RAISE(ABORT,'gift_bonus_required'); END;
