# 0.7.0 rich editor and attachments

- Tiptap 3.32.0 is bundled locally; DOMPurify sanitizes stored and pasted HTML. No CDN or external image fetches are needed.
- Existing bodies remain unchanged until a user edits. New rich bodies use the `<!--easybook-rich-v1-->` prefix; SQLite preserves the first original in `rich-original` records. The editor menu can recover it as a new note. Plain text exports and search strip markup. Existing API/version/conflict behavior is retained. Older clients can display rich markup as text; use 0.7.0+ to edit formatted notes.
- Tasks support live checkboxes, nested items, Enter continuation, indent/outdent, counts, hiding completed tasks and undo/redo. Formatting includes headings, bold/italic/underline/strike, lists, quotes, code and links.
- Attachments are immutable SHA-256 objects, maximum 5 MiB each. Android files live in private app storage with SQLite metadata; browser files use IndexedDB. Only native Android code performs authenticated network requests. The WebView never receives sync credentials or local paths.
- Uploads are verified and acknowledged before note upload. New references are downloaded during sync. Interrupted upload is idempotent. Missing downloads can be retried from the attachment card. No automatic remote garbage collection: deleting a reference doesn't destroy a file needed by another copy/device.
- Cloudflare R2 is private. Objects are namespaced by the existing SHA-256 workspace identity and accessed only through bearer-authenticated Workers endpoints. Responses are JSON/base64, never executable attachment content. R2 uses a separate binding; no D1 schema migration or note rewrite is needed.
- Backup JSON includes attachment bytes. Native backup file limit is 50 MB; an over-limit export is refused, never silently truncated. Imports validate hashes before adding notes and preserve existing notes. Conversion originals are included in native backups as `richOriginals`.
- No E2EE has been added. Keystore behavior and backup exclusions remain intact.

Validation: legacy and rich document round trips, task nesting, XSS filtering, Worker note protocol compatibility, attachment hash/size/auth/isolation/retry, native file persistence and original-archive/search checks, Android WebView integration and keyboard/safe-area regression.
