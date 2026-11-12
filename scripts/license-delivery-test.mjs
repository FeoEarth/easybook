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
assert.equal(read('app/src/main/assets/pdf/THIRD_PARTY_NOTICES.md'),read('THIRD_PARTY_NOTICES.md'),
  'Android/Web bundled attribution summary must match the repository notice');
assert.equal(read('app/src/main/assets/pdf/EASYBOOK_LICENSE.txt'),read('LICENSE'),
  'Android/Web bundled project license must match the repository license');
assert.match(notice,/Entries: \d+ \(/);
assert.match(notice,/## Audit inputs \/ 审计输入/);
assert.match(notice,/## Complete license texts/);
assert.match(notice,/\| qrcode-generator \(vendored\) \|/,'The non-npm QR encoder must be in the component inventory');
assert.match(notice,/Copyright \(c\) 2009 Kazuhiko Arase/,'The QR encoder copyright must be retained');
assert.match(notice,/Easybook-LiteRT-LM-arm64-v8a\.so/,'The separately distributed native runtime must be identified');

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
assert.match(html,/loadLegalText\('\/pdf\/THIRD_PARTY_LICENSES\.md'/);
const android=read('app/src/main/java/com/feoearth/easybook/MainActivity.java');
assert.match(android,/asset\.endsWith\("\.md"\)\|\|asset\.endsWith\("\.txt"\)\?"text\/plain"/);

const dom=new JSDOM(html);
const document=dom.window.document;
const snippetStart=html.indexOf('// Third-party notices refresh from GitHub; bundled/static copies remain the');
const snippetEnd=html.indexOf('\nif(native){',snippetStart);
assert.ok(snippetStart>0&&snippetEnd>snippetStart);
const legalFiles=new Map([
  ['/pdf/THIRD_PARTY_LICENSES.md',notice],
  ['/pdf/THIRD_PARTY_NOTICES.md',read('THIRD_PARTY_NOTICES.md')],
  ['/pdf/EASYBOOK_LICENSE.txt',read('LICENSE')],
]);
const documents=[
  {entry:'thirdPartyNoticesEntry',local:'/pdf/THIRD_PARTY_NOTICES.md',remote:'https://raw.githubusercontent.com/FeoEarth/easybook/main/THIRD_PARTY_NOTICES.md',content:'legalDocumentText',dialog:'legalDocumentDialog',close:'legalDocumentClose'},
  {entry:'thirdPartyLicensesEntry',local:'/pdf/THIRD_PARTY_LICENSES.md',remote:'https://raw.githubusercontent.com/FeoEarth/easybook/main/THIRD_PARTY_LICENSES.md',content:'thirdPartyLicensesText',dialog:'thirdPartyLicensesDialog',close:'thirdPartyLicensesClose'},
];
const rawURLs=new Set(documents.map(item=>item.remote)),requests=[],timers=new Map();let timerSerial=0;
let remoteFetch=async()=>{throw Error('offline')};
let localFetch=async url=>new Response(legalFiles.get(url),{status:200});
const fakeFetch=async(url,options={})=>{
  requests.push({url,options});
  if(rawURLs.has(url)){
    assert.equal(options.credentials,'omit','Public notices must not send account credentials');
    assert.equal(options.cache,'no-store','Reopening must revalidate the latest notice');
    assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
    assert.ok(options.signal instanceof AbortSignal,'Online document requests have a bounded lifetime');
    return remoteFetch(url,options);
  }
  assert.ok(legalFiles.has(url),'Unexpected legal document request: '+url);
  return localFetch(url,options);
};
const fakeTimeout=(callback,delay)=>{assert.equal(delay,4000,'Legal document requests have a four-second timeout');const id=++timerSerial;timers.set(id,callback);return id};
new Function('document','$','fetch','native','setTimeout','clearTimeout','AbortController',html.slice(snippetStart,snippetEnd))(
  document,id=>document.getElementById(id),fakeFetch,false,fakeTimeout,id=>timers.delete(id),AbortController);
for(const id of ['aboutEntry','projectLicenseEntry','thirdPartyNoticesEntry','thirdPartyLicensesEntry'])
  assert.ok(document.getElementById(id)&&document.getElementById('settings').contains(document.getElementById(id)));
const aboutGroup=document.getElementById('aboutSettingsGroup');
const settingsHome=document.getElementById('settingsHome');
assert.equal(settingsHome.hidden,false,'The concise Settings category list must be visible initially');
assert.deepEqual([...settingsHome.querySelectorAll('[data-settings-category]')].map(node=>node.dataset.settingsCategory),
  ['account','workspace','ai','sync','appearance','about']);
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
assert.equal(document.querySelectorAll('.settings-category-back').length,0,
  'Secondary Settings pages must rely on the single top navigation back button');
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

// Exercise the actual click handlers with controlled fetches, without waiting
// for real timeouts or contacting GitHub. Keep the bundled fallback checks above.
for(const item of documents){
  const get=id=>document.getElementById(id),text=legalFiles.get(item.local);
  for(const revision of [1,2]){
    const latest=text+'\nOnline revision '+revision+'\n',start=requests.length;
    remoteFetch=async()=>new Response(latest,{status:200});
    await get(item.entry).onclick();
    assert.equal(get(item.content).textContent,latest,'Opening a third-party document uses the latest online text');
    assert.deepEqual(requests.slice(start).map(request=>request.url),[item.remote],'Each open fetches GitHub rather than permanently caching an older document');
    get(item.close).onclick();
  }
  for(const failure of ['offline','http','invalid','timeout']){
    const start=requests.length;let timedOut=false;
    remoteFetch=async(_url,options)=>{
      if(failure==='offline')throw Error('offline');
      if(failure==='http')return new Response('Unavailable',{status:503});
      if(failure==='invalid')return new Response('<html>GitHub error page</html>',{status:200});
      return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{timedOut=true;reject(options.signal.reason)},{once:true}));
    };
    const opening=get(item.entry).onclick();
    if(failure==='timeout'){
      assert.equal(timers.size,1,'The stalled online request is bounded');
      [...timers.values()][0]();
    }
    await opening;
    assert.equal(get(item.content).textContent,text,failure+' uses the matching bundled document');
    assert.deepEqual(requests.slice(start).map(request=>request.url),[item.remote,item.local],'Online failure falls back to the local copy');
    assert.equal(timedOut,failure==='timeout');assert.equal(timers.size,0,'Completed attempts clear their timeout');
    get(item.close).onclick();
  }
}

// The project license stays local, and an earlier request in the shared legal
// dialog cannot overwrite a document opened later in that same dialog.
let releaseProject;
localFetch=async url=>url==='/pdf/EASYBOOK_LICENSE.txt'
  ?new Promise(resolve=>{releaseProject=()=>resolve(new Response(legalFiles.get(url)))})
  :new Response(legalFiles.get(url));
const projectStart=requests.length,projectOpening=document.getElementById('projectLicenseEntry').onclick();
const latestNotice=legalFiles.get(documents[0].local)+'\nNewer shared-dialog notice\n';
remoteFetch=async()=>new Response(latestNotice);
await document.getElementById('thirdPartyNoticesEntry').onclick();
releaseProject();await projectOpening;
assert.deepEqual(requests.slice(projectStart).map(request=>request.url),['/pdf/EASYBOOK_LICENSE.txt',documents[0].remote]);
assert.equal(document.getElementById('legalDocumentText').textContent,latestNotice,'A slow previous project-license load cannot overwrite the newer attribution notice');
assert.equal(document.getElementById('legalDocumentTitle').textContent,'第三方归属说明');
document.getElementById('legalDocumentClose').onclick();
localFetch=async url=>new Response(legalFiles.get(url));

// A closed and reopened dialog must ignore its previous online response. This
// covers both the shared legal dialog and the independent full-inventory dialog.
for(const item of documents){
  let releaseOld;
  remoteFetch=async()=>new Promise(resolve=>{releaseOld=()=>resolve(new Response(legalFiles.get(item.local)+'\nStale response\n'))});
  const oldOpening=document.getElementById(item.entry).onclick();
  document.getElementById(item.close).onclick();
  const current=legalFiles.get(item.local)+'\nCurrent response\n';
  remoteFetch=async()=>new Response(current);
  await document.getElementById(item.entry).onclick();
  releaseOld();await oldOpening;
  assert.equal(document.getElementById(item.content).textContent,current,'An obsolete response cannot overwrite the reopened dialog');
  assert.equal(document.getElementById(item.dialog).open,true);
  document.getElementById(item.close).onclick();
}
assert.equal(timers.size,0);

// Exercise the existing static Web route without contacting production or R2.
const {default:worker}=await import('../worker/index.mjs');
let requested;
const response=await worker.fetch(new Request('https://easybook.loonxy.com/pdf/THIRD_PARTY_LICENSES.md'),{
  PDF_ASSETS:{fetch(request){requested=new URL(request.url).pathname;return new Response(bundled,{headers:{'Content-Type':'text/plain'}})}}
});
assert.equal(requested,'/THIRD_PARTY_LICENSES.md');
assert.equal(response.status,200);
assert.equal(await response.text(),notice);
dom.window.close();
console.log('Third-party notices match generated source, Android asset and Web static route; online refresh, offline/HTTP/invalid/timeout fallback and dialog request isolation pass.');
