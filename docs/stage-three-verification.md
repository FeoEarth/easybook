# Stage three verification — 2026-10-27

## Applied infrastructure and code

PR 87 adds verified API-based backups and a private 30-day R2 bucket. PR 89
adds the `easybook-backup` Worker so production backup scheduling does not depend
on GitHub runner availability. GitHub jobs still failed before executing steps.
The backup Worker uses business/security D1 and source/destination R2 bindings;
its public and preview URLs are disabled. Only its maintenance row and failure
notices are written to the business database. Existing notes and objects are
not modified. Backup failures retain private job status and critical in-app
notices; planned recovery gating is not treated as a security incident.

## Real snapshot validation

The first manually triggered copy exceeded the operator HTTP client timeout.
It had no completion manifest and must not be counted as a successful backup.
Its SQL object was independently downloaded in bounded segments, checked for
full length and restored into isolated SQLite. The 637,258-byte snapshot contained
54 tables and 32 live document attachment references. SQLite integrity and
foreign-key checks passed. SHA-256:
`49e3bbca624602b8b92e6fa8781f643a20854c9cffc3fc7514dc6f0bd76bde8c`.
The private local copy was deleted after verification. This validates SQL, not
completion of its R2 copy or a full production recovery.

## Remote disposable D1/R2 drill

Three new disposable D1 databases and one private fixture bucket were created.
They contained only synthetic accounts, credentials, workspaces and attachment
bytes. A marker check protects the harness from accidental production bindings.
An old SQL snapshot was imported into a different D1 while the independent
synthetic security D1 retained newer revocations and workspace version floors.

The first remote import exposed a real incompatibility: D1 keeps foreign keys
enabled, so `PRAGMA foreign_keys=OFF` alone did not permit out-of-order data
insertion. The dump now includes `PRAGMA defer_foreign_keys=ON`, as documented
at https://developers.cloudflare.com/d1/sql-api/foreign-keys/ . The corrected
import succeeded. A regression test imports within a foreign-key-enforced
transaction where child rows precede parent rows.

Remote harness checks passed for the recovery gate, wrong epoch denial,
deleted-account fence, revoked session/Passkey/OAuth state, rotated sync key,
removed membership, transferred management and deleted workspace quarantine.
An unchanged anonymous workspace remained usable. Missing and corrupted R2
fixture bytes were rejected. Passkey verification here tests revocation fences,
not a physical authenticator ceremony. Gate tests simulate interrupted recovery
state; they do not prove every possible process-crash timing or repeated full
remote import. A second remote verification returned `repeatedVerification:true`.
The operator subsequently removed both temporary public harness Workers, all
three marked disposable databases, the fixture bucket and its objects, and the
local transient invocation credential. No production D1 or attachment data was
deleted by the drill.

## Remaining release gates

The scheduled business backup subsequently failed with `attachment_missing`.
An inventory check found 32 distinct document references, of which 12 had no
legacy object or V2 manifest in the live attachment bucket. All 12 IDs were
single hex characters repeated 64 times, consistent with placeholder references.
They were in active workspaces, had no cross-workspace object match, and had no
match among the 50 existing release-recovery objects. No notes or references were
deleted to bypass verification. The exporter now saves inventory/missing-reference
reports and fails before copying all bytes when this condition is present.
These missing sources remain a completeness blocker; no successful business
backup receipt is claimed. The cron returns to minute 43 each hour after initial
bootstrap attempts rather than repeatedly copying incomplete source data.

Independent security archives now use a separate private no-expiration bucket.
The archive format explicitly forbids automatic restore; a local test restores
its SQL and confirms permanent revocation triggers still prevent deletion.
Real archive execution and its receipt must be checked separately from code and
bucket provisioning.

Do not declare 0.8.0 released from these results. A completed production backup
receipt, authoritative security recovery protection, external email/push
delivery, physical Android account acceptance and final candidate APK evidence
remain separate gates. Email Sending inspection previously returned 401; token
permission discovery also stalled and was abandoned. No third-party mail provider
was substituted and no delivery success is claimed. Existing cron audit retention
and security-checkpoint state were observed separately from platform log retention.
