CREATE TABLE membership_gift_cards(
 id TEXT PRIMARY KEY,purchaser_id TEXT NOT NULL,units TEXT NOT NULL,
 code_hash TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL,created_at INTEGER NOT NULL,
 redeemed_by TEXT,redeemed_at INTEGER,redeem_request TEXT,redeem_order TEXT NOT NULL DEFAULT '',
 revoked_at INTEGER,revoked_by TEXT,revoke_reason TEXT NOT NULL DEFAULT '',
 UNIQUE(purchaser_id,request_id),UNIQUE(redeemed_by,redeem_request),
 CHECK(NOT(redeemed_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX membership_gift_owner ON membership_gift_cards(purchaser_id,created_at);
CREATE TRIGGER membership_gift_face_locked BEFORE UPDATE OF id,purchaser_id,units,code_hash,request_id,created_at ON membership_gift_cards BEGIN SELECT RAISE(ABORT,'gift_definition_locked'); END;
CREATE TRIGGER membership_gift_redemption_locked BEFORE UPDATE OF redeemed_by,redeemed_at,redeem_request,redeem_order ON membership_gift_cards WHEN OLD.redeemed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'gift_already_used'); END;
CREATE TRIGGER membership_gift_revocation_locked BEFORE UPDATE OF revoked_at,revoked_by,revoke_reason ON membership_gift_cards WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'gift_unavailable'); END;
