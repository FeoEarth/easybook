import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const notice=read('THIRD_PARTY_LICENSES.md');
const bundled=read('app/src/main/assets/pdf/THIRD_PARTY_LICENSES.md');
assert.equal(bundled,notice,'Android/Web bundled license notices must match the generated inventory');
assert.match(notice,/Entries: \d+ \(/);
assert.match(notice,/## Audit inputs \/ 审计输入/);
assert.match(notice,/## Complete license texts/);

const rootPackage=JSON.parse(read('package.json'));
const oauthPackage=JSON.parse(read('mcp-oauth/package.json'));
assert.equal(rootPackage.license,'AGPL-3.0-only');
assert.equal(oauthPackage.license,rootPackage.license,
  'The OAuth subproject must declare the repository license explicitly');
assert.equal(read('app/src/main/assets/native-glass/LICENSE.txt'),read('third_party/qwea0-liquid-glass/LICENSE'),
  'The APK must ship the exact pinned QWEA0 license text');

const manifest=JSON.parse(read('app/src/main/assets/pdf/manifest.json'));
assert.ok(manifest.assets.includes('/pdf/THIRD_PARTY_LICENSES.md'),
  'PDF assets manifest must make the notice available on Web');

const html=read('app/src/main/assets/index.html');
assert.match(html,/id="thirdPartyLicensesDialog"/);
assert.match(html,/id="thirdPartyLicensesEntry"/);
assert.match(html,/fetch\('\/pdf\/THIRD_PARTY_LICENSES\.md'\)/);
const android=read('app/src/main/java/com/feoearth/easybook/MainActivity.java');
assert.match(android,/asset\.endsWith\("\.md"\)\?"text\/plain"/);

const dom=new JSDOM(html);
const document=dom.window.document;
const snippetStart=html.indexOf('// The same notice is bundled in Android');
const snippetEnd=html.indexOf('\nif(native){',snippetStart);
assert.ok(snippetStart>0&&snippetEnd>snippetStart);
const dialog=document.getElementById('thirdPartyLicensesDialog');
dialog.showModal=()=>{dialog.open=true};
dialog.close=()=>{dialog.open=false};
const fakeFetch=async url=>{
  assert.equal(url,'/pdf/THIRD_PARTY_LICENSES.md');
  return new Response(notice,{status:200});
};
new Function('document','$','fetch',html.slice(snippetStart,snippetEnd))(
  document,id=>document.getElementById(id),fakeFetch);
const entry=document.getElementById('thirdPartyLicensesEntry');
assert.ok(entry&&document.getElementById('settings').contains(entry));
await entry.onclick();
assert.equal(document.getElementById('thirdPartyLicensesText').textContent,notice);
assert.equal(dialog.open,true);
document.getElementById('thirdPartyLicensesClose').onclick();
assert.equal(dialog.open,false);

// Exercise the existing static Web route without contacting production or R2.
const {default:worker}=await import('../worker/index.mjs');
let requested;
const response=await worker.fetch(new Request('https://easybook.loonxy.com/pdf/THIRD_PARTY_LICENSES.md'),{
  PDF_ASSETS:{fetch(request){requested=new URL(request.url).pathname;return new Response(bundled,{headers:{'Content-Type':'text/plain'}})}}
});
assert.equal(requested,'/THIRD_PARTY_LICENSES.md');
assert.equal(response.status,200);
assert.equal(await response.text(),notice);
console.log('Third-party notices match generated source, Android asset and Web static route.');
