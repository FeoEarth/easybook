# Easybook Android Agent execution sandbox (V2 / phase 2 + 3)

Implementation branch: `feat/android-agent-sandbox-20261122`. Phase 2/3 requires native Android versionCode **113** or newer. The Web page alone cannot provide this capability.

## Scope and activation

The execution environment is **off by default** and Android-only. The user must enable **Settings → AI → Agent 执行环境 → 启用本地代码沙箱**, then turn on **使用 Android 本地代码沙箱** in each Agent conversation's Context panel. Conversation mode never exposes sandbox tools.

AI models:
- Account BYOK: the account proxy forwards `localSandbox` only when the Android UI opts in. The Worker offers sandbox function definitions, but **never** executes local scripts on the server. It returns a `localSandbox` approval proposal to the Android client.
- On-device inference: the bounded local tool protocol offers the same tools only when the user opts in.
- Every invocation requires a single-use, five-minute, visible confirmation card. After execution, the receipt is appended to the conversation and the model may continue. A new user turn resets the six-invocation budget.

Tools (the QEMU backend adds guest Python/Shell when explicitly enabled):
- `sandbox_execute({language:'javascript',code})`: JavaScript body evaluated by a disposable Android WebView Worker with a 30-second wall-time limit and a 10,000-character script limit
- `sandbox_list_files({})`
- `sandbox_read_file({path})`

The script exposes `sandbox.readFile(path)`, `sandbox.writeFile(path,text)`, `sandbox.deleteFile(path)`, `sandbox.listFiles()`, `await sandbox.fetchText(publicHttpsUrl)`, and `print(...)`.

The user-provided code is **not** evaluated in the main WebView or in the native Android bridge. Each invocation runs on a new synthetic HTTPS subdomain under `*.agent-sandbox.easybook.invalid` (served exclusively via Android `shouldInterceptRequest`), preventing access to the primary app's origin-bound data and preventing reuse of a previous execution's browser storage. The frame has no access to the native bridge. The dedicated Worker response has a worker-only CSP permitting JavaScript interpretation while explicitly denying direct network access; the main UI retains its existing CSP. The Worker never receives notes, account keys, native bridge objects, or whole-file-system handles. It can access only the current session's explicit virtual files. Runtime is included as small JavaScript assets in the APK, not as a heavyweight rootfs or bundled Linux binary.

## Storage and network

Files persist to a dedicated IndexedDB object store scoped to the hash of workspace ID + conversation ID; scope values never include the raw sync key. Per-session limits: **48 text files, 128 KiB per file, 512 KiB total**. Paths must be relative and may not include hidden/dot segments or `..`. Changes are validated in the main UI and committed only after a successful execution and a fresh permission check. Cancellation, timeout, tool failure, session change, or revoked permission prevents a new file commit.

Network preference: always allow **public HTTPS GET** while the sandbox is enabled. A dedicated native broker validates scheme, hostname, DNS address ranges, payload size, response content-type, and timeout, rejects explicit local/private targets and redirects, and sends no Easybook credentials or cookies. The worker can only request this broker through a constrained main-UI message flow. External servers can still receive data **deliberately passed to the sandbox**; avoid importing confidential files when outbound networking is enabled.

## Explicit limitations

The default opt-in backend is a **JavaScript execution sandbox**, **not** a full Linux virtual machine. An optional experimental QEMU system VM *guest* backend is implemented via Termux, but only after manual guest setup; refer to `docs/android-agent-vm.md`. The JS sandbox does not claim VM-level process isolation, Python, `pip`, Shell, `apt`, SSH, or arbitrary binary execution. The optional QEMU guest offers Python, Bash and guest package management after manual guest configuration. It does not automatically mount Easybook data, provide background execution, or provide a user-friendly VM image installer. It does not import notes automatically. An OS-isolated runtime, QEMU guest Linux, and/or an independently packaged Python WASM runtime require separate Android compatibility and threat-model validation before promotion.

The existing Android JS bridge remains origin- and main-frame-gated, and the broker checks its persisted enable flag before every network request. The account proxy deliberately does not execute tools itself. If the native bridge is unavailable, the settings control is hidden and no sandbox tools are offered.

## Validation

Use `node scripts/agent-sandbox-test.mjs`, then `npm test` and the standard Android build workflow. **A real Android 16 WebView test is still required** to verify CSP response handling, worker loading, IndexedDB permissions, network broker behavior, timeout, and user confirmation end-to-end. Do not claim production VM isolation or full Linux compatibility based on unit tests.

## Phase 2 file manager and execution control

The Agent Context panel offers explicit **Import text**, **List files**, **Export selected**, **Delete**, and **Clear current sandbox** actions. Text is decoded as strict UTF-8, bounded by the existing 48-file / 128 KiB per file / 512 KiB per session quotas, and persisted locally in IndexedDB. Exports go through Android's native Storage Access Framework picker; input never automatically imports notes or syncs to D1/R2. Deleting a sandbox file does not delete the source file.

Each approved operation remains visible in the original Agent tool timeline and receipts. A cancel button interrupts the local JS worker; cancelling a request already sent to QEMU stops waiting in Easybook but does **not** guarantee guest process termination. The Termux launcher has its own hard timeout. Tool/model inputs continue to require per-call confirmation; enabled sandbox does not waive existing note-write approvals.

## Phase 3 experimental QEMU guest

Android can optionally invoke a narrowly fixed Termux launcher via the official RUN_COMMAND intent after a separate VM setting is enabled. Termux **never evaluates model-generated code in the host**; a bundled, user-reviewed launcher forwards stdin through pinned SSH into a pre-provisioned QEMU guest. Agent commands cannot reach Easybook files unless the user deliberately copies content into the guest. Android derives a per-workspace/per-session SHA-256 work directory inside the guest. This separates normal job files but is not a hostile-code security boundary between sessions sharing a Linux account. QEMU guest storage remains separate from JS virtual files.

The native bridge receives stdout/stderr/exit status through a non-exported PendingIntent receiver. Linux commands execute on a dedicated native queue to avoid blocking the notes storage executor. VM operations require additional Termux permission, guest image setup and SSH verification (see `docs/android-agent-vm.md`). Without these prerequisites, VM tool execution fails closed.

Do not represent the QEMU integration as automatically downloadable, deployed in the Web client, or tested with a real Android ARM64 guest before physical device verification.
