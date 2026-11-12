# Third-party components and attribution / 第三方组件与归属说明

Easybook itself is licensed under `AGPL-3.0-only`. The identifiers below apply
to their respective third-party components and do not change Easybook's license.

The machine-generated inventory of pinned production components, original authors,
SPDX identifiers and full upstream license texts is in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Refresh it with
`npm run licenses:generate`; `npm run licenses:check` fails on missing/stale
license material. The separately licensed PDF.js font, CMap and decoder assets
and the vendored QR generator are listed there as well. Resolve the exact Android runtime graph (including
transitive libraries) with `npm run licenses:android`. Proprietary Google Play
Services components are listed with official Android SDK terms links and are
not mislabeled as open-source.

In released Android/Web builds, the full inventory is available from
**设置 → 关于 Easybook → 第三方组件与许可证**
(**Settings → About Easybook → Third-party Components & Licenses**).
The attribution summary is the adjacent **第三方归属说明** entry. Android packages an offline copy;
the Web Worker serves the same generated text through its static asset binding
at `/pdf/THIRD_PARTY_LICENSES.md`.

Opening either third-party document first requests its latest text from
`https://raw.githubusercontent.com/FeoEarth/easybook/main/`. If the request fails,
times out, or returns an invalid document, the app uses the bundled/static copy.
Each opening refreshes the online text. The online inventory follows repository
`main`; the bundled snapshot records the build shipped with the app. The
Easybook project license continues to use the bundled text.

Once this reader is installed, later third-party notice edits only need to be
committed to GitHub. Run `npm run licenses:delivery:check` when preparing a build
to verify that its offline snapshot matches the repository inventory.

The offline editor bundle is built from the exact versions in `package-lock.json`.
The OAuth Worker uses the independently locked production graph in
`mcp-oauth/package-lock.json`. Android entries come from the resolved Gradle
`releaseRuntimeClasspath`, not only the direct dependencies in `app/build.gradle`.
The vendored QR generator is tracked separately by its source SHA-256 because
it is not an npm lockfile dependency. See
[`mcp-oauth/src/vendor/NOTICE.md`](mcp-oauth/src/vendor/NOTICE.md).

## 主要依赖 / Main components

These are the versions currently pinned by this repository; this notice does
not upgrade dependencies. The generated inventory includes their transitive
dependencies and full license texts.

| Component | Pinned version / revision | Use | License |
| --- | --- | --- | --- |
| Tiptap core, StarterKit and table/task/code extensions | 3.32.0 | Rich-text editor | MIT |
| ProseMirror | Exact versions in `package-lock.json` | Editor document model, state and view | MIT |
| markdown-it | 14.3.3 | Markdown import/export | MIT |
| DOMPurify | 3.4.17 | HTML sanitization | Apache-2.0 OR MPL-2.0 |
| @noble/hashes | 2.4.0 | Incremental attachment hashing | MIT |
| pdfjs-dist | 6.4.299 | Local PDF rendering | Apache-2.0, plus the separately listed font/CMap/decoder licenses |
| @cloudflare/workers-oauth-provider | 1.2.4 | OAuth Worker | MIT |
| @simplewebauthn/browser / @simplewebauthn/server | 14.0.0 / 14.0.3 | Passkey client and server | MIT |
| qrcode-generator (vendored ESM adapter) | Source SHA-256 `ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0` | QR sign-in | MIT, Copyright (c) 2009 Kazuhiko Arase |
| AndroidX Credentials / Credentials Play Services Auth | 1.5.0 | Android passkeys | Apache-2.0 |
| AndroidX WebKit | 1.12.1 | Android WebView integration | Apache-2.0 |
| JourneyApps ZXing Android Embedded / ZXing core | 4.3.0 / 3.4.1 | QR scanning | Apache-2.0 |
| LiteRT-LM Android | 0.18.0 | On-device AI API and optional native runtime | Apache-2.0 per the published Maven POM; see the scope below |
| QWEA0/Liquid-Glass-Android port | `16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d` | Native Android glass shader | MIT |

Google Play Services and Google Identity runtime modules retain their
**proprietary Android SDK License** references in the full inventory. The
Apache-2.0 license of the AndroidX adapter does not apply to those Google modules.

Development and test tools are outside the production inventory. esbuild 0.28.2
is explicitly identified as a build tool; it is not embedded in the application.

The minifier's extracted comments remain in `app/src/main/assets/editor.js.LEGAL.txt`;
that short file alone is **not** the full third-party license inventory. Build
dependencies and their licenses also remain recorded in the lockfile and
upstream packages. No licensed Apple fonts or proprietary Liquid Glass renderer
are included.

## 可选本地 AI 组件 / Optional on-device AI components

The LiteRT-LM 0.18.0 Java API is included in the APK. Its JNI library
`liblitertlm_jni.so` is excluded from the base APK and distributed separately as
the official Release asset `Easybook-LiteRT-LM-arm64-v8a.so`, downloaded only on
request. Model weights are a different download with their own model terms;
they are not covered by the library's Apache-2.0 declaration.

[`third_party/android/README.md`](third_party/android/README.md) records the
native asset's upstream AAR path, SHA-256 and license source. The resolved Maven
graph records Java/AAR coordinates; it is not an exhaustive inventory of code
statically linked inside the native binary or of separately downloaded models.

## 原生玻璃效果 / Native glass attribution

Native glass production lens: QWEA0/Liquid-Glass-Android (MIT), pinned at
`16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d`. See
`third_party/qwea0-liquid-glass/NOTICE.md` and `LICENSE`. The same MIT text is
packaged in the APK as `native-glass/LICENSE.txt`. Historical initial adapter
attribution remains in `third_party/liquidglass/` (Apache-2.0); that earlier
shader is no longer shipped.

## 更新清单 / Refreshing the notices

Run `npm run licenses:generate`, then `npm run licenses:check` and
`npm run licenses:delivery:check` to generate and verify the shared notices.
The delivery step copies the same text into Android's offline assets and the
Web PDF asset directory. For an Android dependency change, first regenerate the
resolved Gradle snapshot with `npm run licenses:android`. Vendored source updates
also require reviewing the corresponding upstream attribution and license file.
