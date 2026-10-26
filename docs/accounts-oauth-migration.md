# Easybook Account / OAuth compatible migration (phase 1)

## Identity boundaries

`accounts.id` is an opaque random UUID, independent of the GitHub subject, workspace fingerprint, sync key, OAuth client ID and grant ID. GitHub is the first verified identity provider, not the account ID. Existing single-owner GitHub OAuth remains supported. No email-only linking or password protocol is introduced. Email verification and Passkey enrollment are not implemented in this release.

Browser login uses the existing registered GitHub callback on the OAuth Worker. The account login state is separately namespaced, hashed in D1, bound to a short-lived HttpOnly browser cookie and atomically consumed. GitHub access tokens are only used on the server to verify `/user`; they are not persisted. The resulting account cookie is random, hashed in D1, HttpOnly, Secure, SameSite=Lax, host-only and expires after seven days. Every login creates a fresh session. Management mutations require same-origin POST and a session-bound CSRF field. Destructive account deletion additionally requires authentication within five minutes.

Android opens the fixed account portal in an external browser through an allowlisted bridge method. It does not receive an account/OAuth token or callback, and existing Keystore sync credentials remain native. This phase provides browser account management from Android, not a native account sign-in session or verified App Link callback. Native workspace claiming and a native OAuth client are follow-up work. Existing local data, editor and offline sync are unchanged.

## Workspaces

The sync key is not a password. Knowing a workspace ID confers no ownership. A logged-in user obtains a random five-minute claim challenge bound to their account and session. A device already holding the sync credential obtains the existing two-minute HMAC attestation from the sync Worker. The account server verifies that proof and consumes the challenge in the same D1 transaction that creates ownership. One active owner is enforced by a partial unique index. No existing pairing grant is silently converted to ownership.

Web claiming is intentionally explicit: open `/account/connect` on the connected Web device, enter the account-page challenge, generate the proof and paste it into the account page. Only the short-lived, challenge-bound proof leaves the sync origin. It is not a sync key and cannot be used for another challenge. Account login alone never retrieves an old sync credential.

## OAuth endpoints

Issuer: `https://easybook-mcp-oauth.1902521952.workers.dev`

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-authorization-server` | Existing issuer metadata, with supported scopes |
| `/.well-known/oauth-protected-resource/mcp` | Canonical RFC 9728 resource metadata |
| `/.well-known/oauth-protected-resource` | Compatibility alias for that metadata |
| `/oauth/authorize` | New account login, workspace and scope consent |
| `/oauth/token` | Alias for existing Provider `/token` |
| `/oauth/revoke` | RFC 7009 alias for existing Provider `/token` |
| `/oauth/clients` | Authenticated list of this account's granted client IDs |
| `/oauth/grants` | Authenticated grant list and CSRF-protected revoke forms |
| `/register` | Existing Dynamic Client Registration |
| `/authorize`, `/callback`, `/token` | Preserved legacy OAuth routes |
| `/account` | Account, sessions, workspaces, applications and deletion |
| `/pairing/complete` | Preserved legacy pairing |

Resource audience: `https://easybook-mcp-oauth.1902521952.workers.dev/mcp`. Exact redirects, PKCE S256, authorization-code lifetime, token resource binding, DCR and Client ID Metadata Documents remain delegated to the pinned `@cloudflare/workers-oauth-provider` 1.2.4. CIMD uses `global_fetch_strictly_public` to prevent private-network fetches. No custom OAuth token format or password exchange is introduced.

The default metadata authorization endpoint remains `/authorize` during phase 1, which now links to account authorization with the same validated query. Do not switch it until an actual account login and client reconnection have been confirmed. Existing tokens, refresh records and GitHub user IDs in Provider KV are neither rewritten nor bulk-revoked.

New account Access Tokens last five minutes, Refresh Tokens up to thirty days. Provider crypto and refresh rotation are retained. A D1 hash-only single-use ledger adds atomic authorization-code and Refresh Token replay prevention for new UUID account subjects; replay of a previously validated credential revokes its account policy. Retries after interrupted/invalid exchanges fail closed and may require reauthorization. Legacy numeric subjects retain their current refresh behavior for compatibility. The ledger must not be purged before the grant family expires.

New grants bind account, workspace, client and approved scopes in D1. Every MCP request and token refresh rechecks the account, membership and policy. Revoking an application immediately disables its entire new grant policy, including derived upload/download tickets and pending confirmations. Internal ticket client IDs are namespaced by policy, so another authorization of the same public OAuth client cannot inherit a revoked grant's tickets. RFC revocation uses the Provider's client validation and also marks the matching locally issued token policy revoked. Token values are never written to D1, URLs or logs; only hashes are recorded. Existing short-lived attachment download tickets are unchanged.

## Scopes

`notes.read`, `notes.write`, `notes.delete`, `folders.read`, `folders.manage`, `tasks.read`, `tasks.manage`, `attachments.read`, `attachments.write`, `workspace.read`.

The consent page shows the application-supplied name plus its client ID and exact redirect URI, and requires choosing a member workspace. Read scopes requested by a client are selected initially; write scopes require explicit selection. Empty scope defaults to `workspace.read`. Legacy `mcp:read` requests can map to the visible set of read permissions on the new account consent page. Adding scope requires a new OAuth consent; legacy permission-approval tools cannot widen an account token. Tool checks remain authoritative; Resources dispatch through those same checks. Prompts are static instruction templates and do not read workspace data. Workspace activity additionally requires `notes.read`; summary requires note, folder and task reads. Inserting/removing an attachment in a note also requires `notes.write`.

## D1 migration and rollback

Apply `mcp-oauth/migrations/0002_accounts.sql` before promoting the new Workers. It creates only account/session/ownership/policy/replay tables and indexes with `IF NOT EXISTS`. OAuth client metadata, authorization codes, cryptographic grant records and refresh-key material remain in the existing Provider KV rather than being copied to duplicate D1 tables. Run the migration twice against synthetic SQLite as a retryability check; inspect `sqlite_master`/`PRAGMA table_info` on production. It does not select or mutate note rows and does not touch R2.

Deploy with the existing candidate-upload, smoke, promote and baseline-rollback workflows. Rollback the Worker versions; leave these additive tables in place. Never roll back by deleting a production database, dropping note tables or deleting R2 objects. Account deletion is a soft tombstone with session/policy revocation; source notes, attachments and old sync access remain. Old GitHub/pairing authorizations require their existing revocation flow and are not automatically revoked by account deletion.

## Validation and remaining work

`node scripts/account-oauth-security-test.mjs` executes the actual pinned Provider against synthetic SQLite and KV, covering identity state consumption, cookie attributes, CSRF, proof validation, ownership isolation, PKCE mismatch, code replay, refresh rotation and replay, scopes/resources, revocation, foreign tokens, discovery and session revocation. The GitHub identity transport is simulated; no actual person is signed in. `EASYBOOK_ACCOUNT_UI=1` additionally renders account and consent pages at 360px in light/dark Chromium and saves CI screenshots. Existing GitHub identity, pairing, 55-tool capability and upload regressions remain enabled. CI also bundles both Workers and builds Android.

Unverified until an actual user performs them: real GitHub account-login round trip, a real ChatGPT reconnection to the new account flow, and Android device appearance. Protocol initialize in synthetic tests is not evidence of a real ChatGPT connection. Passkey/email onboarding, native verified callback integration, membership invitations/transfers and automatic claim handoff are future work. Expired-account metadata retention/cleanup and a broader production rate-limit policy need follow-up before public-scale signup. This is a compatible minimal first phase, not the completion of every long-term account feature.
