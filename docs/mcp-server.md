# Easybook MCP Server (initial read-only phase)

Endpoint: `POST https://<your-worker-domain>/mcp` (Streamable HTTP JSON-RPC subset, stateless).
This is an initial MCP integration, not a full OAuth-enabled public MCP provider.

## Before deployment

Set **two distinct secrets** on the existing Worker (never commit them):

```sh
cd worker
npx wrangler secret put MCP_ACCESS_TOKEN
npx wrangler secret put MCP_WORKSPACE_KEY
```

- `MCP_ACCESS_TOKEN`: a separate, high-entropy bearer token for your MCP client; **do not reuse** your Easybook sync key as the bearer.
- `MCP_WORKSPACE_KEY`: the **64-character lowercase hex** workspace sync key corresponding to the workspace you intend the MCP server to read. It is only read server-side and SHA-256-hashed to select D1 workspace rows. Never expose it to clients or logs.
- Without both secrets, `/mcp` returns 503 and remains disabled.
- Rotate `MCP_ACCESS_TOKEN` to revoke clients. This initial phase has **one workspace and one shared MCP access token**, not per-user authorization.
- Only connect trusted clients. Use HTTPS. This endpoint intentionally rejects browser Origin headers.
- Configure the MCP client with `Authorization: Bearer <MCP_ACCESS_TOKEN>` and URL `https://<domain>/mcp`.

## Available tools

- `list_folders`: list up to 500 active folders.
- `search_notes`: search title or JSON document text (up to 30 hits).
- `get_note`: read a note by UUID (including its document JSON).

The server excludes deleted/purged notes, scopes every D1 query to the configured workspace, and exposes **no write, delete, or attachment download tools**. It does not touch the Android/Web UI or QWEA0 Liquid Glass.

Supported RPC methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. JSON responses only; no server-sent events, OAuth, session management, or pagination in this phase. Some MCP clients require additional protocol features; compatibility with those clients is not yet verified.

## Minimal smoke check

With the secrets configured and deployed:

```sh
curl -i -X POST 'https://<domain>/mcp' \
  -H 'Authorization: Bearer <MCP_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: three read-only tools. Without a bearer token: HTTP 401.

## Security and next phase

This is a personal single-workspace integration only. **Do not publish this as a multi-user service** until implementing proper OAuth, per-user workspace authorization, token revocation and client consent. Do not automatically deploy to production before setting secrets and confirming the intended workspace. A subsequent phase can add create/update tools with explicit write scopes and confirmations.
