import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('worker/ui.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/index.html','utf8'))+';\n');

// Keep Worker-hosted browser icons in sync with the checked-in Android artwork.
const brandFiles=['favicon-light.png','favicon-dark.png','favicon.ico','apple-touch-icon.png','icon-192.png','icon-512.png'];
const brandAssets=Object.fromEntries(brandFiles.map(name=>['/'+name,readFileSync('app/src/main/assets/brand/'+name).toString('base64')]));
writeFileSync('worker/brand-icons.mjs','export default '+JSON.stringify(brandAssets)+';\n');

writeFileSync('worker/editor.mjs','export default '+JSON.stringify(readFileSync('app/src/main/assets/editor.js','utf8'))+';\n');

// Android updater presentation is OTA-eligible, while the APK keeps the same
// script in res/raw as the offline recovery implementation.
writeFileSync('worker/native-update.mjs','export default '+JSON.stringify(readFileSync('app/src/main/res/raw/native_update.js','utf8'))+';\n');


// Ship the current, unchanged PDF UI alongside HTML; keep vendor assets in PDF_ASSETS.
const pdf={};for(const name of ['reader.mjs','glass.mjs','reader.css'])pdf['/pdf/'+name]=readFileSync('app/src/main/assets/pdf/'+name,'utf8');
writeFileSync('worker/pdf-static.mjs','export default '+JSON.stringify(pdf)+';\n');

const nativeGlass={};for(const name of ['highlight-palette.js','adaptive-toolbar.js'])nativeGlass['/native-glass/'+name]=readFileSync('app/src/main/assets/native-glass/'+name,'utf8');
writeFileSync('worker/native-glass-static.mjs','export default '+JSON.stringify(nativeGlass)+';\n');
