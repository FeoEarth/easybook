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
