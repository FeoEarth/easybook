import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Generate from the exact installed versions, never from floating online license pages.
// Run `npm ci --omit=dev` in both package roots before invoking this script.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'THIRD_PARTY_LICENSES.md');
const checking=process.argv.includes('--check');
const hash=s=>createHash('sha256').update(s).digest('hex');
const read=(p)=>readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n').trimEnd()+'\n';
const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ').trim();
const records=[];
const licenseTexts=new Map();

function add({name,version,scope,spdx,holder,source,files=[],termsUrl='',note=''}){
  if(!name||!version||!spdx||(!files.length&&!termsUrl))throw Error('Incomplete third-party record: '+name);
  const licenses=[];
  for(const file of files){
    const contents=read(file);
    if(contents.length<80)throw Error('License text unexpectedly short: '+file);
    const id=hash(contents);
    if(!licenseTexts.has(id))licenseTexts.set(id,{contents,sources:[]});
    licenseTexts.get(id).sources.push(file);
    licenses.push(id);
  }
  records.push({name,version,scope,spdx,holder:holder||'未在发布包元数据中明确列出',source,licenses,termsUrl,note});
}

function person(value){
  if(typeof value==='string')return value;
  if(value&&typeof value==='object')return [value.name,value.url].filter(Boolean).join(' · ');
  return '';
}
function copyrightFrom(files){
  const lines=files.flatMap(f=>read(f).split('\n'));
  return lines.find(line=>/^\s*(?:\/[*\/]|[*#%]|<!--)?\s*(?:copyright\b|©\s*\d{4})/i.test(line)&&!line.includes('[yyyy]'))
    ?.replace(/^\s*(?:\/[*\/]|[*#%]|<!--)\s*/,'').trim()||'';
}
function packageLicensePaths(packagePath){
  if(!existsSync(path.join(root,packagePath)))throw Error('Missing pinned dependency: '+packagePath+'. Run npm ci --omit=dev.');
  const names=readdirSync(path.join(root,packagePath))
    .filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].+)?$/i.test(n))
    .filter(n=>!n.toLowerCase().endsWith('.json'))
    .filter(n=>!n.toLowerCase().endsWith('.html'))
    .sort();
  if(names.length)return names.map(n=>path.posix.join(packagePath,n));
  // This exact npm release omits its upstream LICENSE-MIT.txt from the tarball.
  if(packagePath==='node_modules/punycode.js')return ['third_party/punycode.js/LICENSE-MIT.txt'];
  throw Error('Missing full upstream license file: '+packagePath);
}

function collectNpm(directory,scope){
  const lock=JSON.parse(read(path.posix.join(directory,'package-lock.json')));
  for(const [entry,metadata] of Object.entries(lock.packages)){
    if(!entry.startsWith('node_modules/')||metadata.dev||metadata.optional)continue;
    const packagePath=path.posix.join(directory,entry);
    const pkg=JSON.parse(read(path.posix.join(packagePath,'package.json')));
    if(pkg.version!==metadata.version)throw Error('Package/version mismatch: '+packagePath);
    const files=packageLicensePaths(packagePath);
    let spdx=metadata.license;
    if(!spdx||typeof spdx!=='string')throw Error('Missing SPDX in lockfile: '+packagePath);
    if(pkg.license!==spdx)throw Error('Package/lockfile SPDX mismatch: '+packagePath);
    const original=copyrightFrom(files);
    const holder=original||person(pkg.author)||person(pkg.publisher)||person(pkg.maintainers?.[0])
      ||(pkg.name==='pdfjs-dist'?'Mozilla Foundation and PDF.js contributors':'');
    const label=entry.slice(entry.lastIndexOf('node_modules/')+'node_modules/'.length);
    add({name:label,version:metadata.version,scope,spdx,holder,
      source:`${directory||'.'}/package-lock.json → ${entry}`,files,
      note:entry.startsWith('node_modules/esbuild')?'Build tool; not embedded in the application runtime.':''});
  }
}

collectNpm('','Web editor / PDF build');
collectNpm('mcp-oauth','OAuth Worker');

const androidManifest=JSON.parse(read('third_party/android/runtime-dependencies.json'));
if(androidManifest.generated_from!=='Gradle :app:releaseRuntimeClasspath'||!androidManifest.modules?.length)
  throw Error('Missing resolved Android runtime license manifest.');
const android=androidManifest.modules;
for(const item of android){
  const proprietary=item.spdx==='LicenseRef-Android-SDK-License';
  add({name:item.name,version:item.version,scope:'Android release runtime',spdx:item.spdx,
    holder:item.author,source:item.source_pom,
    files:proprietary?[]:[item.license_file],termsUrl:proprietary?item.license_url:'',
    note:item.note});
}

// The native shader is a modified, separately licensed MIT work, included in APK assets.
add({name:'QWEA0/Liquid-Glass-Android (ported shader)',version:'16afe4d8b5d08a370d3f8c50b08d7f5c6eb5da4d',
  scope:'Android APK',spdx:'MIT',holder:'Copyright (c) 2025-2026 pandadog',
  source:'third_party/qwea0-liquid-glass/NOTICE.md',files:['third_party/qwea0-liquid-glass/LICENSE'],
  note:'Java/AGSL port; the separate MIT license is also packaged at native-glass/LICENSE.txt.'});

// PDF.js ships more licenses than its top-level Apache-2.0 declaration: these
// exact resource directories are copied by scripts/prepare-pdf.mjs.
const pdfExtras=[
  ['cmaps/LICENSE','BSD-3-Clause','Adobe Systems Incorporated'],
  ['standard_fonts/LICENSE_FOXIT','BSD-3-Clause','PDFium Authors'],
  ['standard_fonts/LICENSE_LIBERATION','LicenseRef-Liberation-Font-License','Red Hat, Inc. and Liberation font contributors'],
  ['wasm/LICENSE_JBIG2','BSD-3-Clause','PDFium Authors'],
  ['wasm/LICENSE_OPENJPEG','BSD-2-Clause','OpenJPEG contributors'],
  ['wasm/LICENSE_QCMS','MIT','Mozilla Corporation and Marti Maria'],
  ['wasm/LICENSE_PDFJS_JBIG2','Apache-2.0','Mozilla Foundation'],
  ['wasm/LICENSE_PDFJS_OPENJPEG','BSD-2-Clause','Mozilla Foundation'],
  ['wasm/LICENSE_PDFJS_QCMS','MIT','Mozilla Foundation'],
];
if(JSON.parse(read('node_modules/pdfjs-dist/package.json')).version!=='6.4.299')
  throw Error('PDF.js vendor resource map needs review after a version change.');
const actualPdfFiles=['cmaps','standard_fonts','wasm'].flatMap(dir=>
  readdirSync(path.join(root,'node_modules/pdfjs-dist',dir))
    .filter(name=>/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].+)?$/i.test(name))
    .map(name=>`${dir}/${name}`)).sort();
const declaredPdfFiles=pdfExtras.map(([file])=>file).sort();
if(JSON.stringify(actualPdfFiles)!==JSON.stringify(declaredPdfFiles))
  throw Error('PDF.js embedded license files changed; review and update pdfExtras.');
for(const [suffix,spdx,holder] of pdfExtras){
  add({name:'pdfjs-dist/'+suffix,version:'6.4.299',scope:'Android APK / Web PDF assets',spdx,
    holder,source:'pdfjs-dist 6.4.299 / '+suffix,
    files:['node_modules/pdfjs-dist/'+suffix],
    note:suffix.includes('LIBERATION')?'Custom GPL-2.0-based font agreement with additional exceptions; see original text.':''});
}

records.sort((a,b)=>a.scope.localeCompare(b.scope)||a.name.localeCompare(b.name)||a.version.localeCompare(b.version));

const sections=[];
sections.push('# THIRD_PARTY_LICENSES — Third-party production license inventory');
sections.push('');
sections.push('> **Generated file.** Run `npm ci --omit=dev --ignore-scripts` in the repository root and `mcp-oauth/`, then `node scripts/generate-third-party-licenses.mjs`. Do not hand-edit this file.');
sections.push('');
sections.push('This inventory retains the original license text bundled with the locked npm package versions, the QWEA0 port, PDF.js embedded font/CMap/decoder licenses, and the **resolved Android release runtime dependency graph** (including transitive AAR/JAR artifacts). SPDX entries describe the **component**, not a relicensing to Easybook AGPL-3.0-only. Identical full open-source license texts are printed once and referenced by SHA-256.');
sections.push('');
sections.push('**Coverage boundary:** development/test and platform-specific optional npm packages are excluded; esbuild is listed but marked build-only. The Android `releaseRuntimeClasspath` is resolved by Gradle, but final APK byte-for-byte contents are not yet audited. Proprietary Google Play Services modules are **not open-source**: their Maven POMs point to the Android SDK License terms, which are linked rather than reproduced as an open-source license text. The Liberation font uses its own GPL-2.0-based agreement with exceptions, identified with a local `LicenseRef` rather than inaccurately described as Apache-2.0.');
sections.push('');
sections.push(`Entries: ${records.length} (${records.filter(x=>x.scope==='Web editor / PDF build').length} npm main, ${records.filter(x=>x.scope==='OAuth Worker').length} npm OAuth, ${records.filter(x=>x.scope==='Android APK / Web PDF assets').length} embedded PDF resources, ${android.length} resolved Android runtime modules, one native glass port).`);
sections.push('');
sections.push('## Component inventory');
sections.push('');
sections.push('| Component | Version | Distributed in / scope | SPDX | Original author / copyright | Full text / terms |');
sections.push('| --- | --- | --- | --- | --- | --- |');
for(const r of records){
  const refs=r.termsUrl?`[Official proprietary terms](${r.termsUrl})`:
    r.licenses.map(h=>`[${h.slice(0,10)}](#license-text-${h.slice(0,16)})`).join(', ');
  sections.push(`| ${escape(r.name)} | ${escape(r.version)} | ${escape(r.scope)} | \`${escape(r.spdx)}\` | ${escape(r.holder)} | ${refs} |`);
}
sections.push('');
sections.push('## Source paths and exceptions');
sections.push('');
for(const r of records){
  if(r.note)sections.push(`- **${r.name}@${r.version}**: ${r.note}`);
}
sections.push('');
sections.push('Source coordinates for each npm package are pinned by `package-lock.json` and `mcp-oauth/package-lock.json`; Android coordinates and license statements come from the exact Gradle release runtime graph and each artifact’s published Maven POM. PDF.js embedded resource names correspond exactly to the directories copied by `scripts/prepare-pdf.mjs`. The upstream open-source license in each section below is reproduced verbatim apart from normalizing line endings and a final newline.');
sections.push('');
sections.push('## Complete license texts');
sections.push('');
for(const [id,data] of Array.from(licenseTexts).sort(([a],[b])=>a.localeCompare(b))){
  sections.push(`### License text ${id.slice(0,16)}`);
  sections.push('');
  sections.push(`SHA-256: \`${id}\``);
  sections.push('');
  sections.push(`Source files: ${[...new Set(data.sources)].map(s=>'`'+s+'`').join(', ')}`);
  sections.push('');
  sections.push('~~~~text');
  sections.push(data.contents.trimEnd());
  sections.push('~~~~');
  sections.push('');
}
const result=sections.join('\n').trimEnd()+'\n';
if(checking){
  if(!existsSync(output)||readFileSync(output,'utf8')!==result){
    console.error('THIRD_PARTY_LICENSES.md is stale. Run node scripts/generate-third-party-licenses.mjs.');
    process.exitCode=1;
  }else console.log(`THIRD_PARTY_LICENSES.md current (${records.length} entries, ${licenseTexts.size} distinct texts).`);
}else{
  writeFileSync(output,result);
  console.log(`Generated THIRD_PARTY_LICENSES.md (${records.length} entries, ${licenseTexts.size} distinct texts).`);
}
