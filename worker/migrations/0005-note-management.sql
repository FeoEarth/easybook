-- Add terminal tombstones without dropping existing data.
ALTER TABLE notes_json ADD COLUMN purged INTEGER NOT NULL DEFAULT 0 CHECK(purged IN (0,1));
ALTER TABLE folders ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1));
