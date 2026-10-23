import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('worker/ui.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/index.html','utf8'))+';\n');

writeFileSync('worker/editor.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/editor.js','utf8'))+';\n');
