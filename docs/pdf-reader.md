# Unified PDF.js reader

Base: df888d19 / build74; Android versionCode43. PDF-only change, no editor model, attachment identity, metadata, cloud data, API/auth or synchronization protocol changes.

## Integration

The former Android placeholder and native PdfActivity entry are removed. PDF MIME (or .pdf with application/octet-stream) uses the existing filePayload reference/hash/size-checked attachment loader. A PDF header is additionally required in the first 1024 bytes. The same /pdf/reader.mjs uses the Mozilla PDF.js 6.4.299 legacy API + viewer component + matching module Worker on Android and Web. No external PDF plugin/service/CDN. Image and ordinary-attachment branches remain unchanged.

The shared media dialog retains its filename, size, close, save and share controls. The PDF area supplies page navigation, previous reading location, fit-width/zoom, collapsible controls, find/previous/next/highlights, PDF.js text layer selection/copy, password prompts and errors. Continuous pages, visibility-based render queue and canvas buffering are the PDFViewer component's implementation. Pinch uses PDF.js TouchManager with PDFViewer.updateScale, mouse/keyboard/tap adapters use the same viewer. Built-in PDF links/annotations, auto-linking, XFA and PDF scripting are disabled; no scripting manager or QuickJS sandbox is provided. isEvalSupported=false. This is a read-only viewer, not a form/annotation editor.

Pages adapt to width until the user zooms. Local reading state stores numeric page/position/scale under content-hash keys, capped at 32 entries; no PDF text, file name, bytes or sync keys are stored in reading state. No cross-device state synchronization.

## Packaging / Web compatibility

Run npm ci and npm run build:pdf. Gradle preBuild also invokes prepare-pdf.mjs after the existing pipeline's npm ci. Vendor assets are generated from the lockfile, bundled in the APK, and ignored as generated files in git. The matching license and decoder licenses are shipped. No assets are downloaded at runtime.

Android's existing fixed-origin WebView interceptor serves only the local /pdf asset directory, including binary CMaps/fonts/WASM with appropriate MIME. CSP permits same-origin modules/Worker/fonts/assets and WASM compilation; Android connect-src remains same-origin only, and remote sync remains native. Bridge operations, permission allowlist and AttachmentStore are unchanged. MainActivity no longer references PdfActivity; its manifest entry and unused source are removed. Other ACTION_VIEW/share/export behavior is retained.

Necessary Web-only compatibility: Worker adds a static /pdf/* and /pdf-sw.js route to PDF_ASSETS, and wrangler declares that static asset directory. No API handler/database/storage/sync behavior changes. /pdf-sw.js caches only public app/reader resources (never attachment/API data) so a previously cached app and local attachment can work offline. First offline use before static resources finish caching is unavailable; browser cache eviction/private mode can also prevent offline use. Normal Web release generation must regenerate worker/ui.mjs using the shared HTML; the generated Worker UI/bundle is not committed here and Cloudflare is not deployed by this task.

## Lifecycle and limits

Current 5 MB attachment limit is unchanged. PDF Base64 is transient in the existing transport only; the active PDF selection retains metadata, not Base64. PDF.js receives Uint8Array and transfers its backing data to its Worker. Web save/share reuses existing filePayload on demand; native save/share uses existing attachment IDs. No additional persistent PDF Blob URL is created by the reader. Existing attachment-cache lifetimes are unchanged.

Canvas dimensions are capped at 2 megapixels / 4096 maximum dimension per page, detail canvases are disabled, and PDF.js evicts offscreen pages from its viewer buffer. Zoom is bounded 0.25–8. Large compressed image handling is bounded through PDF.js maxImageSize/canvas area options. On close/reopen: save local state, abort DOM/event subscriptions and ResizeObservers, reset viewer/find/link documents, cancel/destroy the loading task/Worker, remove reader DOM/canvases/text layers, and serialize subsequent opens behind cleanup. The existing attachment-dialog visibility path hides the Web format toolbar and native glass layer. PDF controls are shared HTML; no existing QWEA0 component, Shader, material or animation is changed.

## Checks and unverified behavior

Only JS/static checks, local 2-page PDF.js API loading/text extraction, corrupted-file error, loading-task destroy, asset completeness/version and native-entry wiring checks, then Android Release compilation/signing/artifact checks. No emulator, UI automation, screenshots, visual comparison or regression.

Actual Android/Web rendering, PDF.js module Worker and decoder requests, password UI, copy/search highlights, TouchManager gestures, IME/system back, rotation, cache/offline behavior and memory under real documents remain user acceptance items. No OCR; scanned pages may have no selectable/searchable text. PDF security permissions, advanced formats and driver behavior may limit rendering; an error is shown instead of the old native-reader prompt. Existing Liquid Glass is retained unchanged; PDF pages are unblurred.
