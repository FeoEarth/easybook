import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const origin='https://easybook-sync.1902521952.workers.dev';
const key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const dir=mkdtempSync(join(tmpdir(),'easybook-cross-')),fixturePath=join(dir,'cross-client.json');
const deviceDir='/sdcard/Android/data/com.feoearth.easybook.notes/files';
function adb(...args){const r=spawnSync('adb',args,{encoding:'utf8',timeout:180000});if(r.status!==0)throw Error('adb operation failed: '+r.stderr);return r.stdout}
function native(phase){const output=adb('shell','am','instrument','-w','-e','crossPhase',phase,'com.feoearth.easybook.notes.test/com.feoearth.easybook.PhaseTwoInstrumentation');assert.ok(output.includes('passed=true'),'native phase '+phase+' failed: '+output);console.log('PASS cross-client native phase: '+phase)}
async function api(path,data){const r=await fetch(origin+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json()}
async function remote(){return [...new Map((await api('/api/notes?cursor=0')).notes.map(n=>[n.id,n])).values()]}
async function until(fn,label){const deadline=Date.now()+45000;while(Date.now()<deadline){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,500))}throw Error('Timeout: '+label)}
const browser=await chromium.launch({headless:true});const page=await browser.newPage();
async function webSnapshot(){return page.evaluate(async()=>{const s=new EasybookWebStore(indexedDB);await s.open();try{return await s.load(localStorage.getItem('easybook-key'))}finally{s.db.close()}})}
async function syncWeb(){await page.evaluate(()=>document.getElementById('syncButton').click())}
try{
 await page.addInitScript(k=>localStorage.setItem('easybook-key',k),key);await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.easybookRich);
 await page.locator('#newTop').click();await page.locator('#title').fill('Chromium ↔ Android integration');await page.locator('#richEditor .ProseMirror').fill('Chromium origin');await page.locator('#done').click();
 const initial=await until(async()=>{const ns=await remote();return ns.find(n=>JSON.stringify(n.document).includes('Chromium origin'))},'browser note uploaded');const id=initial.id;
 writeFileSync(fixturePath,JSON.stringify({key,id}));adb('shell','mkdir','-p',deviceDir);adb('push',fixturePath,deviceDir+'/cross-client.json');
 native('edit');await syncWeb();await until(async()=>{const n=(await webSnapshot()).notes.find(n=>n.id===id);return n?.pinned===1&&JSON.stringify(n.document).includes('Android online')},'native edit and pin persisted in browser IndexedDB');
 assert.ok(await page.evaluate(()=>RichNotes.plain(easybookRich.value()).includes('Android online')),'active browser editor refreshed from Android');
 native('offline');
 await page.locator('#richEditor .ProseMirror').press('Control+End');await page.keyboard.insertText('\nChromium concurrent');await page.locator('#done').click();await until(async()=>{const n=(await remote()).find(n=>n.id===id);return n&&JSON.stringify(n.document).includes('Chromium concurrent')},'concurrent browser edit uploaded');
 native('retry');await syncWeb();await until(async()=>{const ns=(await webSnapshot()).notes;return ns.some(n=>JSON.stringify(n.document).includes('Android offline survives restart'))&&ns.some(n=>JSON.stringify(n.document).includes('Chromium concurrent'))},'browser received both conflict versions');
 native('lostAck');await syncWeb();await until(async()=>{const n=(await webSnapshot()).notes.find(n=>n.id===id);return n&&JSON.stringify(n.document).includes('Android lost acknowledgement')},'replayed native mutation reached browser');
 native('delete');await syncWeb();await until(async()=>{const n=(await webSnapshot()).notes.find(n=>n.id===id);return n?.deleted===1},'native tombstone persisted in browser');
 console.log('PASS Chromium app ↔ Android native ↔ deployed Worker/D1: both directions, pin parity, offline persistence across process restart, explicit concurrent-edit conflict copies, lost-ack replay without double version increment and deletion feed.');
}catch(e){mkdirSync('smoke',{recursive:true});await page.screenshot({path:'smoke/cross-client-failure.png',fullPage:true}).catch(()=>{});throw e}
finally{
 // Logical tombstones only, restricted to the random workspace created by this test.
 try{for(const n of await remote())if(!n.deleted)await api('/api/notes/'+n.id,{...n,deleted:1,mutation:crypto.randomUUID()})}catch{}
 try{native('cleanup');adb('shell','rm','-f',deviceDir+'/cross-client.json')}catch{}
 await browser.close();rmSync(dir,{recursive:true,force:true});
}
