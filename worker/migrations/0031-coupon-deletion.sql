ALTER TABLE membership_coupons ADD COLUMN deleted_at INTEGER;
CREATE TRIGGER IF NOT EXISTS membership_deleted_coupon_disabled BEFORE UPDATE OF active,deleted_at ON membership_coupons WHEN NEW.deleted_at IS NOT NULL AND NEW.active<>0 BEGIN SELECT RAISE(ABORT,'coupon_deleted'); END;
