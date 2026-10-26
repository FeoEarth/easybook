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
this audit. Stages 2–8 remain incomplete. Each implementation commit must update
this ledger with actual checks and deployment state; documentation is not proof
of implemented behavior.
