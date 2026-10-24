# Folder placement and Android save repair

The Android regression was in SecurityManager.authorize: the UI's commit envelope included placements, but the allowlist accepted only notes/folders. It threw SecurityException before NoteRepository.commit. Both native search and native sync flush pending commits first, so one rejected placement prevented saving/search/sync. Web bypassed this native guard.

SecurityManager now calls FolderPlacement.validateCommit, which allows the exact placements field, validates folder-only operations and retains workspace/generation/type/batch checks. NoteRepository stores the queue in its existing encrypted records table, atomically with the commit. NativeSync sends canonical payloads (never local retry flags), preserves pending changes on transport failure, backs off and pauses a task after three failures. Permanent HTTP 400/413/422 and hierarchy conflicts remain blocked until replaced; manual retry resets only transient failures. General automatic sync also backs off and pauses after repeated exceptions, with visible status and manual/online recovery.

Upgrade repair removes retired n: metadata/operations in Android and Web. Migration 0007 removes only n: entries and their receipts in the existing management tables; folder metadata, notes, attachments and bindings remain intact. The retired note-placement request is acknowledged without storing it for old-client compatibility, preventing poison replay loops. There is no note custom-sort UI, drag controller or active write path.

Folders keep sibling dragging, nesting, root promotion, right-click/long-press menus, keyboard placement and edge scrolling. Notes retain edit-time/title order and pin grouping. Both ordering choices are direct buttons in the anchored list menu, alongside gallery, selection and checklist actions; there is no native select/nested sort dialog.

## Scoped validation

Local placement API tests use real SQLite: CAS/replay/cycle checks, retired requests, and migration preserving folder metadata. Web IndexedDB and native-bridge contract mocks exercise pointer drag/save, serialized restart order, upgrade cleanup, unchanged notes and the direct menu. Native helper JVM tests exercise the exact bridge validator, queue JSON round-trip/acknowledgement and durable retry suspension. Android release compilation and APK signature verification run in Actions.

No emulator/full regression. Native bridge mocks and JVM serialization tests do not verify actual Android SQLite, a physical App restart, touch behavior on a phone, or two real devices. Those remain unverified until device testing.
