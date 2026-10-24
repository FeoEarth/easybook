# Folder and note placement

Folders no longer show a permanent action button. Long press and release, right click or the context-menu key opens rename/move/delete. System folders are excluded. Long press then move drags. The middle of a folder row nests, row edges insert beside it, and the Unfiled row is the root drop target. Children remain visible with indentation. Moving a folder preserves child relationships; deleting a parent leaves surviving children visible at the root.

Custom note order is separate from edit-time/title ordering and from content. Pinned/unpinned groups cannot cross during drag; list/gallery use the same ranks. Pointer gestures distinguish pre-hold scroll/swipe from an armed drag; Escape/cancel/blur abort without saving. Edge scrolling supports long lists. Keyboard Alt+Up/Down reorders, Alt+Right nests under the previous sibling and Alt+Left promotes. The move menu provides an alternative to drag.

## Persistence and compatibility

Additive migration 0006 creates management_state and management_receipts only. Original notes_json/folders/attachments are untouched. The authenticated /api/management endpoint receives one placement with a workspace version. A conditional update plus receipt in a D1 batch serializes concurrent hierarchy edits and makes lost acknowledgements idempotent. On stale versions, clients rebase pending intent onto the returned state and retry at most twice per sync. Cycle-invalid operations stay blocked locally until the user moves that item again. Per-device sort-mode selection remains local; order/hierarchy metadata synchronizes.

Web stores metadata both in its atomic workspace snapshot and a separate IndexedDB key, so an older client's workspace write cannot erase it. Android uses existing encrypted SQLite records and the current commit/transport lifecycle; pending placement operations survive restart and failed requests. Neither old folder nor old note API writes can reset placement state.

## Verification

Scoped API checks: additive schema, version conflicts, idempotent replay, cycle prevention, workspace isolation, legacy-write compatibility. Scoped UI/storage checks: menu access, keyboard nest/promote/reorder, pinned isolation, list/gallery parity, offline outbox, unchanged content and older Web snapshot compatibility. Native Java compilation runs on the PR. No emulator, broad regression or load test. Physical Android touch behavior remains unverified.
