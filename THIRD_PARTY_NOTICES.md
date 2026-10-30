# Third-party components and attribution / 第三方组件与归属说明

Easybook itself is licensed under `AGPL-3.0-only`. The identifiers below apply
to their respective third-party components and do not change Easybook's license.

The machine-generated inventory of pinned production components, original authors,
SPDX identifiers and full upstream license texts is in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Refresh it with
`npm run licenses:generate`; `npm run licenses:check` fails on missing/stale
license material. The separately licensed PDF.js font, CMap and decoder assets
are listed there as well. Resolve the exact Android runtime graph (including
transitive libraries) with `npm run licenses:android`. Proprietary Google Play
Services components are listed with official Android SDK terms links and are
not mislabeled as open-source.

In released Android/Web builds, the full inventory is available from
**Settings → 法律与许可 → 第三方组件与许可证**. Android packages an offline copy;
the Web Worker serves the same generated text through its static asset binding
at `/pdf/THIRD_PARTY_LICENSES.md`. Run `npm run licenses:delivery:check`
to verify that the distributed copy matches the repository inventory.

The offline editor bundle is built from the exact versions in `package-lock.json`.
The OAuth Worker uses the independently locked production graph in
`mcp-oauth/package-lock.json`. Android entries come from the resolved Gradle
`releaseRuntimeClasspath`, not only the direct dependencies in `app/build.gradle`.

- Tiptap open-source editor and extensions: MIT, https://github.com/ueberdosis/tiptap
- markdown-it and its bundled dependencies: MIT, https://github.com/markdown-it/markdown-it
- ProseMirror packages: MIT, https://github.com/ProseMirror
- DOMPurify: Apache-2.0 OR MPL-2.0, https://github.com/cure53/DOMPurify

The minifier's extracted comments remain in `app/src/main/assets/editor.js.LEGAL.txt`;
that short file alone is **not** the full third-party license inventory. Build
dependencies and their licenses also remain recorded in the lockfile and
upstream packages. No licensed Apple fonts or proprietary Liquid Glass renderer
are included.


Native glass production lens: QWEA0/Liquid-Glass-Android (MIT), pinned at
`16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d`. See
`third_party/qwea0-liquid-glass/NOTICE.md` and `LICENSE`. The same MIT text is
packaged in the APK as `native-glass/LICENSE.txt`. Historical initial adapter
attribution remains in `third_party/liquidglass/` (Apache-2.0); that earlier
shader is no longer shipped.
