// Targeted library/resource integration only; no browser, emulator or UI tests.
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDocument,GlobalWorkerOptions,version} from '../app/src/main/assets/pdf/vendor/pdf.mjs';
assert.equal(version,'6.4.299');GlobalWorkerOptions.workerSrc=new URL('../app/src/main/assets/pdf/vendor/pdf.worker.mjs',import.meta.url).href;
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',null,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
for(const [i,text]of [[3,'Easybook PDF first page'],[5,'Search second page']]){const stream='BT /F1 16 Tf 20 350 Td ('+text+') Tj ET';objects[i]='<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'}
let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n'});const xref=pdf.length;pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
const task=getDocument({data:new TextEncoder().encode(pdf),isEvalSupported:false,standardFontDataUrl:fileURLToPath(new URL('../app/src/main/assets/pdf/vendor/standard_fonts/',import.meta.url))});
try{const doc=await task.promise;assert.equal(doc.numPages,2);for(const [n,text]of [[1,'Easybook PDF first page'],[2,'Search second page']]){const page=await doc.getPage(n);assert.equal((await page.getTextContent()).items.map(i=>i.str).join(''),text);assert.ok(page.getViewport({scale:1}).width>0);page.cleanup()}}finally{await task.destroy()}
const invalid=getDocument({data:new TextEncoder().encode('not a pdf'),isEvalSupported:false});try{await assert.rejects(invalid.promise,{name:'InvalidPDFException'})}finally{await invalid.destroy()}
const manifest=JSON.parse(await readFile('app/src/main/assets/pdf/manifest.json','utf8'));assert.equal(manifest.version,version);for(const resource of manifest.assets)await access('app/src/main/assets'+resource);
const java=await readFile('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8');assert.ok(!java.includes('PdfActivity'));assert.ok(java.includes('getAssets().open(asset)'));
const html=await readFile('app/src/main/assets/index.html','utf8');assert.ok(!html.includes('使用应用内 PDF 阅读器'));assert.ok(html.includes("import('/pdf/reader.mjs')"));assert.ok(html.includes('updateFormatbarVisibility()'));
console.log('PDF.js '+version+': 2-page load/text extraction, invalid-PDF error, destroy, '+manifest.assets.length+' local resources, and native-route wiring passed. UI/gestures/IME not tested.');
