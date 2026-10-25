import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('worker/ui.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/index.html','utf8'))+';\n');

writeFileSync('worker/editor.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/editor.js','utf8'))+';\n');


// Ship the current, unchanged PDF UI alongside HTML; keep vendor assets in PDF_ASSETS.
const pdf={};for(const name of ['reader.mjs','glass.mjs','reader.css'])pdf['/pdf/'+name]=readFileSync('app/src/main/assets/pdf/'+name,'utf8');
writeFileSync('worker/pdf-static.mjs','export default '+JSON.stringify(pdf)+';\n');
