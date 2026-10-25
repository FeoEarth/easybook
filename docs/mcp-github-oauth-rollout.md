# Easybook MCP — GitHub OAuth rollout plan

Status: **not enabled**. This document is a production security gate, not a claim that OAuth has been implemented.

## Architecture

- Reuse the existing Cloudflare Worker D1 notes data and MCP read tools.
- Use Cloudflare Workers OAuth Provider (current v1) with GitHub as upstream identity provider.
- Validate the GitHub numeric user ID against an explicit allowlist after verifying identity via GitHub API. GitHub repository ownership or matching display name is not authorization.
- Map each authorized GitHub identity to an explicitly paired Easybook workspace. Do not infer the workspace from the GitHub account or expose sync keys to the MCP client.
- Use short-lived access tokens, PKCE, state, exact redirect URI validation, client registration protections, token revocation and explicit consent.
- Initially issue only `notes:read`. No note mutation, folder mutation, attachment content, or administration scopes.
- Use separate OAuth token storage (Cloudflare KV or D1 with dedicated tables) and a separate GitHub OAuth App.
- Preserve `/api/*` sync authentication and the existing Android/Web application unchanged.

## Production prerequisites

1. **Confirmed allowlist:** GitHub login `FeoEarth`, immutable numeric GitHub user ID `236202359` (verified using the connected GitHub profile). Enforce the numeric ID after querying the authenticated GitHub identity; reject all other accounts.
2. Create a GitHub OAuth App at https://github.com/settings/developers with the chosen production MCP hostname and `/callback` URL. This requires action by the GitHub account owner.
3. Configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as Cloudflare Worker secrets. Never store the client secret in source control.
4. Define how the GitHub identity is paired with the target Easybook workspace, using a server-side admin-only pairing step. Do not publish the workspace sync key.
5. Provision OAuth storage and confirm protected-resource metadata, issuer, authorization endpoint, token endpoint, scopes and audience checks.
6. Perform focused negative checks (unlisted GitHub account, wrong workspace, wrong audience, expired token, replay, invalid redirect URI, no consent) before production activation.

## Current legacy endpoint

The existing `/mcp` handler in `worker/mcp.mjs` is **not an OAuth provider**. It is disabled unless `MCP_ACCESS_TOKEN` and `MCP_WORKSPACE_KEY` are configured. Do not configure these legacy secrets as a workaround for OAuth.

## References

- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- https://github.com/cloudflare/workers-oauth-provider
