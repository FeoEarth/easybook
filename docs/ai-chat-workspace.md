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

The redundant title/model subheader has been removed. The conversation title
remains as a visually hidden heading for accessibility; history still displays
the generated title. The model picker lives in the composer, visible in the IME
expanded layout and also in the desktop compact layout for hardware keyboards.

## Shared response and title policy

`shared/ai-prompts.mjs` supplies the cloud/local assistant policy and title rules.
Replies lead with the requested result, expand only as needed, distinguish note
metadata from actual content, and keep empty-workspace responses brief. Read and
write scopes, per-operation approval and untrusted-data boundaries remain intact.
The Agent finishes prerequisite reads before proposing one write per turn, then
continues from confirmed receipts without replaying successful work.

AI titles aim for roughly 6–12 Chinese characters or 3–6 English words, as
writing guidance rather than enforced counts. Normalization cleans wrappers and
prefixes, and rejects clearly abnormal output over 80 characters instead of
cutting a generated title mid-phrase. Existing titles and manual names stay
unchanged. A short prompt-based fallback remains available if generation fails.
The local prompt budget is adjusted for the shared policy to stay below the
native bridge's 16,000-character limit. Prompt changes are covered structurally
and through provider mocks; live-model wording quality is not asserted by tests.

### Account personalization

AI settings now separates model connection cards, personalization and optional on-device models. Adding a connection asks for provider, optional label and API key; default model/catalog overrides are under optional model settings. Editing a connection does not activate it; “set default” is explicit. Model selection inside a conversation remains independent.

`GET/PUT /api/ai/preferences` stores account-private user instructions, automatic/use-memory switches and up to 50 editable memory entries. PUT requires the last observed version; atomic compare-and-swap returns 409 on a concurrent update. A migration and idempotent runtime schema setup cover both Workers. The native account proxy and Java bridge expose the same authenticated operation; the updated APK is required for this new bridge operation.

Cloud chat/writer prompts read the account preferences on the server; local inference uses synchronized preferences within its prompt budget. Current user requests and application tool/approval boundaries take priority over customization. Device-local legacy free text can be imported explicitly, rather than silently uploading it to an account.

After a successful new user turn, optional extraction uses only the original user input (not note contents, attachment text, assistant replies or tool results), no tools and a small JSON output budget. Local extraction runs serially on the local engine; cloud extraction runs in the background. Entries can be edited, deleted, cleared, disabled or excluded from future replies. Extraction captures the settings version; deletion, toggling or another-device modification invalidates an in-flight save. Failed extraction does not fail the conversation. Automatic extraction uses the selected model and may consume additional BYOK tokens; semantic extraction quality depends on the model.

Validation includes account isolation, stale-write rejection, preference injection, extraction without tools, disabling automatic extraction, UI CRUD and deletion during extraction, plus mobile/desktop browser layout screenshots. Provider responses in these tests are mocked.

### Concurrent conversations and native membership

Cloud hub runs now belong to individual session IDs, with up to four simultaneous generations. Switching, creating and renaming sessions remain available; stopping a session cancels only its own run. Approval execution locks only its session, and its continuation returns to that same session even if the user has switched views. Drafts and message output remain isolated. Local inference stays serial because the device engine is shared with the note writer. Android native cloud transport uses four workers and an ID-keyed connection map, including per-request cancellation and cancellation of all requests on server switch/shutdown.

Android membership opening now uses the actual NativeStore bridge and explicitly authorized fixed operations. The account page reads membership, wallet balance and bonus balance through a fixed authenticated GET endpoint on the selected sync server; no tokens enter JavaScript and no arbitrary URL is accepted. Membership WebView supports first-party session cookies and DOM storage while retaining same-origin navigation, no JS bridge, and no file/content access. Returning to the app refreshes account information. Native version 104 / 0.8.36 is required; OTA is gated accordingly.

Checks: full npm tests, concurrent-session/stop isolation, approval continuation, account summary/login invalidation, native bootstrap, generated assets and desktop/mobile browser layouts. Android compilation requires CI/SDK. The existing membership-ledger test currently fails at partial receipt accounting (`0.00` vs `0.40`); this also reproduces on the unmodified HEAD, independently of the native UI/transport changes. The membership UI test likewise times out on the unmodified HEAD at checkout setup.
