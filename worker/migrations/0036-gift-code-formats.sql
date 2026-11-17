-- Keep every existing card on its original code derivation and hash.
ALTER TABLE membership_gift_cards ADD COLUMN code_version INTEGER NOT NULL DEFAULT 1 CHECK(code_version IN (1,2));
CREATE TRIGGER membership_gift_code_version_locked BEFORE UPDATE OF code_version ON membership_gift_cards BEGIN SELECT RAISE(ABORT,'gift_definition_locked'); END;
