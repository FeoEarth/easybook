# AI BYOK deployment

Easybook's built-in Agent uses the account holder's BYOK credential with either
OpenAI or a custom OpenAI-compatible provider, and reuses the existing MCP tool
registry. The application has no shared provider key.

Before deploying the feature:

1. Generate one random value with at least 256 bits of entropy. The Worker accepts
   32-byte raw text, 64-character hexadecimal, 32-byte Base64 encoding, or a
   32–1024 character high-entropy string (derived to 256 bits with SHA-256). Configure that same
   value as the encrypted Cloudflare secret `AI_CREDENTIAL_KEY` on both
   `easybook-sync` and `easybook-mcp-oauth`. Do not commit or log the value.
2. Optionally apply `worker/migrations/0018-ai-credentials.sql` to
   `easybook-data` through the authorized migration process. When CI does not
   have D1 import permission, the same additive schema is initialized
   idempotently through the authenticated Worker's D1 binding on first use.
3. Upload both Workers. The release script rejects a candidate that does not
   retain the `AI_CREDENTIAL_KEY` secret binding.

The D1 table stores only AES-256-GCM ciphertext and IV metadata. GET responses
never contain a key. Changing or deleting a key requires an account session
authenticated within the previous five minutes. Android sends the key directly
from the native bridge to the account Worker and never persists it in WebView
storage.

Custom providers are configured with a display name, model, and API base URL.
Easybook appends `/chat/completions` to that base URL. The Worker accepts only
public HTTPS hostnames on the default TLS port, rejects credentials, query
strings, fragments, IP literals and local/internal suffixes, and does not follow
redirects. Cloudflare's `global_fetch_strictly_public` compatibility flag adds
runtime protection against DNS resolution to private addresses.

Agent access is recalculated against the selected workspace and current account
role on every request. Reader accounts receive read-only MCP tools. Destructive
or confirmation-gated tools are not exposed to the built-in Agent.

