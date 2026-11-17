# DeepSeek chat-demo

Source: https://github.com/deepseek-ai/chat-demo
Pinned revision: 5d5dd754ebc1948e977ddb880a9eb5aa25f37b4c
License: MIT, Copyright (c) 2026 DeepSeek (full text in LICENSE).

`sse.mjs` is the actual upstream `src/services/api/sse.ts` source transpiled
from TypeScript to ES2022 JavaScript using esbuild. Its event decoder and
abort-aware stream reader are used by Easybook's cloud AI chat transport.
Easybook retains its own server-side BYOK credentials, native bridge, tool
protocol and authorization boundary. The license is retained in the bundled
editor's linked legal notices, shipped with both Web and Android.

The AI workspace layout is independently implemented for Easybook, informed by
chat-demo's reading width, multiline composer, message actions and draft model.
