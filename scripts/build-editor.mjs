import {build} from 'esbuild';
await build({entryPoints:['editor/app-bootstrap.js'],bundle:true,minify:true,format:'iife',target:['chrome100'],outfile:'app/src/main/assets/editor.js',legalComments:'linked'});


// Retain the incremental SHA-256 dependency's license in both Android and Web bundles.
import {readFileSync,appendFileSync} from 'node:fs';
appendFileSync('app/src/main/assets/editor.js','\n/* '+readFileSync('node_modules/@noble/hashes/LICENSE','utf8').replaceAll('*/','* /')+' */\n');
