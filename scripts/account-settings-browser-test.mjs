import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {chromium} from 'playwright';
const source=readFileSync('app/src/main/assets/index.html','utf8'),dom=new JSDOM(source),doc=dom.window.document;
const styles=[...doc.querySelectorAll('style')].map(s=>s.outerHTML).join(''),sprite=doc.querySelector('body>svg').outerHTML,section=doc.getElementById('accountSettings');section.hidden=false;
const refresh=source.slice(source.indexOf('async function refreshAccount()'),source.indexOf('function showAccountPage('));
const security=source.slice(source.indexOf("let securityBusy=false"),source.indexOf("$('accountGrants').onclick="));
const browser=await chromium.launch({headless:true});
try{
 const errors=[];
 for(const width of [360,430])for(const theme of ['light','dark']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:844});await page.setContent(`<html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body data-page="account">${sprite}<main class="app">${section.outerHTML}</main></body></html>`);
  await page.addScriptTag({content:`window.signedIn=false;window.fixtureAction='';const $=id=>document.getElementById(id);const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const native={async call(method,input={}){if(method==='account.status')return {signedIn:window.signedIn,busy:false,build:56,source:'272277f2'};if(method==='account.devices')return {account:{id:'e17cf571-5799-4541-b742-17d84c4fcb42',name:'我的 Easybook'},recently_authenticated:true,devices:[{id:'fixture-1',current:true,device:'Android · 此设备'},{id:'fixture-2',current:false,device:'Chrome · MacBook'}]};if(method==='account.manage'&&input.action==='approvals')return {approvals:[{id:'fixture',client_id:'示例 AI 客户端',workspace_id:'a'.repeat(64),tool:'notes_permanent_delete',status:'pending',expires_at:Date.now()+600000,payload:{items:[{id:'example-note',version:3}]}}]};if(method==='account.manage')return {grants:[],events:[],next_cursor:null};throw Error('Unexpected fixture request')}};${refresh}\n${security}\nwindow.paintAccount=refreshAccount;window.paintSecurity=securityViewLoad;`});
  await page.evaluate(()=>window.paintAccount());assert.equal(await page.locator('#accountNameRow').isVisible(),true);assert.equal(await page.locator('#mcpPairEntry').isVisible(),false);assert.equal(await page.locator('#accountBuild').isVisible(),false);
  await page.locator('.account-options>summary').click();assert.equal(await page.locator('#accountBrowserFallback').isVisible(),true);await page.locator('.account-options>summary').click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok((await page.locator('#accountBack').boundingBox()).height>=44);assert.equal(await page.locator('#accountSettings .row-text .chevron').count(),0);await page.screenshot({path:`account-settings-${width}-${theme}-signed-out.png`,fullPage:true});
  await page.evaluate(async()=>{window.signedIn=true;await window.paintAccount()});assert.equal(await page.locator('#accountNameRow').isVisible(),false);assert.equal(await page.locator('#accountIdentity').isVisible(),true);assert.equal(await page.locator('#accountRegisterText').innerText(),'添加通行密钥');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`account-settings-${width}-${theme}-signed-in.png`,fullPage:true});
  if(width===360){await page.evaluate(()=>window.paintSecurity('approvals'));await page.locator('#accountSecurityPanel').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const pre=await page.locator('#accountSecurityRows pre').boundingBox();assert.ok(pre.width<=width-40);await page.screenshot({path:`account-settings-${theme}-approval.png`,fullPage:true})}
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS account settings UI: signed-out/enrollment/device states; 360/430px light/dark layout; details navigation; no duplicate entry; approval parameter layout; 44px navigation target.');
}finally{await browser.close()}
