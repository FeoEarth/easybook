import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import html from '../worker/ui.mjs';
import editor from '../worker/editor.mjs';
import nativeUpdate from '../worker/native-update.mjs';
assert.equal(html,await readFile('app/src/main/assets/index.html','utf8'),'Generated Web HTML is stale; run generate-ui');
assert.equal(editor,await readFile('app/src/main/assets/editor.js','utf8'),'Generated editor is stale');
assert.equal(nativeUpdate,await readFile('app/src/main/res/raw/native_update.js','utf8'),'Generated updater UI is stale');
let count=0;
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
 if(/\bsrc\s*=/.test(match[1]))continue;
 new Script(match[2],{filename:`web-inline-${++count}.js`});
}
assert.ok(count>0,'No application script found');
new Script(editor,{filename:'editor.js'});
new Script(nativeUpdate,{filename:'native_update.js'});
console.log(`Web generated assets and ${count} inline script syntax verified`);

assert.match(html,/connect-src[^;]*https:\/\/easybook-mcp-oauth\.1902521952\.workers\.dev(?:[ ;])/,'Pairing OAuth endpoint must be explicitly allowed by page CSP');
