-- Apply only to an existing phase-two notes_json table without pinned.
ALTER TABLE notes_json ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1));
