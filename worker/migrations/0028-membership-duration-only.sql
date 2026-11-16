-- Invalidate pending quotes from the retired upgrade/permanent billing model.
-- Historical settled purchases, membership rights and account balances stay intact.
UPDATE membership_purchases SET cancelled_at=CAST(strftime('%s','now') AS INTEGER)*1000,cancel_reason='billing_changed' WHERE settled_at IS NULL AND cancelled_at IS NULL;
-- Require full-price finite duration terms even if an old Worker is still draining.
CREATE TRIGGER IF NOT EXISTS membership_duration_purchase BEFORE INSERT ON membership_purchases WHEN NOT (
 NEW.credit_units='0' AND NEW.amount=NEW.list_units AND NEW.kind IN ('purchase','renewal') AND (
 (NEW.plan='month' AND NEW.months=1 AND NEW.amount='1000000') OR
 (NEW.plan='quarter' AND NEW.months=3 AND NEW.amount='2000000') OR
 (NEW.plan='half-year' AND NEW.months=6 AND NEW.amount='3000000') OR
 (NEW.plan='year' AND NEW.months=12 AND NEW.amount='5000000')
 )) BEGIN SELECT RAISE(ABORT,'duration_terms_required'); END;
CREATE TRIGGER IF NOT EXISTS membership_duration_settlement BEFORE UPDATE OF settled_at ON membership_purchases WHEN OLD.settled_at IS NULL AND NEW.settled_at IS NOT NULL AND NOT (
 NEW.credit_units='0' AND NEW.amount=NEW.list_units AND NEW.kind IN ('purchase','renewal') AND (
 (NEW.plan='month' AND NEW.months=1 AND NEW.amount='1000000') OR
 (NEW.plan='quarter' AND NEW.months=3 AND NEW.amount='2000000') OR
 (NEW.plan='half-year' AND NEW.months=6 AND NEW.amount='3000000') OR
 (NEW.plan='year' AND NEW.months=12 AND NEW.amount='5000000')
 )) BEGIN SELECT RAISE(ABORT,'duration_terms_required'); END;
