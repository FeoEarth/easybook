# Android native data layer — stage 1 (0.5.0)

## Storage and ownership

Android uses `NoteRepository` / SQLiteOpenHelper (`easybook-native.db`, WAL), with one row per workspace + note/folder ID, durable dirty flags, mutation tokens and native revisions. The HTML UI keeps only an editing/rendering cache. Changed records are committed through an asynchronous origin-scoped bridge; “saved” follows the SQLite acknowledgement. Search is executed in the native repository. NativeSync owns HTTPS, pagination, retry/idempotency and conflict preservation. UI HTTP is disabled by both CSP and request interception in normal mode.

The browser keeps the original localStorage + JavaScript sync adapter. It uses the same unchanged Worker/D1 API and existing CAS mutation protocol. The native transport only permits fixed `/api/notes` and `/api/folders` endpoints; callers cannot choose URLs, headers, SQL, filenames or Java methods.

## Migration and verification

On startup, Android enumerates **all** legacy workspace note/folder keys, including inactive workspaces, and passes original strings to the native importer. Malformed data aborts migration rather than becoming an empty list. Active workspace, IDs, note contents, timestamps, versions, tombstones, favorites, folder assignments and unsynced mutation/dirty flags are preserved.

One SQLite transaction imports the rows, verifies their contents, stores the original raw source and records a verified report with a SHA-256 source digest. An identical retry is a no-op. A different source that collides with existing native content creates preserved copies; it does not overwrite native rows. Folder-ID collisions remap associated imported notes. Missing legacy mutation tokens are generated for retryable sync. Original WebView storage is never cleared by successful migration.

Long-press the version text at the bottom of Settings for migration counts, retry and rollback. Operator helpers on the trusted local page are `nativeMigrationStatus()`, `rollbackNativeMigration()` and `retryNativeMigration()`.

## Rollback

Failure inside the importer rolls back the SQLite transaction and journal. The recovery screen offers retry or explicit legacy mode; original strings remain in localStorage.

After successful migration, rollback first flushes edits, exports every native workspace (including new edits and conflict copies) to legacy-format storage, and reads back each value for verification. It changes mode **only after** all writes succeed. If WebView quota is insufficient, native mode remains active. The SQLite database and immutable original migration sources remain retained. Retrying native migration merges the legacy source; colliding versions are preserved as copies. Legacy mode is an explicit recovery exception that re-enables the old browser storage/sync path; it is not the default Android architecture.

Do not uninstall to roll back: uninstall removes application-private data. Do not delete a migration journal or database to “retry.”

## Concurrency and failure semantics

SQLite transactions serialize local changes. A UI commit includes its last acknowledged base mutation; a stale editor cannot overwrite a newer database record. Successful network acknowledgements update server version while retaining a newer local edit as dirty. A server conflict atomically preserves the latest local edit as a new ID and retains the remote record. New conflict copies upload on the next sync pass. Network errors keep dirty flags for retry. Search results have a generation guard to prevent stale asynchronous queries replacing newer ones.

Unacknowledged input is shown as saving. As with any asynchronous editor, an OS kill before the write acknowledgement can interrupt the last uncommitted input; committed SQLite edits survive Activity/process restart. No plaintext data is deleted in this stage.

## Security scope and future seams

`WebViewCompat.addWebMessageListener` is limited to the exact appassets HTTPS origin and rejects subframes; MainActivity additionally checks the top-level URL and validates operation names, identifiers, bounded payloads and native record schemas. External navigation and UI network requests are blocked. Old WebView providers without the required message-listener feature fail closed with update guidance; legacy data remains intact.

`DataProtection` separates local and transport encoding for a future Keystore-backed implementation and encrypted wire envelopes. Its stage-one implementation is explicitly plaintext. Credentials, database values, migration snapshots and backups are **not encrypted**. Device revocation and end-to-end encryption are out of scope. A trusted-page script compromise can still access whatever the trusted UI may access.

## Automated evidence

- Existing Worker/SQLite integration suite validates old browser protocol, migrations, folder assignments, CAS conflict/idempotency and workspace isolation.
- Android `DataLayerChecks`: actual SQLite transactions, all workspace migration, retries, preserved collisions, partial-failure rollback, rollback archives including post-migration data, native search, stale editor writes and edits racing upload acknowledgements.
- Live HTTPS against Worker/D1 with two isolated Android repositories: notes/folders, conflict convergence and a browser-format write omitting folder assignment.
- Actual WebView localStorage-to-SQLite migration, source retention, clearing renderer storage, Activity restart; bridge method rejection, foreign-origin absence and normal-mode network prohibition.
- Existing editor/folder/search/theme/keyboard/system-safe-area checks run offline after native live-network tests.
