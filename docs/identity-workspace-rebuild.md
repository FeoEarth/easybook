# 0.8.0 identity/workspace rebuild — implementation ledger

## Baseline verified 2026-10-26

Source main: `a4426019f301ffb2bcacd3c7ad5ae8aca24c6045` (PR #79).
Main Android, MCP checks, sync deployment and OAuth deployment Actions succeeded.
Production custom domain `easybook.loonxy.com` belongs to `easybook-sync`.
Both Workers bind D1 `easybook-data` and R2 `easybook-attachments`.
OAuth additionally binds its existing provider KV. Secret names were inspected;
secret values were neither read nor exported.
Read-only counts: 1 account, 1 session, 0 account memberships, 0 account OAuth
policies, 45 JSON notes, 18 folders, 1 legacy MCP workspace grant.

## Keep

- Native SQLite repository, AES-256-GCM CredentialVault and trusted WebView bridge.
- Shared JSON editor, table support, attachment upload/download and R2 object paths.
- QWEA0 native Liquid Glass surfaces and independent sync activity screen.
- SimpleWebAuthn signature verification and pinned Cloudflare OAuth Provider.
- Existing GitHub history, D1/R2/Workers, DNS and deployment credentials.
- Candidate promotion/rollback and Android release build workflows.

## Rebuild

| Area | Actual baseline | Required change |
| --- | --- | --- |
| Workspace identity | SHA-256(sync key), no independent registry | Stable ID, one current key verifier, rotation without moving content |
| Ownership | `owner/member`, explicit attestation claim | Personal/shared mode, manager/editor/reader, protected association |
| Device storage | Namespaced by key fingerprint | Stable workspace namespace independent of credentials |
| Account access | Browser portal only on Android | Credential Manager, native session, trusted browser callback |
| Passkeys | RP fixed to OAuth workers.dev | Explicit re-enrollment; never pretend RP credentials migrate |
| OAuth | New accounts plus parallel legacy GitHub/pairing | Account-only, multiple explicitly selected workspaces and role intersection |
| Approvals | Key-holder approves, AI resubmits | Account-bound approval and server execution, CAS batch, durable R2 recovery |
| Audit | Basic client/tool/status | Account-aware visibility, retention and severe notifications |
| Deletion | Soft account tombstone, credentials retained | Explicit workspace disposition, transfer prerequisite, credential cleanup |
| Recovery | Worker rollback only | External revocation checkpoint and closed restore gate |
| UI | Separate account host and legacy settings | Unified navigation and production identity domain |

## Retire at coordinated cutover

Legacy direct MCP bearer access, GitHub-subject MCP grants, pairing-based MCP
permission expansion, key-holder approval and hardcoded workers.dev identity
links. Do not remove them piecemeal on production before the replacement works.
There is no new multi-key sharing model: historical key hashes are revocation
tombstones only; a personal workspace has at most one active key.

## Migration and release constraints

Use additive registry tables and preserve existing content workspace IDs and R2
prefixes. Backfill metadata from content, memberships and grants. Do not rewrite
notes or copy attachment objects merely to change authentication. Existing
membership ownership must be independently checked during import. Fresh
workspaces use random IDs independent of key hashes.

Before any production data mutation record Worker version IDs and a verified D1
recovery point; verify object inventory if touching R2. Ordinary D1 restore alone
is not a security rollback: external revocation state must be reconciled first.
Until that mechanism exists, do not claim disaster-recovery acceptance.

Production schema, authentication routes and traffic have not been changed by
this audit. Each implementation commit must update
this ledger with actual checks and deployment state; documentation is not proof
of implemented behavior.

## Stage 2 implementation checkpoint

Added an additive workspace registry, a single manager pointer, editor/reader
memberships, one-current-key uniqueness and permanent revoked-key hash tombstones.
Added create/resolve/rotate/associate/list/rename, explicit personal/shared
conversion, member changes and atomic manager transfer service operations.
Mutations recheck manager authority and workspace version in the D1 transaction.
Association requires an authenticated account plus the live key and never
reassigns another account's workspace. Shared mode revokes all key access;
downgrade requires no remaining members and creates a new random key.

Added bounded HTTP APIs with cookie-session verification, CSRF, same-origin
mutation checks, explicit-credential failure without cookie fallback and creation
rate limiting. Sync entry can enforce stable-ID key/account authentication and
reader permissions under `WORKSPACE_IDENTITY_V2=true`. It also blocks legacy
direct MCP/key approval entry points in that mode.

**Activation is intentionally not configured.** Neither production D1 nor either
Worker has been changed. New schema requires the existing account migrations.
Legacy imports require a separate explicit transition setting; revoked verifiers
are never accepted by that compatibility path.

Verified locally with Node 24 + SQLite: migration retry; anonymous creation;
hash-only key persistence; stable ID on rotation; dual key/account access;
association hijack denial; shared key rejection; reader permissions; explicit
mode conversion; atomic manager transfer; role/member OAuth revocation; stale
transaction rollback; CSRF; origin rejection; HTTP credential isolation; actual
sync route cross-workspace and reader-write denial. Existing Worker JSON/CAS/
receipt/isolation regression and actual pinned-provider account OAuth security
regression also pass. This is synthetic verification, not physical-device or
production acceptance.

Still required: metadata backfill/recovery checkpoint; stable-ID Android/Web
storage migration and UI; native account sessions/Credential Manager; canonical
identity domain/Passkey re-enrollment; new OAuth multi-workspace policy integration;
account-bound server-executed approvals; notifications, external revocation gate,
retention/deletion and release acceptance. New service operations are not yet a
complete user-facing system. No production deployment or APK release is claimed.

Added an internal metadata backfill runner with fixed source-table identifiers,
explicit recovery-checkpoint prerequisite, legacy membership preflight, per-space
atomic metadata imports and retry safety. Synthetic checks confirm byte-for-byte
folder preservation and no old-key resurrection after rotation and re-import.
Production invocation and recovery-point verification are still outstanding.

The first PR CI run passed MCP focused checks. The broad media job failed in an
unchanged rich-editor test which waited 100 ms for asynchronous boot/save and
then read a missing IndexedDB record. Replaced those fixed waits with bounded
readiness and the actual UI save/flush completion; the local focused test passes.
The new CI result must be checked separately; no Android/device acceptance is
inferred from synthetic tests.

The next CI run (`4d2432b5`) passed MCP focused checks, including the workspace
suite and OAuth bundle. Broad media integration passed the corrected editor save
check, formatting, JSON Worker and IndexedDB checks, then failed the existing
`scripts/attachment-test.mjs:7`: it sends the obsolete whole-file JSON protocol
and expects 200, while the current attachment server requires chunk/manifest v2
and returns 400. This is an unresolved legacy test/contract mismatch; broad
integration is not green. No claim of full media or Android validation is made.

Broad browser and emulator steps in the integration workflow are manual-only to
respect the requested minimal automation scope. API/data checks and compilation
remain enabled. This does not turn a failed test into a passing result.

## Stage 2 client storage continuation

WebStore now upgrades the existing IndexedDB database from v1 to v2 additively.
Server workspace IDs map to stable local namespaces; credential fingerprints map
back to that workspace. Existing snapshots, in-flight mutations, dirty records,
folder placement, cursor and attachment-cache paths stay in their original slot.
A rotated key can bind to that same slot. A credential already associated with
another workspace is rejected, and separate offline data is never silently
merged/overwritten. Revision CAS still rejects a stale second tab. Public local
workspace lists omit the credential-bearing legacy storage address.

The Web page resolves identities only when the server explicitly marks the page
as identity-v2. Connecting another key verifies its workspace before switching.
Sync policy/history/scope/origin settings and file-cache operations use the local
namespace rather than the current transport credential. The transport uses the
canonical production domain. The server activation setting remains unset.
Anonymous first-run provisioning and a complete workspace selection/rotation UI
still require integration before enabling the flag.

Native SQLite version 2 adds workspace identity and credential-fingerprint
bindings without moving records or attachment files. Native HTTPS resolves a
key's workspace before reconnecting and can reuse an existing local slot after
rotation. The encrypted credential remains bound to that local slot in Keystore;
no raw credential is added to the WebView bridge. Existing local security
checkpoint rollback skips registered workspaces so it cannot overwrite their
current credential with an old checkpoint. Sync metadata lookup respects the
existing network/pause policy and uses the canonical domain. Only an explicit
404 permits old-server compatibility; authentication failures do not fall back.
Android's minSdk 26 SQLite compatibility is retained (no new UPSERT syntax).
Native account sessions and account-only shared workspaces remain unfinished.

Local checks passed: WebStore v1 upgrade, old/new key storage equivalence,
queue/cursor/cache retention, namespace isolation, duplicate-binding retries,
stale-tab CAS, actual Worker workspace permissions and attachment-v2 protocol.
The old attachment-test entry now exercises the real chunk/manifest-v2 endpoint,
including byte round trip, hash/size limits, immutable chunks and workspace
isolation. The editor offline-save and Worker JSON/CAS checks also pass.

For this rebuild branch, the old broad media/UI integration job is skipped;
focused storage/permission/attachment checks and Android Release compilation are
enabled instead. Skipped UI/emulator checks are not reported as passing.
Physical-device SQLite/Keystore upgrade and reconnection are not yet verified.
This checkpoint has not been deployed and production D1 has not been migrated.

## Stage 3 native sessions and canonical-domain checkpoint

Added a gated service-binding proxy from the canonical domain to the existing
OAuth Worker. Canonical OAuth discovery uses the canonical MCP audience and
account authorization endpoint; legacy discovery remains unchanged before
cutover. No activation variable has been enabled on production.

Added native browser-login handoffs bound to S256 PKCE, state, a fixed callback,
recent browser authentication and same-origin CSRF approval. Codes expire in one
minute after approval and are atomically consumed. Exchange rechecks the
approving session, account and credential revocation. Native sessions are tracked
separately, stored hash-only in D1 and accepted with a distinct native header,
never confused with a workspace bearer. Browser session cookies cannot substitute
for a native session. Native tokens cannot be used as browser session cookies in
the new mode. Handoffs preserve the original authentication timestamp rather than
renewing the recent-auth security window.

Android stores pending PKCE verifier/state and the resulting session only in
Keystore envelopes. The WebView sees public status/session metadata only. A
strict callback handler validates flow/state/expiry; browser callbacks contain
only a one-use code. Native logout revokes that device session and explicitly
leaves independent workspace-key access intact. The old-server 404 compatibility
path opens the previous browser portal; other failures do not fall back.

Passkeys use the canonical RP when accessed through the canonical domain. Old RP
credentials remain explicitly usable for recovery at the legacy domain; new
registrations there are blocked in canonical mode. Browser recovery is bound to
an HttpOnly primary-domain cookie plus PKCE and one-use exchange, then asks the
user to register a new-domain credential. Existing credentials are not silently
rewritten. A fixed GitHub callback bridge permits the existing registered legacy
callback to return to the primary-domain login cookie; the exchange continues to
use the configured, strictly allowlisted registered callback.

Additive D1 migration 0004 is required before enabling canonical mode. Local
checks pass for PKCE/state/replay, approval/recovery binding, session/device
revocation, preserved auth freshness, primary RP options, legacy registration
rejection and service-binding fail-closed behavior. Native browser round trips,
physical-device Keystore, Credential Manager and production callback/App Links
remain unverified/unfinished. This checkpoint has not been deployed.

### Native Credential Manager continuation

Added AndroidX Credential Manager 1.5.0 for direct native Passkey signup, login
and enrollment. Public-key responses and PKCE verifiers stay native; the WebView
can request an operation/name and read public account status only. Auth callbacks
check the current encrypted pending-flow record before persisting a session, so
an older browser/passkey result cannot overwrite a newer login attempt. Activity
destruction cancels the system credential operation. The native account entry
now opens a single account page with Passkey, browser/GitHub, enrollment and
logout actions and browser/system back navigation. Full UI consolidation and
native device-management views remain part of the remaining integration.

Native WebAuthn endpoints verify the actual signature using SimpleWebAuthn,
require user verification and the canonical RP, and pin the Android origin to the
existing APK signing certificate. Credential IDs never move between accounts;
enrollment is bound to the authenticated native session. Wrong certificate
origin, browser origin, RP, challenge, UV, signature, user handle, PKCE, expired
challenge and revoked credentials/sessions are rejected in synthetic P-256 tests.

The reviewed development certificate comes from apksigner output of successful
run 40303058214 (certificate SHA-256, not public-key SHA-256). The canonical
assetlinks endpoint is gated with identity activation and grants credential
sharing only to the actual Android package and certificate. Release compilation
now also checks the APK signer against that association; a future signing-key
change must be reviewed explicitly. No private signing key was read/exported.
The user has not yet selected a final production signing scheme.

This is source/test completion of the native credential paths, not a real-person
or physical-device Passkey round trip. Canonical identity flags, D1 migration and
Digital Asset Links are not live yet. Native account-workspace selection/sync,
remaining OAuth policy work and full release acceptance are still outstanding.

### Stage 3 validation follow-up

At 5f9dadd8, Android Release compilation, existing unit checks, signing verification
and the new APK/Passkey certificate-association check passed (run 40315492316).
The MCP job failed before OAuth dependencies were installed because the native
Passkey module was imported eagerly. It is now loaded only for its own routes,
matching the existing browser Passkey module boundary; the focused pairing test
passes locally again. The next CI result must be checked before reporting green.

Added native authenticated device listing and account-scoped device revocation.
Other-device revocation requires recent verification; another account's device
cannot be revoked. Native tokens cannot substitute for browser cookies. Local
API tests verify those boundaries and that revoking the approving browser device
blocks an unfinished handoff without invalidating an already-established separate
native session. The account page now exposes the device list and per-device
logout through native-only HTTP; no token crosses the WebView bridge.

## Stage 4 multi-workspace OAuth checkpoint

Added per-policy workspace bindings and explicit scope ceilings. The account
consent page starts with no selected workspaces and supports choosing several;
readers cannot receive write capabilities. Authorization rechecks the account
session, workspace version and role inside the D1 transaction. New `workspace.create`
and `workspace.write` scopes cover account-associated creation and manager-only
ordinary settings/rename; no AI membership/key/security operations are introduced.

Every MCP content request intersects token scope, the child authorization and the
current role. Changes to membership/manager/mode permanently retire the affected
child authorization; a later role increase cannot revive it. Other workspaces on
the same policy remain usable. Multi-workspace content operations require an
explicit server-validated workspace ID, avoiding mutable-selection races between
parallel calls. Catalog/initialize calls still work without an active workspace.
AI creation returns no key and does not expand the client's content grants.

Canonical-mode legacy issuer token issuance, direct GitHub claims and pairing
entry points are retired. Account ticket/upload/download permission resolution
uses the new child bindings. The canonical account page lists current roles and
client workspace grants; old key-claim UI is removed. The old deletion path is
blocked in the new mode until the explicit disposition/transfer flow is ready,
so it cannot orphan shared workspaces.

The actual pinned OAuth Provider passes local checks for canonical discovery,
no-default-workspace consent, tenant/reader isolation, explicit per-request
routing, role attenuation/no revival, unrelated child survival, account-bound
creation without keys/automatic grant growth, manager rename, refresh rotation,
parent revocation and legacy bypass denial. All data and identities are synthetic.
Migration 0011 and coordinated activation are not applied in production.
High-risk server-executed approval and final UI/workspace integration remain
unfinished; this checkpoint is not a production cutover.

Resource URIs also carry an explicit authorized workspace selector, with that
selector preserved in returned URIs to prevent cross-workspace cache ambiguity.
Resource catalogs/templates advertise the selector; unauthorized resource access
uses a JSON-RPC error rather than a malformed tool-result response. Synthetic
checks cover workspace-qualified resources and foreign-workspace denial.

### Stage 5 checkpoint: account approval and atomic note batches

Stage 4 commit b5db3c38a5bbf614f44b0137a49473317f28444a passed both
GitHub Actions MCP focused checks and Android APK compilation/signing checks.

Migration 0012 adds durable account operation receipts and a shared small-write
budget. New-mode batch metadata updates, moves and soft deletions (1–100 unique
notes) now produce account-owned approval URLs instead of consuming legacy key
approvals. All batches require approval at this checkpoint, including small ones.
The initiating account must log in and submit a CSRF-protected form within ten
minutes. The server executes automatically; MCP only polls its own policy's
status. The existing account appearance is reused, with final visual integration
still pending. No approval URL acts as a bearer capability.

A single D1 batch checks current account/session/passkey state, parent and child
OAuth grants, role/scopes, all frozen note versions and the destination folder,
then updates all targets and the completion receipt atomically. JSON target joins
keep the number of D1 statements bounded even with 100 notes. Sync change-feed
triggers remain active. Failed target/authority assertions roll back all writes;
a committed completion receipt makes network retries idempotent.

Unapproved note-target mutations share an account/workspace rolling ten-minute
budget across OAuth clients. The 21st small move, soft delete or metadata update
becomes an account approval; unsupported mutation types stop at the threshold.
This is conservative (failed attempts also consume budget). Dangerous whole-
document replacement and legacy high-risk operations without the new executor
are denied in the new mode until implemented, rather than using key approvals.

Synthetic checks cover foreign-account URL access, CSRF, expiry, revocation,
server-side execution, repeated approval, concurrent final-target conflict with
25 targets, authorization/destination rollback, and small-write threshold.
Existing MCP, account OAuth and Passkey regression checks also pass locally.
No production migration, flag activation, deployment or main merge occurred.

Still incomplete in stage 5: permanent note/attachment deletion, folder clearing,
whole-document overwrite approval, durable R2 cleanup/recovery and scheduled
retries. Stage 6 notifications/retention/account deletion/restore checkpoints and
final workspace/UI integration remain outstanding. This is not the 0.8.0 release.

### Stage 5 extension: permanent operations and recoverable R2 cleanup

Adds approval executors for terminal note purge, whole-document overwrite and
clearing up to 100 direct notes in a folder (subfolders are explicitly excluded).
A normal notes_update containing a document is routed to approval. Purge clears
content and previous receipt payloads in the same D1 transaction, while retaining
the terminal note/sync tombstone. Folder clear also checks that its target set
has not gained, lost or moved any active notes since the preview.

Migration 0013 adds immutable attachment tombstones, reference-blocking SQL
triggers and durable leased R2 purge jobs. Attachment versions are their SHA-256
content addresses. Approval checks absence of references, including soft-deleted
notes, in the D1 transaction that fences all future attachment access and queues
cleanup. Every chunk/manifest reader and writer uses the fence; in-flight writes
remove their own late objects. Failed physical cleanup leaves access revoked.
The existing scheduled handler resumes bounded pages, with up to five storage
failure retries. A daily reconciliation of completed jobs catches late objects;
no whole-bucket deletion or shared D1/R2 transaction is assumed. Status queries
expose cleanup separately from the committed authorization/deletion decision.

Checks pass for terminal purge/offline replay, receipt content erasure, overwrite
approval routing, folder target-set changes, reference races, blocked reattachment,
R2 outage/retry/pagination, late PUT cleanup and preservation of adjacent objects
and other workspaces. Existing MCP upload/attachment paths still pass. No live
R2 objects or production D1 data were changed. Remaining stage 5 work includes
bringing older empty-folder/reversible-retirement approvals into this executor
and operational recovery UI; stage 6 and final client/UI integration still gate
production activation.
