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
assert.ok(manifest.assets.includes('/pdf/THIRD_PARTY_NOTICES.md'),
  'The attribution summary must be available offline');
assert.ok(manifest.assets.includes('/pdf/EASYBOOK_LICENSE.txt'),
  'The Easybook license must be available offline');

const html=read('app/src/main/assets/index.html');
assert.match(html,/id="thirdPartyLicensesDialog"/);
assert.match(html,/id="thirdPartyLicensesEntry"/);
assert.match(html,/id="projectLicenseEntry"/);
assert.match(html,/id="thirdPartyNoticesEntry"/);
assert.match(html,/fetch\('\/pdf\/THIRD_PARTY_LICENSES\.md'\)/);
const android=read('app/src/main/java/com/feoearth/easybook/MainActivity.java');
assert.match(android,/asset\.endsWith\("\.md"\)\|\|asset\.endsWith\("\.txt"\)\?"text\/plain"/);

const dom=new JSDOM(html);
const document=dom.window.document;
const snippetStart=html.indexOf('// About and legal documents are bundled in Android');
const snippetEnd=html.indexOf('\nif(native){',snippetStart);
assert.ok(snippetStart>0&&snippetEnd>snippetStart);
const legalFiles=new Map([
  ['/pdf/THIRD_PARTY_LICENSES.md',notice],
  ['/pdf/THIRD_PARTY_NOTICES.md',read('THIRD_PARTY_NOTICES.md')],
  ['/pdf/EASYBOOK_LICENSE.txt',read('LICENSE')],
]);
const fakeFetch=async url=>{
  assert.ok(legalFiles.has(url),'Unexpected legal document request: '+url);
  return new Response(legalFiles.get(url),{status:200});
};
new Function('document','$','fetch',html.slice(snippetStart,snippetEnd))(
  document,id=>document.getElementById(id),fakeFetch);
for(const id of ['aboutEntry','projectLicenseEntry','thirdPartyNoticesEntry','thirdPartyLicensesEntry'])
  assert.ok(document.getElementById(id)&&document.getElementById('settings').contains(document.getElementById(id)));
const aboutGroup=document.getElementById('aboutSettingsGroup');
const settingsHome=document.getElementById('settingsHome');
assert.equal(settingsHome.hidden,false,'The concise Settings category list must be visible initially');
assert.deepEqual([...settingsHome.querySelectorAll('[data-settings-category]')].map(node=>node.dataset.settingsCategory),
  ['account','workspace','sync','appearance','about']);
assert.equal(document.getElementById('settingsCategory-about').hidden,true,
  'About details stay in their secondary page until requested');
assert.equal(document.getElementById('workspacePanel').hidden,true,
  'Workspace details remain collapsed independently of the Settings category navigation');
settingsHome.querySelector('[data-settings-category="about"]').click();
assert.equal(settingsHome.hidden,true);
assert.equal(document.getElementById('settingsTitle').hidden,true);
assert.equal(document.getElementById('settingsCategory-about').hidden,false,
  'About must open directly from the Settings home without expanding workspace members');
assert.equal(aboutGroup.closest('.settings-category-panel').id,'settingsCategory-about');
document.querySelector('#settingsCategory-about .settings-category-back').click();
assert.equal(settingsHome.hidden,false);
assert.equal(document.getElementById('settingsTitle').hidden,false);
for(const id of ['aboutDialog','legalDocumentDialog','thirdPartyLicensesDialog']){
  const dialog=document.getElementById(id);dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false};
}
document.getElementById('aboutEntry').onclick();
assert.equal(document.getElementById('aboutDialog').open,true);
assert.match(document.getElementById('aboutDialog').textContent,/AGPL-3\.0-only/);
document.getElementById('aboutClose').onclick();
await document.getElementById('projectLicenseEntry').onclick();
assert.match(document.getElementById('legalDocumentText').textContent,/GNU AFFERO GENERAL PUBLIC LICENSE/);
document.getElementById('legalDocumentClose').onclick();
await document.getElementById('thirdPartyNoticesEntry').onclick();
assert.equal(document.getElementById('legalDocumentText').textContent,read('THIRD_PARTY_NOTICES.md'));
document.getElementById('legalDocumentClose').onclick();
await document.getElementById('thirdPartyLicensesEntry').onclick();
assert.equal(document.getElementById('thirdPartyLicensesText').textContent,notice);
assert.equal(document.getElementById('thirdPartyLicensesDialog').open,true);
document.getElementById('thirdPartyLicensesClose').onclick();
assert.equal(document.getElementById('thirdPartyLicensesDialog').open,false);

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
