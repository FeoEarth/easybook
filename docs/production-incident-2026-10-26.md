# Easybook production incident — 26 October 2026

## Confirmed root cause

Both failed production releases shipped a stale `worker/ui.mjs` generated file containing literal backslash-n tokens between JavaScript statements in the HTML application's inline script. The HTML parser therefore delivered invalid JavaScript to the browser. The application script failed at parse time, before it could bind buttons or initialize the note list. This was a frontend boot failure while the Worker itself continued returning successful HTTP responses.

Evidence:

- GitHub `main` inspected at `0f4b854d708a43829cbbf507f8a8d64d45643cab`.
- `worker/ui.mjs` blob `4c8e57bf1f1752027617a6901632f28f2a7033d3` was identical in both failed release source commits `2404f63242497d2a205b8ad61689dbc7189be3c1` and `108e94fb7eaa0244e6318f2942e32c255427bd6b`.
- Extracting the generated HTML's inline script and running `node --check` produced `SyntaxError: Invalid or unexpected token`, at inline script line 260, before the `mcpPairEntry` handler.
- The checked-in Android HTML source contained real newlines and an updated same-origin attestation call; it did not match the generated Web HTML.
- Real browser visits to both historical version URLs reproduced the same SyntaxError without changing production traffic:
  - `https://bfc1704f-easybook-sync.1902521952.workers.dev/`
  - `https://4f4bcaae-easybook-sync.1902521952.workers.dev/`
- The stable version's inline script passed syntax checking, and its list and settings controls worked in a real browser.

## Release correlation

All times below are UTC; add eight hours for Singapore.

| Incident | Actions run | Source SHA | Worker version | Deployment |
| --- | --- | --- | --- | --- |
| First | 40228349118, deploy-cloudflare.yml | 2404f63242497d2a205b8ad61689dbc7189be3c1 | bfc1704f-f458-41ec-b51f-fbafb325e75f | 2713cd48-1924-499a-ab64-1570c236907c |
| Second | 40228771015, deploy-cloudflare.yml | 108e94fb7eaa0244e6318f2942e32c255427bd6b | 4f4bcaae-15ec-4fb9-9253-e034ef76b6f1 | 4c6713d2-8c21-4933-8575-3c32363af0d8 |

The first release ran Wrangler 4.152.0 at 19:56 UTC, did not regenerate the editor or HTML modules, and only checked `/health`, which returned success. The second ran the same Wrangler version at 20:01 UTC and passed its bundle dry run. Its post-deploy check passed the workers.dev health and HTML requests, then received 403 on the custom-domain health request. That check had no rollback step. Neither workflow exercised browser JavaScript.

There was also a main Worker deployment by `deploy-mcp-pairing.yml` at 20:00:48 UTC, version `8826bbc8-d119-403e-8aa9-321fc31e161f`, between the rollback and the second main deployment. Independent workflows could overwrite the same Worker. The OAuth workflow must no longer upload the main Worker.

The historical 403 is a separate observation, not proof of a Worker crash. A current runner request against the unchanged stable production version independently reproduced HTTP 403 with `cf-mitigated: challenge` and title `Just a moment...`. This establishes a current Cloudflare security challenge; the exact historical rule/ray was not recovered. Workers telemetry recorded 200/304 responses from the failed versions and no matching Worker exceptions in the incident window. Successful HTTP delivery did not imply that the application booted.

## Production baseline and configuration

At investigation start, deployment `c5d43c39-444b-4f64-a365-f8ad0f791e93` served version `9af5501c-d93d-4836-a1eb-411dae44a548` at 100%.

Both stable and failed versions contained DB (D1), ATTACHMENTS (R2), PDF_ASSETS, GitHub OAuth secrets, and MCP_PAIRING_SIGNING_KEY. Their runtime compatibility date, nodejs_compat flag, and asset worker-first settings matched. Missing bindings are not supported as the root cause. The failed version omitted the plain RELEASE_SHA variable, explaining its blank health commit; this was not the frontend parse failure.

The custom domain was enabled for `easybook-sync`. OAuth retained its DB, OAUTH_KV, GitHub identity secrets, grant-mode flag, and pairing-signing secret bindings. No secret values were read or logged.

## Minimal repair and prevention

- Regenerate `worker/ui.mjs` from the authoritative HTML source. Preserve editor, UI design, notes, attachment, and sync implementation.
- Compare generated modules to committed source; parse every inline application script and the editor bundle before any upload.
- Pin Wrangler 4.152.0. Upload versions without sending production traffic, then test the exact version URL with real Chromium.
- Exercise list interaction and editor creation; check health and cross-Worker HMAC using a synthetic unknown challenge. This verification never reads notes or creates a real workspace grant.
- Record the custom-domain pre-release HTTP baseline. If CI is already challenged by Cloudflare before deployment and remains identically challenged afterward, report that check as BLOCKED, never as a browser verification pass. The mandatory canonical Worker browser checks and API/HMAC checks still run, and the custom-domain-to-Worker mapping is verified through the Cloudflare API. Do not weaken zone security to make CI pass.
- Record the current production version vector before upload. Promote only if the production baseline has not changed. After promotion verify both public origins. On failure/cancellation, restore the exact recorded version vector and verify it, unless a different deployment has intervened.
- Exercise the same rollback implementation on a separate binding-free synthetic Worker before release. Rollback never runs SQL, migrations, or R2 operations.
- Keep only one deployment workflow per Worker, with separate concurrency groups and release-state artifacts.

## Confirmed pairing root cause

The HTML CSP declared `connect-src 'self' https://easybook-sync.1902521952.workers.dev` but omitted the MCP OAuth origin. Real Chromium logged: connecting to the OAuth Worker's `/pairing/complete` violates that connect-src directive. The main Worker returned attest HTTP 200, then the browser blocked the next request locally, so no completion reached the OAuth Worker. This explains the generic network/CORS message even when attestation and signing were working. CORS-only patches could not fix it.

The repair adds only `https://easybook-mcp-oauth.1902521952.workers.dev` to connect-src. No wildcard, untrusted Origin, workspace-key exposure, or authentication bypass is introduced. A static assertion guards this exact CSP dependency.

## Pairing corrections

The main UI now uses the already-correct same-origin `/api/mcp/attest` source. Untrusted explicit browser origins are rejected. The OAuth completion handler returns allowed-origin CORS headers on expected errors and sanitized server errors; it does not relax authentication or expose workspace keys.

Grant creation, active-workspace selection, and one-time challenge consumption are now one D1 batch transaction. A failed grant write cannot consume the challenge and strand a retry. Tests cover an injected database failure, retry, replay rejection, HMAC tampering, unauthorized origin, unpaired initialization, grant status, and revoke, using an in-memory synthetic database. Provider authentication is not mocked as a production endpoint: the handler test supplies a synthetic trusted context, and live discovery/401 checks separately confirm authentication remains enforced.

## Verification limits

A real ChatGPT OAuth token is not available to this execution environment. Do not describe an authenticated ChatGPT reconnect or real-client tools call as verified merely because handler tests pass. Use only authorization-status tools for final user-client verification; never read real notes as a smoke test.

Do not claim a browser pairing attempt succeeded unless the UI and synthetic grant state both confirm completion. Retain failed attempts as evidence and distinguish network/environment limitations from confirmed server defects.

## Verified release evidence

- GitHub run 40251721077 passed generated-source checks, real Chromium candidate boot and editor interaction, live HMAC verification, custom-domain baseline classification, and a real Cloudflare rollback drill.
- Run 40251520493 captured the decisive CSP failure after attest HTTP 200 and before any OAuth completion request.
- The new OAuth completion batch was exercised against production D1 using a synthetic GitHub identifier and synthetic client. A scoped query confirmed one consumed challenge and exactly one read-only grant. No user notes were accessed.
- Temporary challenges and grants are scoped to `synthetic-release-probe` and task-generated client IDs; clean up only those exact rows after verification.

Full browser pairing passed in run 40252311963: the exact fixed source HTML was served in a fresh synthetic browser context under the canonical production origin, using the unchanged production editor bundle and authenticated attestation endpoint. Chromium observed attest 200, completion 200, and the pairing dialog closed. An independent scoped D1 check confirmed the one-time challenge was consumed and a single read-only grant existed. The new atomic OAuth batch had additionally been exercised through candidate version 1149ffed-ddc7-4c24-b502-88f3491fdaf0 with a separate synthetic challenge.
