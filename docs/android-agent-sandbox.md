# Easybook Android Agent execution sandbox (V1)

Implementation branch: `feat/android-agent-sandbox-20261122`. Requires native Android versionCode **112** or newer. The Web page alone cannot provide this capability.

## Scope and activation

The execution environment is **off by default** and Android-only. The user must enable **Settings → AI → Agent 执行环境 → 启用本地代码沙箱**, then turn on **使用 Android 本地代码沙箱** in each Agent conversation's Context panel. Conversation mode never exposes sandbox tools.

AI models:
- Account BYOK: the account proxy forwards `localSandbox` only when the Android UI opts in. The Worker offers sandbox function definitions, but **never** executes local scripts on the server. It returns a `localSandbox` approval proposal to the Android client.
- On-device inference: the bounded local tool protocol offers the same tools only when the user opts in.
- Every invocation requires a single-use, five-minute, visible confirmation card. After execution, the receipt is appended to the conversation and the model may continue. A new user turn resets the six-invocation budget.

Tools:
- `sandbox_execute({language:'javascript',code})`: JavaScript body evaluated by a disposable Android WebView Worker with a 30-second wall-time limit and a 10,000-character script limit
- `sandbox_list_files({})`
- `sandbox_read_file({path})`

The script exposes `sandbox.readFile(path)`, `sandbox.writeFile(path,text)`, `sandbox.deleteFile(path)`, `sandbox.listFiles()`, `await sandbox.fetchText(publicHttpsUrl)`, and `print(...)`.

The user-provided code is **not** evaluated in the main WebView or in the native Android bridge. The dedicated Worker response has a worker-only CSP permitting JavaScript interpretation while explicitly denying direct network access; the main UI retains its existing CSP. The Worker never receives notes, account keys, native bridge objects, or whole-file-system handles. It can access only the current session's explicit virtual files. Runtime is included as small JavaScript assets in the APK, not as a heavyweight rootfs or bundled Linux binary.

## Storage and network

Files persist to a dedicated IndexedDB object store scoped to the hash of workspace ID + conversation ID; scope values never include the raw sync key. Per-session limits: **48 text files, 128 KiB per file, 512 KiB total**. Paths must be relative and may not include hidden/dot segments or `..`. Changes are validated in the main UI and committed only after a successful execution and a fresh permission check. Cancellation, timeout, tool failure, session change, or revoked permission prevents a new file commit.

Network preference: always allow **public HTTPS GET** while the sandbox is enabled. A dedicated native broker validates scheme, hostname, DNS address ranges, payload size, response content-type, and timeout, rejects explicit local/private targets and redirects, and sends no Easybook credentials or cookies. The worker can only request this broker through a constrained main-UI message flow. External servers can still receive data **deliberately passed to the sandbox**; avoid importing confidential files when outbound networking is enabled.

## Explicit limitations

This is an opt-in **JavaScript execution sandbox**, **not** a full Linux virtual machine. It does not claim VM-level process isolation, Python, `pip`, Shell, `apt`, SSH, arbitrary binary execution, background execution, or attachment export. It does not import notes automatically. An OS-isolated runtime, QEMU guest Linux, and/or an independently packaged Python WASM runtime require separate Android compatibility and threat-model validation before promotion.

The existing Android JS bridge remains origin- and main-frame-gated, and the broker checks its persisted enable flag before every network request. The account proxy deliberately does not execute tools itself. If the native bridge is unavailable, the settings control is hidden and no sandbox tools are offered.

## Validation

Use `node scripts/agent-sandbox-test.mjs`, then `npm test` and the standard Android build workflow. **A real Android 16 WebView test is still required** to verify CSP response handling, worker loading, IndexedDB permissions, network broker behavior, timeout, and user confirmation end-to-end. Do not claim production VM isolation or full Linux compatibility based on unit tests.
