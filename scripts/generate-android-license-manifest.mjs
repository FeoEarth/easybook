import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

// Only reads Gradle's resolved release runtime classpath and cached POM metadata.
// No APK compilation, source downloads or guessed transitive versions.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report=path.join(root,'app/build/reports/license-runtime-artifacts.json');
const output=path.join(root,'third_party/android/runtime-dependencies.json');
const cache=path.join(process.env.GRADLE_USER_HOME||path.join(os.homedir(),'.gradle'),
  'caches/modules-2/files-2.1');
const checking=process.argv.includes('--check');

if(!existsSync(report))throw Error('Missing Android release runtime report. Run gradle -I scripts/android-runtime-artifacts.gradle :app:exportLicenseRuntimeArtifacts.');
const artifacts=JSON.parse(readFileSync(report,'utf8'));
if(!Array.isArray(artifacts)||!artifacts.length)throw Error('Empty Android runtime classpath');

function element(xml,tag){
  return xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim()||'';
}
function decodeXml(text){return text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
function pomFor({group,name,version}){
  const dir=path.join(cache,group,name,version);
  if(!existsSync(dir))throw Error('Missing Gradle metadata: '+[group,name,version].join(':'));
  const files=readdirSync(dir).flatMap(hash=>{
    const sub=path.join(dir,hash);
    return existsSync(sub)?readdirSync(sub).filter(x=>x.endsWith('.pom')).map(x=>path.join(sub,x)):[];
  });
  if(files.length!==1)throw Error(`Expected one POM for ${group}:${name}:${version}, got ${files.length}`);
  return readFileSync(files[0],'utf8');
}
function sourceUrl({group,name,version}){
  const host=group.startsWith('androidx.')||group.startsWith('com.google.android.')?
    'https://dl.google.com/dl/android/maven2':'https://repo.maven.apache.org/maven2';
  return `${host}/${group.replaceAll('.','/')}/${name}/${version}/${name}-${version}.pom`;
}
const seen=new Map();
for(const artifact of artifacts){
  const {group,name,version,type}=artifact;
  if(!group||!name||!version||!['aar','jar'].includes(type))throw Error('Bad resolved Gradle artifact');
  const id=`${group}:${name}:${version}`;
  if(seen.has(id))continue; // Gradle may return multiple variants of one module.
  const pom=pomFor(artifact),block=element(pom,'licenses');
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
      group.startsWith('org.jetbrains.')?'JetBrains s.r.o.':'Upstream project contributors');
  const termsUrl=sdk?licenses[0].url:
    guavaPlaceholder?'https://github.com/google/guava/blob/master/COPYING':licenses[0].url;
  if(!termsUrl?.startsWith('https://')&&!termsUrl?.startsWith('http://'))throw Error('Missing upstream license URL for '+id);
  seen.set(id,{name:`${group}:${name}`,version,type,spdx,author,
    license_url:termsUrl,source_pom:sourceUrl(artifact),
    license_file:sdk?null:'third_party/pdfjs/LICENSE',
    note:sdk?'Proprietary Google Android SDK terms (not an OSI-approved open-source license).':
      guavaPlaceholder?'Google Guava listenablefuture 1.0 empty compatibility artifact; POM omits license metadata. Apache-2.0 per upstream Guava.':''});
}
const rows=[...seen.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
const result=JSON.stringify({generated_from:'Gradle :app:releaseRuntimeClasspath',modules:rows},null,2)+'\n';
if(checking){
  if(!existsSync(output)||readFileSync(output,'utf8')!==result){
    console.error('Android runtime license manifest is stale. Run node scripts/generate-android-license-manifest.mjs.');
    process.exitCode=1;
  }else console.log(`Android runtime manifest current (${rows.length} unique modules).`);
}else{
  writeFileSync(output,result);
  console.log(`Generated Android runtime manifest (${rows.length} unique modules).`);
}
