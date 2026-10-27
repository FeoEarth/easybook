import {cp,copyFile,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
const source='node_modules/pdfjs-dist',target='app/src/main/assets/pdf/vendor';
const meta=JSON.parse(await readFile(source+'/package.json','utf8'));
if(meta.version!=='6.4.299')throw Error('PDF.js version mismatch; run npm ci');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const [from,to] of [['legacy/build/pdf.min.mjs','pdf.mjs'],['legacy/build/pdf.worker.min.mjs','pdf.worker.mjs'],['legacy/web/pdf_viewer.mjs','pdf_viewer.mjs'],['legacy/web/pdf_viewer.css','pdf_viewer.css'],['LICENSE','LICENSE']])await copyFile(source+'/'+from,target+'/'+to);
for(const name of ['cmaps','standard_fonts','wasm'])await cp(source+'/'+name,target+'/'+name,{recursive:true});
await cp(source+'/legacy/web/images',target+'/images',{recursive:true});
// PDF scripting is deliberately unavailable; no sandbox/evaluator is shipped.
for(const name of ['quickjs-eval.js','quickjs-eval.wasm'])await rm(target+'/wasm/'+name,{force:true});
// Shared notice delivered by the PDF static-assets binding on Web and bundled
// with Android app assets for offline viewing. Keep a single source of truth.
await copyFile('THIRD_PARTY_LICENSES.md','app/src/main/assets/pdf/THIRD_PARTY_LICENSES.md');
async function files(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.posix.join(dir,entry.name);out.push(...entry.isDirectory()?await files(p):[p])}return out}
const assets=(await files('app/src/main/assets/pdf')).filter(p=>!p.endsWith('/manifest.json')).map(p=>'/'+p.slice('app/src/main/assets/'.length));
await writeFile('app/src/main/assets/pdf/manifest.json',JSON.stringify({version:meta.version,assets}));
console.log('Bundled PDF.js '+meta.version+' ('+assets.length+' local assets)');
