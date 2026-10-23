import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync('app/src/main/assets/index.html','utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(js);
await import('../worker/index.mjs');
console.log('Client and Worker syntax OK');
