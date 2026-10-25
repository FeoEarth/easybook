# Easybook MCP: app-managed workspace authorization

## Goal
Replace the global MCP_WORKSPACE_KEY with per-client, per-workspace grants controlled from Easybook Settings > AI & MCP. Switch or revoke access without Cloudflare dashboard edits.

## Trust boundaries
GitHub OAuth verifies a GitHub user, **not** ownership of an Easybook workspace. The existing sync Worker verifies a 64-hex workspace key and derives a SHA-256 workspace identifier. Never authorize based only on a workspace ID supplied by a browser, AI client, or OAuth identity.

## Protocol
1. OAuth Worker issues a short-lived, single-use opaque pairing challenge tied to authenticated GitHub user ID and OAuth client ID.
2. Easybook Android/Web presents the challenge and sends it to an authenticated sync Worker endpoint using the existing workspace credential; Android must keep the key in native Keystore, not WebView JavaScript.
3. The sync Worker attests the derived workspace ID to the OAuth Worker through a trusted server-to-server channel, using a service binding or authenticated signed assertion. No raw key is sent to the MCP Worker or stored in D1/KV.
4. OAuth Worker atomically consumes the challenge and stores a D1 grant: github_user_id, oauth_client_id, workspace_id, scope, created_at, revoked_at. Enforce unique constraints and expiry.
5. Each MCP tool call resolves the OAuth identity and client, checks an active grant, and uses its workspace ID to query D1. If multiple workspaces are authorized, require an explicit active workspace selection; never silently aggregate.
6. Easybook settings lists clients and workspaces, supports grant/switch/revoke, and revocation invalidates access even for existing OAuth tokens.

## Security requirements
- Read-only tools only: list_folders, search_notes, get_note.
- Deny by default; verify grants on every tool call.
- Do not log or return raw sync keys, OAuth codes, state, tokens, or note content.
- Bind challenge to identity and client; short expiry, one-time consumption, CSRF protection, rate limits.
- Client A must not read client B's workspace grants.
- Retain existing GitHub numeric ID allowlist and PKCE S256.
- Preserve production sync API and existing notes; no destructive migration.
- Existing MCP_WORKSPACE_KEY remains legacy-only until full migration, not an automatic grant to any OAuth client.

## Implementation sequence
1. D1 schema and grant enforcement.
2. Pairing challenge and authenticated sync-worker attestation.
3. Android/Web Settings > AI & MCP controls.
4. Workspace switching and revocation; remove legacy fallback after migration.
5. Minimal end-to-end verification: pair, read, switch, revoke, unauthorized client rejection.

## Acceptance
No Cloudflare secret edits for switching; unauthorized GitHub OAuth cannot read workspaces; no raw key exposure; revocation blocks already-issued tokens; cross-workspace isolation verified.
