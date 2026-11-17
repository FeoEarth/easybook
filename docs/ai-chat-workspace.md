# AI chat workspace

The shared Android/Web page keeps the original top Conversation/Agent segmented
control and compact rounded composer (attachment, growing text input, voice and
send/stop buttons on one row). Multiline drafts expand upward; attachments stay
in a separate tray above the input. The chat page has no Easybook AI wordmark. Desktop history stays in a
sidebar; mobile history uses the existing drawer. Model selection, local models,
BYOK, workspace roles and tool approval remain connected to the existing APIs.

## Source reuse

The cloud transport now runs the actual DeepSeek chat-demo SSE decoder and
abort-aware reader, pinned to revision
`5d5dd754ebc1948e977ddb880a9eb5aa25f37b4c`. See
`shared/vendor/chat-demo/NOTICE.md` and its MIT license. The browser credentials
and DeepSeek-specific API extensions from that demo are not imported: Easybook
keeps encrypted account BYOK and its own native/server transport.

## State and context

- `shared/ai-chat.mjs` owns context preparation, interrupted-session recovery,
  render scheduling and request ownership. The UI handles transport and rendering.
- Runs belong to a session and workspace, use AbortController, and check ownership
  before accepting stream events or starting another local tool round. Completed,
  failed and stopped responses are distinct states. Preparing/executing operations
  disable conflicting controls; repeated approval clicks cannot start two writes.
- Text drafts persist per workspace/session. Prepared attachment drafts stay in
  memory per session; switching sessions preserves them during this app session.
- Each text/PDF attachment is retained in that user's `apiContent` for follow-up
  turns. Images retain the existing current-request-only behavior; the original
  image must be attached again for later visual questions.
- Context uses a conservative 48,000-character budget and at most 38 messages,
  leaving room under the server's message limits for continuation instructions.
  This is a client budget, not an asserted model token capacity. Short histories
  are passed intact. Long histories retain recent complete turns and a bounded
  extract of the initial request, earlier user requirements and confirmed tool
  receipts. Extracts are deterministic; no generated memory is presented as fact.
  Full local history is preserved. The context panel reports actual usage and
  compression. Empty failed responses are excluded from provider context.
- Tool receipts retain actual results separately from displayed summaries. An
  approval consumes only the pending operation, updates its tool trace and starts
  another model turn. Any further write still goes through a separate approval.
  Retrying/continuing an Agent never silently replays the approved operation.
- Streaming updates keep finished message nodes and user scroll position. The
  Markdown render scheduler batches updates according to render cost; tool details
  remain expandable and tables keep their horizontal scroll positions.

## Validation

`npm test` includes `ai-context-test.mjs`, `ai-approval-resume-test.mjs` and
`ai-hub-ui-test.mjs`. They cover context bounds, original requirements/receipts,
upstream SSE fragmentation/cancellation, draft isolation, error/stop recovery,
streamed DOM identity and approval continuation across cloud/local execution.

`node scripts/ai-hub-visual-smoke.mjs` uses an isolated local server and synthetic
messages, with external requests blocked. It checks desktop/mobile layout, dark
mode, the history drawer and a short viewport. Screenshots go to
`/tmp/easybook-ai-preview/`; no user workspace or provider credentials are used.

## Automatic chat titles

New sessions begin with a truncated prompt as a fallback. After the first reply
(or write proposal), the selected model summarizes a bounded excerpt into a
short title. Cloud requests run in the background through the existing chat
endpoint with `purpose: title`, an explicit profile/model, no tools and a
128-token output budget. The native account proxy forwards the same fields.
Local models run a separate text-only title prompt after the reply, before
releasing the local generation lock. They do not get a tool protocol.

Titles are attempted once per new session; a failure preserves the fallback.
Existing saved sessions retain their titles. A user rename sets a manual flag
and revision so a late response cannot overwrite it. Deleted sessions and
responses from another workspace are ignored. Title generation does not add
messages to history, change conversation ordering or execute workspace tools.

## Multiple models per API profile

`account_ai_profiles.models_json` stores a profile's model catalog, separate from
its default `model`. `models_updated_at` bounds discovery caching to ten minutes.
The additive schema in migration 0038 is also initialized idempotently through
the authenticated Worker on older installations. Each account can use up to 500
model IDs per profile, including provider-prefixed IDs such as `vendor/model`.

Saving a profile starts discovery. Opening either picker discovers models across
all saved profiles with at most three simultaneous requests; stored/manual models
remain available when a provider does not expose a models endpoint. Refresh bypasses
the server cache. If a profile is saved with an empty default model, an explicitly
entered catalog supplies the first model, otherwise the provider's model list is
queried. Unsupported model listing returns an actionable manual-entry error.

Conversation requests carry their selected `credentialId` and `model`. The Worker
looks up that credential under the authenticated account and uses an ephemeral
model override; picking a model does not rewrite profile defaults or globally
activate another credential. Web, the native account proxy and editor AI use the
same selection fields. Existing chat history and tool authorization are retained.

The hub picker is an anchored, searchable menu grouped by API. The original compact
composer expands only while the input method is visible, revealing a model
selector in the second row. Expansion uses a short Web Animation, with reduced
motion respected. Android supplies authoritative WindowInsets IME visibility through the existing
setKeyboardVisible bridge; the Web uses the existing visual-viewport keyboard
detection. Focus, blur, draft length and attachments do not decide expansion.
Hiding the IME returns to the compact shell even when the textarea keeps focus
and retains a multiline draft. Keyboard viewport changes
reposition the model menu. Screenshot coverage includes both composer states and
the model menu; the supplied recording was used to identify these states.
