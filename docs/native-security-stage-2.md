# Native credential security — stage 2 (0.6.0)

## Verified starting point

Main 3baf1eb953550d090874ce72c18f262b2c31aa8a is stage one: SQLiteOpenHelper/WAL owns notes/folders, native search and native HTTPS synchronization. It is native SQLite, not Room. This change extends that repository; it does not create a second notes store or change the Worker/D1 protocol.

## Boundaries

CredentialVault generates AES-256 keys in AndroidKeyStore, with GCM/NoPadding, provider-generated random 96-bit IVs and 128-bit authentication tags. Versioned envelopes bind ciphertext to a purpose and workspace reference through AAD. Keys are non-exportable; hardware backing depends on the device. No biometric or screen-lock prompt is required for normal sync. No plaintext fallback is allowed.

SQLite spaces contains only wrapped credentials. Active workspace and note partitions are SHA-256 references. The renderer receives a `space:` handle, notes, folders and non-secret status; never a sync credential. The native sync layer resolves the credential immediately before HTTPS. Legacy key-bearing migration sources and rollback checkpoints are also encrypted. Note payloads, user JSON exports and cloud records are NOT encrypted in this stage. DataProtection local/transport seams remain available for a future E2EE implementation; this release does not claim E2EE.

The Android pairing entry opens a native dialog; it no longer opens the web key textarea. Viewing/copying the existing credential happens only in a native secure window, on explicit user action. Clipboard clips are marked sensitive; users must treat copied credentials as secrets. Native windows prevent screenshots and autofill. Android does not auto-transfer credentials to a website. The website retains its original localStorage storage/pairing model and Worker/D1 API.

## Migration, verification and retry

1. Upgrade legacy SQLite credentials and raw migration archives in one SQLite transaction. Validate workspace hash identity, encrypt/decrypt-verify all replacement values, and retain an encrypted recovery checkpoint. A failure rolls back the entire transaction.
2. Import all legacy WebView workspace note/folder strings using the stage-one transactional importer. All mutation versions, folders, tombstones and unsynced edits are preserved. Its immutable raw source is now encrypted rather than plaintext. Identical replays remain idempotent; collisions preserve copies.
3. Return a sanitized snapshot only after native verification. Then remove `easybook-key` and every credential-bearing legacy workspace key from localStorage, verify absence and acknowledge cleanup. A crash before removal retries the import; a crash after partial removal is safe because all originals were archived and records committed first. There is necessarily a one-time read of already-existing legacy secrets during migration. After migration no secret is supplied to the renderer.
4. Compact SQLite and truncate WAL after sensitive-value replacement; this is best-effort removal of prior logical pages, not a forensic erasure guarantee for flash storage. Old OS backups or copies taken before upgrade cannot be retroactively erased.

Long-press Settings version for migration report, retry and encrypted checkpoint recovery. Security rollback restores prior credential content inside the native vault and does not overwrite notes. It does not downgrade to the old plaintext renderer adapter. Explicit app-version downgrade is not supported. Do not uninstall as a recovery action.

## Key loss and re-pair

Existing unavailable aliases are never silently regenerated to decode old ciphertext. A missing/invalidated Keystore key or GCM authentication failure makes credentials unavailable, leaves encrypted blobs/checkpoints and all note rows intact, and disables sync. Offline edits/search/JSON export use opaque workspace references and remain available. Open Connect other devices and enter the original credential to repair the same workspace. A different credential explicitly selects another workspace; old rows are retained. When the active encryption key is unusable, native confirmed re-pair creates a new alias and replaces only the selected credential. Other spaces remain until individually re-paired; no global reset is performed. Lost device-only keys cannot decrypt old checkpoints; the original sync credential from another device or a user-held copy is required. There is no server-side recovery/revocation API in the existing bearer-key protocol.

## Bridge and platform controls

Exact appassets HTTPS origin + main-frame + current-document checks; external navigation, subframes, file/content access, mixed content, popups and UI HTTP are blocked. WebView cookies, form saving, autofill and release debugging are disabled. SecurityManager applies a per-document initialization gate, fixed operation allowlist, exact argument names, active workspace checks, bounded payloads and note/folder validation. Arbitrary credential lookup/activation, SQL, reflection, legacy downgrade and URL proxy operations are denied. Exceptions return generic messages without values. A trusted renderer compromise could still access notes and invoke authorized UI operations, but cannot request a raw sync credential through the bridge.

allowBackup=false plus legacy fullBackupContent and Android 12+ dataExtractionRules explicitly exclude cloud backup and device transfer of all private databases, WebView storage, shared preferences, files and external app files. The alias pointer lives in noBackupFilesDir. Manual JSON export includes notes/folders, never credentials. After reinstall or a restore without device Keystore material, re-pair is required; do not auto-wipe restored notes.

## Validation

Actual AndroidKeyStore AES-GCM roundtrip/random IV, wrong-AAD rejection, ciphertext tampering, stage-one SQLite plaintext fixture upgrade, encrypted archive/checkpoint, idempotent retry, transaction rollback and same-key re-pair after simulated alias loss. Actual WebView migration verifies raw localStorage removal and sanitized snapshots; forbidden operations, unknown arguments, wrong workspace, foreign origin and CSP are checked. Stage-one offline editing/search/folder tests and real Worker/D1 two-device conflict protocol tests remain. Release APK is non-debuggable, uses the existing update-compatible certificate and is verified before GitHub Release publication.

Official Android references: https://developer.android.com/privacy-and-security/keystore ; https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec ; https://developer.android.com/identity/data/autobackup
