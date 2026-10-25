# Mozilla PDF.js

Pinned npm distribution: pdfjs-dist 6.4.299 (build d0991a0d5), official stable release https://github.com/mozilla/pdf.js/releases/tag/v6.4.299 . Apache License 2.0; source https://github.com/mozilla/pdf.js . Integrity is pinned in package-lock.json.

scripts/prepare-pdf.mjs copies the unmodified legacy API, matching Worker and viewer component, CSS, images, CMaps, standard fonts and decoder WASM from npm into APK-local assets. Embedded vendor licenses are preserved. QuickJS evaluator/sandbox resources are deliberately excluded. No runtime CDN or online document viewer is used. The public PDF.js API/component source remains unmodified.
