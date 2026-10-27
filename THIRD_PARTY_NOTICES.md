# Editor dependencies

The machine-generated inventory of pinned production components, original authors,
SPDX identifiers and full upstream license texts is in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md). Refresh it with
`npm run licenses:generate`; `npm run licenses:check` fails on missing/stale
license material. The separately licensed PDF.js font, CMap and decoder assets
are listed there as well.

The offline editor bundle is built from the exact versions in `package-lock.json`.

- Tiptap open-source editor and extensions: MIT, https://github.com/ueberdosis/tiptap
- markdown-it and its bundled dependencies: MIT, https://github.com/markdown-it/markdown-it
- ProseMirror packages: MIT, https://github.com/ProseMirror
- DOMPurify: Apache-2.0 OR MPL-2.0, https://github.com/cure53/DOMPurify

The minifier's extracted comments remain in `app/src/main/assets/editor.js.LEGAL.txt`;
that short file alone is **not** the full third-party license inventory. Build
dependencies and their licenses also remain recorded in the lockfile and
upstream packages. No licensed Apple fonts or proprietary Liquid Glass renderer
are included.


Native glass production lens: QWEA0/Liquid-Glass-Android (MIT), pinned at 16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d. See third_party/qwea0-liquid-glass/NOTICE.md and LICENSE. Historical initial adapter attribution: third_party/liquidglass (Apache-2.0); its shader is no longer shipped.
