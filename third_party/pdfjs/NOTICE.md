# Mozilla PDF.js attribution and packaged scope

Pinned npm distribution: pdfjs-dist 6.4.299 (build d0991a0d5), official stable release https://github.com/mozilla/pdf.js/releases/tag/v6.4.299 . Apache License 2.0; source https://github.com/mozilla/pdf.js . Integrity is pinned in package-lock.json.

`scripts/prepare-pdf.mjs` copies the unmodified legacy API, matching Worker and
viewer component, CSS, images, CMaps, standard fonts and decoder WASM from npm
into APK/Web-local assets. Embedded vendor licenses from `cmaps/`,
`standard_fonts/` and `wasm/` are preserved and enumerated separately in
`THIRD_PARTY_LICENSES.md`; the top-level Apache-2.0 declaration alone does not
describe those bundled resources.

QuickJS evaluator/sandbox resources are deliberately excluded. No runtime CDN
or online document viewer is used. The public PDF.js API/component source
remains unmodified.
