# Easybook MCP OAuth deployment

Status: **build validated; not deployed**. This Worker is separate from production `easybook-sync` and does not modify Android/Web.

## Already provisioned

- Worker name: `easybook-mcp-oauth`
- KV binding: `OAUTH_KV` (`788971285844492d89386e614315bb0a`)
- D1 binding: `DB` (existing Easybook database)
- GitHub numeric user allowlist: `236202359`
- CI: `cd mcp-oauth && npm install && npx wrangler deploy --dry-run`

## Required before going live

1. Deploy from the `mcp-oauth` directory using a Cloudflare-authorized Wrangler session; do not deploy over `easybook-sync`.
2. Choose the actual Worker URL (e.g. `https://easybook-mcp-oauth.<subdomain>.workers.dev`), then update the GitHub OAuth App's **Authorization callback URL** to `<actual-worker-origin>/callback`. The previous `https://easybook.loonxy.com/callback` is for the sync hostname and will not reach the isolated Worker.
3. Set **secrets on the new Worker**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `MCP_WORKSPACE_KEY`. Existing OAuth credentials on `easybook-sync` are not automatically shared. Never copy the client secret into GitHub source or CI logs.
4. Pair the correct Easybook workspace by provisioning the existing 64-hex-character workspace key as `MCP_WORKSPACE_KEY` **server-side only**. This is the current single-workspace implementation; a multi-workspace OAuth pairing UI is not implemented. Never ask users to paste their sync key into an MCP client.
5. Verify GitHub login, allowlist rejection, consent, PKCE, token exchange, `tools/list`, and `get_note` on the deployed Worker before announcing availability.

The upstream GitHub OAuth access token is used only to fetch `/user`, then discarded. The MCP client receives only a provider-issued token with `mcp:read`.

## Operational notes

- The isolated Worker must have a separate callback origin from the existing sync Worker.
- Do not treat a successful `wrangler --dry-run` as a successful deployment.
- Without `MCP_WORKSPACE_KEY`, the MCP API fails closed.
- The OAuth app credentials previously disclosed in chat should be rotated before public launch.
