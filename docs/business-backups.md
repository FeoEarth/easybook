# Business backups and release status

The business backup workflow runs daily at 19:43 UTC (03:43 Singapore time),
after a relevant main push, or by manual dispatch. GitHub scheduling can be
delayed. Runs are serialized with cancellation disabled. This is independent
of D1 Time Travel and does not import data into production.

## Storage and consistency

`easybook-backups` is a separate private R2 bucket. The `backups/` prefix expires
after 2,592,000 seconds (30 days); R2 expiration is asynchronous. The production
attachment bucket and existing release recovery points are not given a new TTL.
R2 provides encryption at rest; transfers use HTTPS. This is not application-level
encryption and not an isolated account. The workflow currently uses the existing
deployment credential; dedicated least-privilege backup credentials remain a
release hardening requirement. No backup bytes or SQL are uploaded as Actions
artifacts or printed in logs.

The exporter obtains a D1 SQL snapshot, imports it into an isolated in-memory
SQLite database, checks integrity/foreign keys, and extracts document attachment
references. D1 export may briefly suspend database queries. R2 is copied after
that snapshot and is not a cross-service atomic snapshot. Every copied object
is read back, hashed, and checked against the snapshot reference closure. V2
manifests, individual chunks, concatenated wire bytes, decompressed original
content, and legacy objects are checked. Missing required attachments make the
run fail. Concurrent deletion may therefore make a backup fail safely; a later
run retries with a new snapshot. Unattached committed objects are also retained.
Local-only attachments retain metadata only and are counted explicitly; their
device-local bytes are never claimed to be backed up.

The completion manifest is written only after verification. A running/failed
status or orphaned objects are not a recovery point. An interruption after the
manifest write but before the success receipt can leave a verified manifest;
operators must verify it again before use. `status/latest-success.json` is a
small private receipt pointing at the last verified manifest, including its
SHA-256. Check its timestamp and that the manifest still exists before use;
the receipt itself has no TTL. Failed snapshots expire by the same 30-day rule.
Network and idempotent object requests retry with bounded backoff. A new export
request with uncertain outcome is not blindly repeated. GitHub job timeout and
concurrency prevent overlap; no source objects are deleted by this code.

## Recovery boundaries

`verifyBackup` restores SQL into isolated SQLite and verifies stored attachment
bytes without modifying production. It is a verifier, not an automated production
restore command. Preserve R2 HTTP/custom metadata from the manifest when eventually
materializing an object, particularly legacy file names and MIME types.

The independent `easybook-security` database is deliberately excluded. Its
permanent revocations and security floors must never be replaced with this
business snapshot. Follow `security-restore-runbook.md` for gate, reconciliation,
credential invalidation and reopening. Deleted accounts and stale workspaces
remain denied by current independent security state. Separate security database
backup/protection and a full remote D1/R2 restore drill are still required.

## Evidence and limits

Local synthetic tests cover corrupt/missing attachments, incomplete backup,
corrupt SQL, repeated validation, tombstones, local-only metadata and rejection
of a security database as a business snapshot. The existing checkpoint test
covers deleted accounts, revoked sessions/OAuth, old sync keys and removed members
after an actual SQLite rollback. These checks do not establish physical Android
login, external notification delivery, or a completed remote recovery drill.

The backup infrastructure, scheduled configuration, successful production export,
read-back verification, and actual recovery drill must each be reported separately.
Do not declare 0.8.0 release-ready from a merged workflow or a successful APK build.
