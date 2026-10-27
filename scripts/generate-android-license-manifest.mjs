import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

// Reads Gradle's resolved release runtime classpath and pinned Maven POM metadata.
// No APK compilation or guessed transitive versions.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=path.join(root,'app/build/reports/license-runtime-artifacts.json');
const output=path.join(root,'third_party/android/runtime-dependencies.json');
const cache=path.join(process.env.GRADLE_USER_HOME||path.join(os.homedir(),'.gradle'),
  'caches/modules-2/files-2.1');
const checking=process.argv.includes('--check');

if(!existsSync(report))throw Error('Missing Android release runtime report. Run gradle -I scripts/android-runtime-artifacts.gradle :app:exportLicenseRuntimeArtifacts.');
const artifacts=JSON.parse(readFileSync(report,'utf8'));
if(!Array.isArray(artifacts)||!artifacts.length)throw Error('Empty Android runtime classpath');
const resolved=new Map();
for(const artifact of artifacts){
  const {group,name,version,type}=artifact;
  if(!group||!name||!version||!['aar','jar'].includes(type))throw Error('Bad resolved Gradle artifact');
  const id=`${group}:${name}:${version}`;
  if(resolved.has(id)&&resolved.get(id).type!==type)
    throw Error(`Conflicting runtime artifact types for ${id}`);
  resolved.set(id,artifact);
}

// A locked license manifest is checked against the *actual resolved* runtime
// graph. CI Gradle caches sometimes have .module metadata but no POM copies;
// checking exact coordinates here avoids unreliable network/POM cache access.
// To refresh author/license facts, run without --check, which reads the POMs.
if(checking){
  if(!existsSync(output))throw Error('Missing Android runtime license manifest');
  const manifest=JSON.parse(readFileSync(output,'utf8'));
  if(manifest.generated_from!=='Gradle :app:releaseRuntimeClasspath'||!Array.isArray(manifest.modules))
    throw Error('Invalid Android runtime license manifest');
  const actual=[...resolved.values()].map(a=>`${a.group}:${a.name}:${a.version} (${a.type})`).sort();
  const expected=manifest.modules.map(m=>{
    if(!m.name||!m.version||!m.author||!m.license_url||
       !['Apache-2.0','LicenseRef-Android-SDK-License'].includes(m.spdx)||
       (m.spdx==='Apache-2.0'&&!m.license_file))
      throw Error(`Incomplete or unreviewed license entry for ${m.name||'(unknown)'}`);
    return `${m.name}:${m.version} (${m.type})`;
  }).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)){
    console.error('Android release runtime graph differs from checked-in license manifest. Regenerate with npm run licenses:android.');
    console.error('Resolved:',actual);
    console.error('Manifest:',expected);
    process.exit(1);
  }
  console.log(`Android runtime manifest matches resolved release classpath (${expected.length} unique modules).`);
  process.exit(0);
}

function element(xml,tag){
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim()||'';
}
function decodeXml(text){return text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
async function pomFor({group,name,version}){
  const dir=path.join(cache,group,name,version);
  const files=existsSync(dir)?readdirSync(dir).flatMap(hash=>{
    const sub=path.join(dir,hash);
    return existsSync(sub)?readdirSync(sub).filter(x=>x.endsWith('.pom')).map(x=>path.join(sub,x)):[];
  }):[];
  if(files.length===1&&!process.env.EASYBOOK_FORCE_REMOTE_POM)return readFileSync(files[0],'utf8');
  const url=sourceUrl({group,name,version});
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const pom=await response.text();
      if(!pom.includes('<project')||!pom.includes(`<artifactId>${name}</artifactId>`))
        throw Error('Unexpected Maven POM document');
      return pom;
    }catch(error){
      lastError=error;
      if(attempt<2)await new Promise(done=>setTimeout(done,300*(attempt+1)));
    }
  }
  throw Error(`Cannot read pinned Maven POM from ${url}: ${lastError}`);
}
function sourceUrl({group,name,version}){
  const host=group.startsWith('androidx.')||group.startsWith('com.google.android.')?
    'https://dl.google.com/dl/android/maven2':'https://repo.maven.apache.org/maven2';
  return `${host}/${group.replaceAll('.','/')}/${name}/${version}/${name}-${version}.pom`;
}
const seen=new Map();
for(const artifact of resolved.values()){
  const {group,name,version,type}=artifact;
  const id=`${group}:${name}:${version}`;
  if(seen.has(id))continue; // Gradle may return multiple variants of one module.
  const pom=await pomFor(artifact),block=element(pom,'licenses');
  const licenses=[...block.matchAll(/<license(?:\s[^>]*)?>([\s\S]*?)<\/license>/g)]
    .map(m=>({name:decodeXml(element(m[1],'name')),url:decodeXml(element(m[1],'url'))}));
  const licenseNames=licenses.map(l=>l.name);
  const apache=licenseNames.length===1&&/Apache.*(?:2\.0|Version 2)/i.test(licenseNames[0]);
  const sdk=licenseNames.length===1&&licenseNames[0]==='Android Software Development Kit License';
  const guavaPlaceholder=id==='com.google.guava:listenablefuture:1.0'&&!licenses.length;
  if(!apache&&!sdk&&!guavaPlaceholder)
    throw Error('Unreviewed Android license for '+id+': '+JSON.stringify(licenses));
  const spdx=sdk?'LicenseRef-Android-SDK-License':'Apache-2.0';
  const organization=decodeXml(element(element(pom,'organization'),'name'));
  const author=organization||
    (group.startsWith('androidx.')?'The Android Open Source Project':
      group.startsWith('com.google.')?'Google LLC':
      (group==='org.jetbrains'||group.startsWith('org.jetbrains.'))?'JetBrains s.r.o.':'Upstream project contributors');
  const termsUrl=sdk?licenses[0].url:
    guavaPlaceholder?'https://www.apache.org/licenses/LICENSE-2.0':licenses[0].url;
  if(!termsUrl?.startsWith('https://')&&!termsUrl?.startsWith('http://'))throw Error('Missing upstream license URL for '+id);
  seen.set(id,{name:`${group}:${name}`,version,type,spdx,author,
    license_url:termsUrl,source_pom:sourceUrl(artifact),
    license_file:sdk?null:'third_party/pdfjs/LICENSE',
    note:sdk?'Proprietary Google Android SDK terms (not an OSI-approved open-source license).':
      guavaPlaceholder?'Google Guava listenablefuture 1.0 empty compatibility artifact; POM omits license metadata. Apache-2.0 per upstream Guava.':''});
}
const rows=[...seen.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
const result=JSON.stringify({generated_from:'Gradle :app:releaseRuntimeClasspath',modules:rows},null,2)+'\n';
writeFileSync(output,result);
console.log(`Generated Android runtime manifest (${rows.length} unique modules).`);
