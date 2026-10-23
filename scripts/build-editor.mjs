import {build} from 'esbuild';
await build({entryPoints:['editor/rich-editor.js'],bundle:true,minify:true,format:'iife',target:['chrome100'],outfile:'app/src/main/assets/editor.js',legalComments:'linked'});
