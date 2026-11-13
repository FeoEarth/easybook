import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {serverDocument} from '../worker/server-client.mjs';
const html=readFileSync('app/src/main/assets/index.html','utf8').replace('name="easybook-identity" content="legacy"','name="easybook-identity" content="v2"');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const app='https://easybook.test',custom='https://notes.example',errors=[],probes=[];
try{
 const context=await browser.newContext({viewport:{width:420,height:900}});
 await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{value:false}));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===custom&&url.pathname==='/.well-known/easybook.json'){
   probes.push({headers:request.headers(),url:url.href});return route.fulfill({json:{protocolVersion:1,serverOrigin:custom,capabilities:{sync:true,keySync:true,accounts:true,webConnector:true,passkeys:true}},headers:{'Access-Control-Allow-Origin':'*'}});
  }
  if(url.origin!==app)return route.abort();
  if(url.pathname==='/editor.js')return route.fulfill({contentType:'text/javascript',body:readFileSync('app/src/main/assets/editor.js','utf8')});
  if(url.pathname.startsWith('/native-glass/'))return route.fulfill({contentType:'text/javascript',body:readFileSync('app/src/main/assets'+url.pathname,'utf8')});
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:serverDocument(html,url)});
  return route.fulfill({status:404,body:'Not found'});
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&message.text().includes('startup'))console.error(message.text())});
 const ready=async p=>p.waitForFunction(()=>window.easybookRich&&document.getElementById('serverEntry')?.onclick);
 const note=async(p,title)=>{await p.locator('#newTop').click();await p.locator('#title').fill(title);await p.evaluate(()=>easybookRich.editor.commands.insertContent('offline body'));await p.locator('#done').click();await p.evaluate(async()=>{persistNow();await new Promise(r=>setTimeout(r,100))})};
 const manager=async p=>{await p.evaluate(()=>document.getElementById('folderSettings').click());await p.locator('[data-settings-category="sync"]').click();await p.locator('#serverEntry').click();await p.locator('#serverList .server-row').first().waitFor()};
 await page.goto(app);await ready(page);await note(page,'Official note');await manager(page);
 await page.locator('#serverName').fill('My server');await page.locator('#serverOrigin').fill(custom);await page.locator('#serverAdd').click();
 await page.waitForURL('**/?server_origin=*');await ready(page);await page.waitForFunction(()=>document.getElementById('serverDialog')?.open);
 assert.match(await page.locator('#serverCurrentSummary').textContent(),/easybook.test/,'permission reload must not select an unknown origin');
 assert.equal(probes.length,0,'permission reload precedes network probing');
 await page.locator('#serverName').fill('My server');await page.locator('#serverAdd').click();await page.locator('.server-row').filter({hasText:'My server'}).waitFor();
 assert.equal(probes.length,1);assert.ok(!probes[0].headers.authorization&&!probes[0].headers.cookie,'discovery contains no credentials');
 await page.locator('.server-row').filter({hasText:'My server'}).locator('[data-server-use]').click();await ready(page);
 await page.waitForFunction(()=>document.getElementById('serverCurrentSummary')?.textContent.includes('My server'),null,{timeout:15000}).catch(async error=>{console.error(await page.locator('#serverStatus').textContent(),await page.locator('#toast').textContent(),page.url());throw error});
 assert.equal(await page.locator('#cards .note').count(),0,'custom server starts with independent notes');
 await note(page,'Custom note');await manager(page);await page.locator('#serverRestore').click();await ready(page);
 await page.waitForFunction(()=>document.getElementById('serverCurrentSummary')?.textContent.includes('easybook.test'));
 assert.equal(await page.locator('#cards .note').count(),1);assert.match(await page.locator('#cards').textContent(),/Official note/);
 await manager(page);await page.locator('.server-row').filter({hasText:'My server'}).locator('[data-server-remove]').click();await page.waitForFunction(()=>!document.getElementById('serverList').textContent.includes('My server'));
 await page.locator('#serverOrigin').fill(custom);await page.locator('#serverName').fill('Restored');await page.locator('#serverAdd').click();await page.locator('.server-row').filter({hasText:'Restored'}).waitFor();
 assert.equal(probes.length,1,'known profiles restore offline without probing');
 await page.locator('.server-row').filter({hasText:'Restored'}).locator('[data-server-use]').click();await ready(page);
 await page.waitForFunction(()=>document.getElementById('serverCurrentSummary')?.textContent.includes('Restored'));
 assert.equal(await page.locator('#cards .note').count(),1);assert.match(await page.locator('#cards').textContent(),/Custom note/);
 await manager(page);await page.locator('#serverClose').click();
 const second=await context.newPage();second.on('pageerror',error=>errors.push(error.message));await second.goto(page.url());await ready(second);
 await manager(page);await page.locator('#serverRestore').click();
 await Promise.all([page.waitForFunction(()=>document.getElementById('serverCurrentSummary')?.textContent.includes('easybook.test')),second.waitForFunction(()=>document.getElementById('serverCurrentSummary')?.textContent.includes('easybook.test'))]);
 assert.match(await second.locator('#cards').textContent(),/Official note/,'same-site tabs switch together');
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS server UI: permission reload, unauthenticated discovery, add/switch, note isolation, default restore, offline hidden-profile restore and coordinated real-browser tabs.');
}finally{await browser.close()}
