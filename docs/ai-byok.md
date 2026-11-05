# AI BYOK deployment

Easybook's built-in Agent uses account-scoped BYOK profiles and reuses the
existing MCP tool registry. An account can save and switch multiple encrypted
credentials. Presets are available for OpenAI, Anthropic, Google AI Studio
(Gemini), DeepSeek, and Kimi/Moonshot, with custom OpenAI-compatible and custom
Anthropic Messages endpoints. The application has no shared provider key.

Before deploying the feature:

1. Generate one random value with at least 256 bits of entropy. The Worker accepts
   32-byte raw text, 64-character hexadecimal, 32-byte Base64 encoding, or a
   32–1024 character high-entropy string (derived to 256 bits with SHA-256). Configure that same
   value as the encrypted Cloudflare secret `AI_CREDENTIAL_KEY` on both
   `easybook-sync` and `easybook-mcp-oauth`. Do not commit or log the value.
2. Apply `worker/migrations/0018-ai-credentials.sql` and the additive
   `worker/migrations/0021-ai-profiles.sql` to
   `easybook-data` through the authorized migration process. When CI does not
   have D1 import permission, the same additive schema is initialized
   idempotently through the authenticated Worker's D1 binding on first use.
3. Upload both Workers. The release script rejects a candidate that does not
   retain the `AI_CREDENTIAL_KEY` secret binding.

The D1 tables store only AES-256-GCM ciphertext and IV metadata. Existing
single-key records are imported lazily into a profile without exposing or
replacing the secret. GET responses never contain a key. Changing or deleting a key requires an account session
authenticated within the previous five minutes. Android sends the key directly
from the native bridge to the account Worker and never persists it in WebView
storage.

Model discovery reads the active provider's bounded `/models` response and
returns model identifiers only. OpenAI-compatible providers use
`/chat/completions`; Anthropic providers use `/messages`, native Anthropic
headers, content blocks, tool definitions and tool-result blocks. Custom
providers are configured with a display name, protocol, model, and API base URL.
The Worker accepts only
public HTTPS hostnames on the default TLS port, rejects credentials, query
strings, fragments, IP literals and local/internal suffixes, and does not follow
redirects. Cloudflare's `global_fetch_strictly_public` compatibility flag adds
runtime protection against DNS resolution to private addresses.

Agent access is recalculated against the selected workspace and current account
role on every request. Reader accounts receive read-only MCP tools. Destructive
or confirmation-gated tools are not exposed to the built-in Agent.

