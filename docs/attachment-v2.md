# Attachment v2

Original SHA-256 remains the asset ID and notes keep their existing asset references. Android streams imports to private app files and atomically installs them after hashing; Web stores a File/Blob in the existing IndexedDB record. Existing original files and old R2 objects are never removed by this upgrade. The shared document contract now accepts original sizes up to 1 GiB. Web additionally checks the browser storage estimate and requests persistent storage where available.

The UI's MB/GB labels use binary MiB/GiB byte constants: cloud 52,428,800 bytes; native local 1,073,741,824 bytes. Cloud usage is the sum of actual encoded file bytes, excluding per-request JSON/Base64 overhead. Each request contains at most 4 MiB of file bytes, so no request approaches 50 MiB.

## Manifest

GET /api/attachments/{original-sha256} returns v=2, id, name, mime, original size, localOnly, encoding (identity/gzip), wireSize, wireId (wire SHA-256), parts [{hash,size}]. GET ?part=N returns that part as bounded Base64. PUT op=part includes wireId/index/hash/data. PUT op=commit includes the manifest. R2 keys are workspace/id/wireId/index and workspace/id/manifest-v2. D1 note rows and note schema version do not need migration. Old R2 workspace/id objects are exposed as a read-only v2 identity manifest, preserving access to existing data without supporting old clients.

The Worker bounds request bodies, validates each chunk SHA-256, makes chunks immutable, checks total wire bytes <=50 MiB, verifies wire and decompressed original hashes using bounded streams, and only then publishes the manifest. Downloads verify each part, total encoded size, encoded SHA-256, bounded decoded length and original SHA-256. Invalid or incomplete content is never installed over a valid original.

Compression is enabled by default. Both clients use gzip and choose it only when it saves more than max(64 bytes,5% of original size). Compression is lossless, including images: no re-encoding or resampling. Originals are retained locally. Compressed candidates are capped at 50 MiB. If the chosen wire file is too large, only a localOnly manifest is committed, dirty is cleared after its acknowledgement, and note upload continues. A pre-existing complete cloud object is preserved if another device publishes a local-only manifest for the same original ID.

Settings: the existing per-workspace sync policy has compression=true by default. Changing it affects subsequent pending transfers; network and pause policies remain unchanged. Android bridge returns metadata plus an origin-scoped streaming resource URL instead of Base64 originals; export/share copies files as streams. PDF inline decoding is limited to 50 MiB, text preview to its first 1 MiB; full originals remain available to export/external apps. Gallery thumbnails may be resized for display only and never replace stored originals.

## Validation and limits

Focused script: node scripts/attachment-v2-integrity.mjs. Covers exact gzip recovery, corrupted chunk rejection, 50 MiB boundary, over-limit local-only state, and a >50 MiB original that compresses below the cloud cap. Android release compilation and signature verification use the normal workflow. No emulator/UI automation. Actual 1 GiB import and low-storage/low-memory devices require manual acceptance; browser quota and Worker plan/runtime resources still apply.

JSON backups remain the old bounded format: files above 5 MiB or combined attachment payloads above 20 MiB produce an explicit refusal and instructions to export originals individually. No partial JSON backup is silently emitted; existing notes/attachments are retained. Large-archive backup/import is outside this change.
