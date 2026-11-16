ALTER TABLE membership_gift_cards ADD COLUMN card_kind TEXT NOT NULL DEFAULT 'balance' CHECK(card_kind IN ('balance','subscription'));
ALTER TABLE membership_gift_cards ADD COLUMN card_plan TEXT NOT NULL DEFAULT '';
ALTER TABLE membership_gift_cards ADD COLUMN card_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE membership_gift_cards ADD COLUMN card_plan_name TEXT NOT NULL DEFAULT '';
ALTER TABLE membership_gift_cards ADD COLUMN price_version TEXT NOT NULL DEFAULT '';
CREATE TABLE membership_subscription_gift_redemptions(card_id TEXT PRIMARY KEY REFERENCES membership_gift_cards(id),account_id TEXT NOT NULL,plan TEXT NOT NULL,plan_name TEXT NOT NULL,months INTEGER NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX membership_subscription_gift_history ON membership_subscription_gift_redemptions(account_id,created_at);
CREATE TRIGGER membership_gift_entitlement_locked BEFORE UPDATE OF card_kind,card_plan,card_months,card_plan_name,price_version ON membership_gift_cards BEGIN SELECT RAISE(ABORT,'gift_definition_locked'); END;
CREATE TRIGGER membership_gift_purchase_terms BEFORE INSERT ON membership_gift_cards WHEN NOT (
 (NEW.card_kind='balance' AND NEW.card_plan='' AND NEW.card_months=0 AND NEW.price_version='') OR
 (NEW.card_kind='subscription' AND NEW.price_version=(SELECT version FROM membership_pricing_state WHERE id=1) AND EXISTS(SELECT 1 FROM membership_price_entries p WHERE p.version=NEW.price_version AND p.plan=NEW.card_plan AND p.months=NEW.card_months AND p.units=NEW.units))
) BEGIN SELECT RAISE(ABORT,'price_changed'); END;
-- Old clients or old worker versions must never turn subscription time into money.
CREATE TRIGGER membership_subscription_gift_claim BEFORE UPDATE OF redeemed_at ON membership_gift_cards WHEN OLD.redeemed_at IS NULL AND NEW.redeemed_at IS NOT NULL AND NEW.card_kind='subscription' AND NOT EXISTS(SELECT 1 FROM membership_subscription_gift_redemptions r WHERE r.card_id=NEW.id AND r.account_id=NEW.redeemed_by AND r.plan=NEW.card_plan AND r.months=NEW.card_months AND NEW.redeem_order='subscription-gift:'||NEW.id) BEGIN SELECT RAISE(ABORT,'gift_subscription_only'); END;
CREATE TRIGGER membership_subscription_gift_no_cash BEFORE INSERT ON membership_balance_events WHEN NEW.kind='gift_credit' AND EXISTS(SELECT 1 FROM membership_gift_cards c WHERE c.card_kind='subscription' AND NEW.id='gift_redeem:'||c.id) BEGIN SELECT RAISE(ABORT,'gift_subscription_only'); END;
-- Replacing an activated invoice with a subscription gift keeps the late-payment guard.
DROP TRIGGER IF EXISTS membership_purchase_cancel_guard;
CREATE TRIGGER membership_purchase_cancel_guard AFTER UPDATE OF cancelled_at ON membership_purchases WHEN OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL AND OLD.payment_method<>'unselected' AND NEW.cancel_reason IN ('user','expired','subscription_gift') BEGIN UPDATE membership_account_state SET cancel_version=cancel_version+1,needs_ack=CASE WHEN EXISTS(SELECT 1 FROM membership_balances WHERE account_id=NEW.account_id AND units<>'0') THEN 1 ELSE needs_ack END WHERE account_id=NEW.account_id; END;
