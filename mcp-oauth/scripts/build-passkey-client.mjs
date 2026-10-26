import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js',import.meta.url),'utf8');
writeFileSync(new URL('../src/passkey-browser.mjs',import.meta.url),'// Generated from pinned @simplewebauthn/browser; see third_party/SimpleWebAuthn-LICENSE.md.\nexport default '+JSON.stringify(source)+';\n');
