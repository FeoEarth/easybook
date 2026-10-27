# Stage three verification — 2026-10-27

## Durable purge retry deployment

PR 94 merged as `44e601bfe7cabcf66081a95eafc36027142409b4`. Attachment and
workspace cleanup jobs marked `R2_CLEANUP_RETRY` now remain eligible after the
fifth failure. The retry deadline doubles from one minute to a maximum of one
day, with execution also subject to the existing hourly cron. Failed retries
keep their failed status during lease claim so a continuing outage does not
repeatedly emit the existing attachment failure notification. Invalid-fence
failures remain terminal and release their leases. Every execution still
rechecks the deletion fence before touching the frozen R2 namespace.

Real SQLite tests passed six consecutive storage failures followed by successful
paginated cleanup of 251 objects in each namespace, plus a legacy attachment.
They also checked retry deadlines, lease exclusion, one attachment failure
notification during the outage, unrelated-object preservation, permanent
fences, invalid-fence rejection and recovery gating. Existing account-deletion
and notification/audit tests passed locally. No migration was introduced.

Candidates were uploaded with existing bindings/secrets retained and main PDF
assets preserved. Candidate main homepage/editor/PDF hashes matched production;
unauthenticated workspace access remained 401. OAuth candidate discovery,
authentication rejection, pairing error handling and schema readiness passed.
Main version `557177a8-e280-4269-9996-1c53b44ecc61` and OAuth version
`ce514cc0-c61a-4b65-8ede-405a4f87f716` were promoted. Their deployment IDs are
`af053f7b-ba36-4e1f-ac24-6e12612366e7` and
`15cba650-bfb4-4737-97e4-c32e33a80c53`, respectively. Previous rollback versions
are main `b93ff08f-7149-4794-82d2-4e69104e8fff` and OAuth
`cd4762e9-7f6e-4aec-83ee-b1cab9a7d4f6`.

Production main health returned the exact new source SHA and its PDF module
remained 200 with the expected length. Production OAuth discovery, unauthenticated
MCP rejection and schema-9 readiness passed, including exact release SHA checks
on both the canonical origin and the OAuth Worker origin. The generic OAuth smoke
initially failed on canonical `/pairing/complete` CORS: that retired route is
absent (404) on main, while it returns 410 on the OAuth Worker. Comparison with
the previous main version proved identical 204 preflight/404 POST behavior. The
smoke script now explicitly checks that canonical preflight does not allow POST
and the retired route remains 404, while retaining the direct OAuth checks.
Both live deployment readbacks show the new versions at 100%; main cron remains
`17 * * * *`.

A read-only production query found no attachment/workspace purge jobs. Thus
there was no production backlog to exercise; failure/recovery execution evidence
is isolated testing. No production deletion test or direct data edit was run.
Full business backup completeness, external delivery, Android physical-device
acceptance and final APK remain separate release gates.

## Bounded approval maintenance deployment

PR 93 merged as `1f281634fd3ba5cd1e4604881225b889a9c93a71`.
Approval expiration and completed-payload scrubbing now each update at most
500 rows per pass. Already-scrubbed payloads are skipped, and any remaining
expiration/scrubbing backlog prevents the day from being marked complete.
No schema migration or direct production data edit was needed.

Real SQLite tests passed for 1001 expired plus 501 sensitive approvals,
bounded updates, live lease exclusion, injected batch failure/retry,
backlog draining, daily idempotency and restore-gate refusal. Unexpired
frozen payloads, receipts, unfinished purge jobs, tombstones and independent
revocations remained intact. Existing account-history and account-deletion
tests also passed locally; this is not a GitHub Actions success claim.

Main Worker version `b93ff08f-7149-4794-82d2-4e69104e8fff` was uploaded with
`keep_assets:true` and existing secrets/bindings retained. Before promotion,
candidate and previous production responses had identical SHA-256 hashes for
the homepage, editor script, PDF module and PDF worker. Both rejected an
unauthenticated workspace request with 401. Promotion created deployment
`aa457ce9-7f70-407f-8a0c-e50f0a77400f`; production `/health` then returned
the merged SHA, schema version 16 and all three identity/checkpoint flags true.
Production PDF fetch remained 200 and unauthenticated workspace access 401.
The previous version `f7ad48ac-28bf-4783-88ac-8105c1b2b292` remains the rollback
target. No new D1 migration or checkpoint initialization was performed.

Production schedule readback remains `17 * * * *`. The existing successful
identity maintenance row had no error and no active lease. This proves prior
scheduled execution, not execution of the new batch code on a production
backlog; the new algorithm's execution evidence is the isolated SQLite test.
Business backup status still reports `BACKUP_RETRY:attachment_missing` with
no success timestamp. These changes do not resolve that completeness blocker,
external delivery provisioning or physical Android acceptance.

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

Actual execution was subsequently verified at 2026-10-27 14:39 Singapore time
(06:39 UTC). The first security archive completed with 28,518 SQL bytes and
SHA-256 `c2c261295055fa023cbc15fd849f00b5cd9b160e62f87ca2f5850ca8c63f6826`.
Its SQL was independently downloaded in bounded segments, the checksum matched,
and isolated SQLite import/integrity checks passed. The permanent-revocation
trigger was tested on that local clone with a synthetic row and rejected deletion.
The local copy and transient credential were removed; the final temporary
verification Worker was deleted. The production archive receipt identifies code
commit `31621824645ce2d0b66552f1286e323cecbdb183` and explicitly forbids automatic
security restoration. The cron was read back as `43 * * * *`; public and preview
access remained disabled. Business backup execution returned `attachment_missing`
with no success timestamp, correctly keeping the data-completeness gate closed.

Do not declare 0.8.0 released from these results. A completed production backup
receipt, authoritative security recovery protection, external email/push
delivery, physical Android account acceptance and final candidate APK evidence
remain separate gates. Email Sending inspection previously returned 401; token
permission discovery also stalled and was abandoned. No third-party mail provider
was substituted and no delivery success is claimed. Existing cron audit retention
and security-checkpoint state were observed separately from platform log retention.
