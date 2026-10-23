import {build} from 'esbuild';
await build({entryPoints:['worker/index.mjs'],bundle:true,minify:true,format:'esm',platform:'neutral',external:['node:*'],outfile:'worker/deploy.mjs'});
