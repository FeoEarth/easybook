# Independent revocation checkpoint and disaster recovery

Status: implemented and checked with synthetic databases. Not activated in the
production Workers. Do not enable identity/workspace production flags until the
remaining client integration and release checks are complete.

Business D1: `easybook-data` (`af430aed-01b5-41ca-9653-31212bed3f9f`).
Independent security D1: `easybook-security`
(`d1761c2d-6372-489c-ae5e-114f3d5baa80`). Its schema is installed, but all six
tables are empty and no security epoch has been initialized. Production Worker
bindings and traffic have not been changed.

## Initial coordinated activation

1. Capture and verify recoverable business D1/R2 recovery points and current
   Worker deployment/configuration references. Preserve secrets out of logs.
2. Deploy the independent binding and checkpoint code in maintenance mode. Enable
   `SECURITY_CHECKPOINT_V2=true` before initialization, which deliberately blocks
   remote auth until the security epoch and business marker agree. Drain active
   requests and running mutations before taking the baseline.
3. Apply business migrations through 0016 in their documented dependency order.
   Apply `worker/security-migrations/0001-checkpoint.sql` ONLY to the security D1.
   Neither database may be substituted for the other. Business/identity normal
   migrations must never run against the security binding.
4. An authenticated administrative operator invokes `initializeCheckpoint` from
   `worker/security-checkpoint.mjs` with the two bindings. It copies existing
   deleted-account/revoked-passkey and workspace-version safety state, writes the
   business marker, and opens access only after completing initialization.
   Pre-checkpoint sessions and OAuth policies are invalidated by the time floor.
   Initialization refuses an existing checkpoint or an existing business epoch.
5. Validate effective bindings/flags and only then perform coordinated client /
   identity activation. There is deliberately no public recovery/initialization
   HTTP route and no way for an MCP client to open the gate.

## Restore business D1 / R2

1. Keep the independent security database and its immutable records outside the
   business rollback. Do not import business snapshots into this database.
2. Invoke `beginSecurityRestore` and retain the returned epoch in the operator
   record. This blocks remote auth and changes the external epoch before any
   business restore. Pause/drain ongoing work and verify leases/in-flight
   mutations are settled before restoring. Scheduled destructive jobs also
   respect the recovery gate.
3. Restore only the business data from the selected verified recovery point.
   Cloudflare platform Time Travel and any Easybook self-built backup are
   separate sources; neither carries the independent revocation database back
   in time. Preserve the current deployment and checkpoint bindings.
4. Invoke `reconcileSecurityRestore(env, epoch)`. It revokes all account/device
   sessions and OAuth grants, cancels pending approvals and discards login,
   Passkey and handoff challenges and download tickets. Review the exact source
   backup and reconciliation result before reopening.
5. Invoke `openSecurityRestore(env, epoch)`. A wrong epoch, missing reconciliation,
   active session/grant or missing checkpoint fails closed. Users must log in and
   explicitly authorize OAuth clients again.
6. Workspaces older than their external security-version floor stay quarantined.
   This intentionally sacrifices availability instead of reviving an old manager,
   member or sync key. Recover an adequately recent verified security state; do
   not increment versions or cancel committed floors to bypass quarantine.
   Deleted accounts/workspaces and revoked credentials remain denied externally,
   even if their old rows reappear in the restored business database.

Security revocation intents are written before the business transaction. Known
constraint rollback cancels only that operation's intents. A lost commit response
leaves pending protective fences; an operator must inspect the actual primary
business outcome before resolving ambiguity. Never automatically cancel an
unknown-outcome intent. Reads use the security D1 primary session and no global
in-memory cache of revocation state.

If the security database itself is lost, stop access and recover that database
and its revocation history separately. Do not initialize a new empty checkpoint
against an old business backup. Security records have no ordinary log TTL.

## Current delivery limits

The separate D1 infrastructure and empty schema exist. Business migrations,
checkpoint initialization, production bindings/flags and restore operations have
not been applied. The internal administrative functions are not exposed through
a deployed management endpoint. Production execution uses the operator-controlled cron runner described below,
with both bindings and recorded recovery points.

Verified email delivery is blocked by the current connector's HTTP 401 response
for Email Sending inspection. Android push provisioning and the self-built
30-day backup lifecycle are not implemented. No push/email registration currently
exists for account deletion to unregister; this must be wired when those channels
are introduced. These are release blockers, not completed capabilities.


## Operator-controlled cron runner

`worker/security-admin.mjs` runs only from the main Worker's scheduled handler.
It accepts no HTTP, WebView Bridge or MCP commands. An authenticated Cloudflare
operator sets these Worker configuration variables for one reviewed action:

- `SECURITY_ADMIN_ACTION`: `initialize`, `begin-restore`, `reconcile` or `open`.
- `SECURITY_ADMIN_REQUEST`: a unique UUID for this exact action.
- `SECURITY_ADMIN_EPOCH`: the previously recorded epoch, required for reconcile
  and open. Never guess it or advance it to bypass a failed check.

Read the result from `security_admin_runs` using authenticated Cloudflare D1
access. A duplicate cron with the same request never repeats the action. An
unknown outcome is marked `uncertain` and requires operator inspection; changing
the nonce must not be used as a blind retry. Ordinary scheduled cleanup pauses
while this configuration is present. Clear all three admin variables after the
reviewed action finishes, and preserve the ordinary cron configuration.

The completed baseline has an immutable `security_installation` marker. An
interrupted initial copy cannot be reopened using the restore/reconcile runner.
The empty production checkpoint has no installation marker and remains inactive.
