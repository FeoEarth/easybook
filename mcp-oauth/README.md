# Easybook MCP OAuth Worker (isolated)

This Worker is **not deployed** and is intentionally isolated from the production `easybook-sync` Worker. It reuses the same D1 binding, without changing the existing sync endpoint.

The MCP endpoint is `/mcp`, with OAuth `/authorize`, `/token`, `/register`, and GitHub `/callback`. The GitHub OAuth App callback must point to the actual hostname of this **new** Worker, not the sync Worker. Set GitHub OAuth secrets and a server-only workspace key before enabling. The upstream GitHub OAuth access token is discarded immediately after identity verification and never exposed to MCP clients.

Before deployment: create an OAuth KV namespace, replace its placeholder in wrangler.jsonc, provision GitHub OAuth App for this host, set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `MCP_WORKSPACE_KEY` as secrets, and validate OAuth redirects, PKCE, token audience, user allowlist and workspace separation. The current OAuth Worker must remain disabled until these checks pass.
