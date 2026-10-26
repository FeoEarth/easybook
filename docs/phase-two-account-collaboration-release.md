# Easybook 0.8.0 phase two

## Scope

Android account Credential Manager Activity context, distinct errors, operation feedback, durable logout revocation and fixed first-party native HTTP transport. Browser GitHub handoff and Passkey RP remain `https://easybook.loonxy.com`; Meta AI's OAuth flow is retained. The native workspace bridge permission is now explicitly allowed and tested. Account-only shared workspace activation uses an encrypted local placeholder, never an anonymous server credential.

Shared workspace member listing, personal/shared conversion, member role changes/removal, manager transfer and explicit member exit are connected in Web/Android. Server roles remain authoritative. Native account management now exposes client/workspace grants, server-executed frozen approvals, audit history and account deletion. Retained workspace key proofs stay in the Android vault and are injected only into the fixed HTTPS request. Browser account management includes scopes, recent activity, child revocation and audit filters.

Independent security D1 fences protect child OAuth revocations and workspace deletion. Workspace deletion fences access first and queues bounded D1/R2 cleanup; terminal security/key/note tombstones remain. Unknown transaction outcomes remain fenced. Existing attachment cleanup retries and result queries are preserved.

## Migration and recovery

Only new migration: `worker/migrations/0017-stage-two-audit.sql`. It adds three idempotent triggers for Passkey addition, OAuth authorization and child grant revocation. It does not alter user content or delete data.

Before migration, Cloudflare returned the same business-D1 recovery bookmark for current state and timestamp verification:

- UTC: 2026-10-26T19:07:10.766Z (Singapore: 2026-10-27 03:07:10).
- Bookmark: `00000113-0000001a-00005110-dc8251281d7aa367dd5144c66a378161`.
- Independent security checkpoint is open; business and security epochs match.

Recovery must follow `security-checkpoint.mjs`: block access, restore business D1, reconcile to a new security epoch, revoke old sessions/OAuth, then reopen only reconciled workspaces. Never restore the independent security D1 from an older business backup or raise workspace versions to bypass floors. A code rollback does not require reverting these additive audit triggers.

## Verification boundaries

Synthetic SQLite/cryptographic tests cover native PKCE handoff, signed Android-origin Passkeys, workspace isolation and live roles, child/parent OAuth revocation, frozen one-time approvals, deletion/key proofs, audit visibility, D1 rollback protection and bounded R2 cleanup. Native bridge unit tests reject unexpected fields and stale documents.

Android compilation and APK signer/Digital Asset Links consistency are separate CI gates. Real-device GitHub login, Passkey signup/login, restart restoration and sign-out remain **not verified** until exercised on an Android device. Browser tests and CI status must be recorded for the final commit; a compiled APK is not a successful real-device login.

The zone's Free Bot Fight Mode may challenge non-browser requests and cannot use per-path skip rules. The native client therefore uses the existing fixed Workers API transports, while browser URLs and the Passkey RP remain canonical. Zone protection settings are unchanged. CI records a pre-existing custom-domain challenge separately and still requires real Worker runtime probes.

Production migration, final commit, deployment IDs and release APK are recorded after publication.
