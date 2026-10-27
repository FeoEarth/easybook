# Business backups and release status

The `easybook-backup` Worker runs at minute 43 of every hour, completing at most
one backup per UTC day and retrying failed days on later invocations. It uses
D1/R2 bindings rather than a long-lived API token or GitHub runner. The existing
GitHub runner could not start; its automatic backup schedule is removed. Its
older API-based exporter is available only for explicit manual dispatch with
`ENABLE_LEGACY_GITHUB_BACKUP=true`. Do not enable both as primary schedulers.
This is independent of D1 Time Travel and does not import data into production.

The binding exporter reads every table in one D1 batch transaction. It checks
that the schema discovered during planning agrees with the schema inside the
snapshot and captures document references and the business security epoch in
that same batch. SQL uses SQLite's quote() for values, preserving BLOBs and text.
It creates tables, inserts data and preserves autoincrement sequences before
creating indexes/triggers, avoiding replay of audit triggers during import.
It refuses unsupported virtual tables, more than 75 tables, SQL over 16 MiB,
more than 10,000 objects or over 5 GiB of objects. It stops incomplete work after
12 minutes; a 15-minute D1 lease prevents concurrent invocations. A successful
daily receipt suppresses additional runs. No application data rows are modified;
only its own maintenance lease/result row is written to the business database.

R2 metadata is preserved in the manifest, every copied object is read back, and
the stored reference closure is verified including decompressed content hashes.
An isolated test imports the generated SQL and checks Unicode, quotes, BLOBs,
compressed attachments, missing-object failure, retry and recovery-gate denial.
Deployment, a real completed run and a remote restore drill remain distinct.

## Storage and consistency

`easybook-backups` is a separate private R2 bucket. The `backups/` prefix expires
after 2,592,000 seconds (30 days); R2 expiration is asynchronous. The production
attachment bucket and existing release recovery points are not given a new TTL.
R2 provides encryption at rest; transfers use HTTPS. This is not application-level
encryption and not an isolated account. The scheduled Worker uses resource bindings and needs no API credential. The
older optional API exporter uses the deployment credential unless a dedicated
least-privilege credential is provided. No backup bytes or SQL are uploaded as Actions
artifacts or printed in logs.

The older API-based exporter obtains a D1 SQL snapshot, imports it into an isolated in-memory
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
Temporary `_mcp_uploads/` chunks are excluded and counted: unfinished uploads
must be restarted after recovery, rather than promised as resumable attachments.

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
archival is performed by `archiveSecurity` into `easybook-security-checkpoints`,
a separate private bucket with no object expiration rule. It uses one D1 batch
transaction, preserves immutable safety triggers, reads the SQL back and records
its SHA-256 in a `security-checkpoint-v1` manifest. It archives at most once per
UTC hour. Neither client-facing Worker has a binding to this archive bucket.
There is deliberately no automatic security restore. A prior archive alone does
not prove that later revocations never existed: stop access if the security DB
is lost, reconcile its complete authoritative history separately, and never
initialize a replacement empty checkpoint against an old business snapshot.
Archives are recovery evidence, not permission to rewind safety history.

Source R2 inventory and missing reference reports are retained privately before
object copying. Known missing bytes abort early without a futile full copy.
Candidate manifests retain copied-object metadata but remain explicitly pending
until verification succeeds; they are not completed recovery points. See the
stage-three verification record for actual production gaps.

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
