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
