# Vendored QR Code Generator for JavaScript

`qrcode-generator.mjs` retains the QR Code Generator for JavaScript attribution:
Copyright (c) 2009 Kazuhiko Arase. The upstream URL retained in its header is
<http://www.d-project.com/>. The complete MIT license text is preserved verbatim
in [`qrcode-generator.LICENSE`](qrcode-generator.LICENSE).

The retained source does not identify an upstream release version. No release
version is inferred. The inventory identifies these exact vendored bytes as
`source-ea91d7118a53`, using their SHA-256 fingerprint:

```text
ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0
```

This file is adapted as an ECMAScript module with named and default exports.
`mcp-oauth/src/qr-login.mjs` imports it to generate QR SVGs and matrices for
Easybook's QR sign-in flow. It is a separate vendored source component, not an
npm dependency or an additional copy of the npm production dependency graph.

`scripts/generate-third-party-licenses.mjs` verifies the pinned source fingerprint
and includes the original copyright and full MIT text in the shared inventory.
Review and update this notice and the generator's fingerprint together when
changing the vendored source.
