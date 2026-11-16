-- Prices are immutable snapshots; pending orders keep their original quote.
CREATE TABLE membership_price_revisions(version TEXT PRIMARY KEY,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE membership_price_entries(version TEXT NOT NULL REFERENCES membership_price_revisions(version),plan TEXT NOT NULL,months INTEGER NOT NULL,units TEXT NOT NULL,PRIMARY KEY(version,plan));
CREATE TABLE membership_pricing_state(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL REFERENCES membership_price_revisions(version));
INSERT INTO membership_price_revisions VALUES('membership-duration-coupons-v2','migration',0);
INSERT INTO membership_price_entries VALUES('membership-duration-coupons-v2','month',1,'1000000'),('membership-duration-coupons-v2','quarter',3,'2000000'),('membership-duration-coupons-v2','half-year',6,'3000000'),('membership-duration-coupons-v2','year',12,'5000000');
INSERT INTO membership_pricing_state VALUES(1,'membership-duration-coupons-v2');
ALTER TABLE membership_purchases ADD COLUMN price_version TEXT NOT NULL DEFAULT 'membership-duration-coupons-v2';
CREATE TABLE membership_bonus_balances(account_id TEXT PRIMARY KEY,units TEXT NOT NULL DEFAULT '0');
INSERT INTO membership_bonus_balances SELECT account_id,'0' FROM membership_balances;
CREATE TABLE membership_recharge_bonus_revisions(version TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,tiers_json TEXT NOT NULL);
CREATE TABLE membership_recharge_bonus_tiers(version TEXT NOT NULL REFERENCES membership_recharge_bonus_revisions(version),min_units TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('fixed','percent')),bonus_units TEXT NOT NULL,percent_bps INTEGER NOT NULL,cap_units TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(version,min_units));
CREATE TABLE membership_recharge_bonus_state(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL REFERENCES membership_recharge_bonus_revisions(version));
INSERT INTO membership_recharge_bonus_revisions VALUES('bonus-off-v1',0,'migration',0,'[]');
INSERT INTO membership_recharge_bonus_state VALUES(1,'bonus-off-v1');
CREATE TABLE membership_recharge_rewards(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,rule_version TEXT NOT NULL,tier_min_units TEXT NOT NULL,received_units TEXT NOT NULL,bonus_units TEXT NOT NULL,chain_id INTEGER NOT NULL,tx TEXT NOT NULL,log_index INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(chain_id,tx,log_index));
CREATE TABLE membership_bonus_grants(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,actor_id TEXT NOT NULL,units TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX membership_grants_account ON membership_bonus_grants(account_id,created_at);
CREATE TABLE membership_billing_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
DROP TRIGGER IF EXISTS membership_duration_purchase;
DROP TRIGGER IF EXISTS membership_duration_settlement;
DROP TRIGGER IF EXISTS membership_locked_quote;
CREATE TRIGGER membership_duration_purchase BEFORE INSERT ON membership_purchases WHEN NOT (NEW.credit_units='0' AND NEW.kind IN ('purchase','renewal') AND CAST(NEW.discount_units AS INTEGER)>=0 AND CAST(NEW.discount_units AS INTEGER)<=CAST(NEW.list_units AS INTEGER) AND CAST(NEW.amount AS INTEGER)=CAST(NEW.list_units AS INTEGER)-CAST(NEW.discount_units AS INTEGER) AND (
EXISTS(SELECT 1 FROM membership_price_entries e WHERE e.version=NEW.price_version AND e.plan=NEW.plan AND e.months=NEW.months AND e.units=NEW.list_units)) AND (
(NEW.coupon_id IS NULL AND NEW.discount_units='0' AND NEW.coupon_code='') OR EXISTS(SELECT 1 FROM membership_coupons c WHERE c.id=NEW.coupon_id AND c.code=NEW.coupon_code AND CAST(NEW.discount_units AS INTEGER)=MIN(CAST(NEW.list_units AS INTEGER),CASE WHEN c.kind='percent' THEN CAST(NEW.list_units AS INTEGER)*c.percent_bps/10000 ELSE CAST(c.fixed_units AS INTEGER) END)))) BEGIN SELECT RAISE(ABORT,'coupon_terms_invalid'); END;
CREATE TRIGGER membership_duration_settlement BEFORE UPDATE OF settled_at ON membership_purchases WHEN OLD.settled_at IS NULL AND NEW.settled_at IS NOT NULL AND NOT (NEW.credit_units='0' AND NEW.kind IN ('purchase','renewal') AND CAST(NEW.discount_units AS INTEGER)>=0 AND CAST(NEW.discount_units AS INTEGER)<=CAST(NEW.list_units AS INTEGER) AND CAST(NEW.amount AS INTEGER)=CAST(NEW.list_units AS INTEGER)-CAST(NEW.discount_units AS INTEGER) AND (
EXISTS(SELECT 1 FROM membership_price_entries e WHERE e.version=NEW.price_version AND e.plan=NEW.plan AND e.months=NEW.months AND e.units=NEW.list_units)) AND (
(NEW.coupon_id IS NULL AND NEW.discount_units='0' AND NEW.coupon_code='') OR EXISTS(SELECT 1 FROM membership_coupons c WHERE c.id=NEW.coupon_id AND c.code=NEW.coupon_code AND CAST(NEW.discount_units AS INTEGER)=MIN(CAST(NEW.list_units AS INTEGER),CASE WHEN c.kind='percent' THEN CAST(NEW.list_units AS INTEGER)*c.percent_bps/10000 ELSE CAST(c.fixed_units AS INTEGER) END))) AND (NEW.coupon_id IS NULL OR EXISTS(SELECT 1 FROM membership_coupon_uses u WHERE u.order_id=NEW.id AND u.coupon_id=NEW.coupon_id AND u.account_id=NEW.account_id AND u.released_at IS NULL AND u.redeemed_at IS NULL AND u.expires_at>NEW.settled_at))) BEGIN SELECT RAISE(ABORT,'coupon_terms_invalid'); END;
CREATE TRIGGER membership_locked_quote BEFORE UPDATE OF plan,months,amount,kind,list_units,credit_units,state_version,coupon_id,coupon_code,discount_units,price_version ON membership_purchases WHEN NEW.plan<>OLD.plan OR NEW.months<>OLD.months OR NEW.amount<>OLD.amount OR NEW.kind<>OLD.kind OR NEW.list_units<>OLD.list_units OR NEW.credit_units<>OLD.credit_units OR NEW.state_version<>OLD.state_version OR NEW.coupon_id IS NOT OLD.coupon_id OR NEW.coupon_code<>OLD.coupon_code OR NEW.discount_units<>OLD.discount_units OR NEW.price_version<>OLD.price_version BEGIN SELECT RAISE(ABORT,'quote_is_locked'); END;

CREATE TRIGGER membership_current_price BEFORE INSERT ON membership_purchases WHEN NEW.price_version<>(SELECT version FROM membership_pricing_state WHERE id=1) BEGIN SELECT RAISE(ABORT,'price_changed'); END;
CREATE TRIGGER membership_price_revisions_update_locked BEFORE UPDATE ON membership_price_revisions BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_price_revisions_delete_locked BEFORE DELETE ON membership_price_revisions BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_price_entries_update_locked BEFORE UPDATE ON membership_price_entries BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_price_entries_delete_locked BEFORE DELETE ON membership_price_entries BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_recharge_bonus_revisions_update_locked BEFORE UPDATE ON membership_recharge_bonus_revisions BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_recharge_bonus_revisions_delete_locked BEFORE DELETE ON membership_recharge_bonus_revisions BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_recharge_bonus_tiers_update_locked BEFORE UPDATE ON membership_recharge_bonus_tiers BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
CREATE TRIGGER membership_recharge_bonus_tiers_delete_locked BEFORE DELETE ON membership_recharge_bonus_tiers BEGIN SELECT RAISE(ABORT,'billing_revision_locked'); END;
