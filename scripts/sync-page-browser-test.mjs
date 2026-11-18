import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const server=createServer((req,res)=>{const js=req.url==='/editor.js';res.setHeader('Content-Type',js?'application/javascript':'text/html');res.end(readFileSync(js?'app/src/main/assets/editor.js':'app/src/main/assets/index.html'))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.EASYBOOK_CHROMIUM_PATH?{executablePath:process.env.EASYBOOK_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--no-zygote','--single-process']});
try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('https://easybook-sync.1902521952.workers.dev/**',route=>route.abort());await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.easybookRich);await page.evaluate(()=>{document.getElementById('foldersButton').click();document.getElementById('folderSettings').click();document.querySelector('[data-settings-category="sync"]').click();document.getElementById('activityEntry').click();const a=window.easybookActivity;a.tasks=[];a.set('running','旅行照片.jpg','image','up','running',{loaded:25,total:100});a.set('waiting','待传笔记','note','up','queued');a.set('failure','文件.pdf','attachment','down','failed');a.set('done','本周计划','note','up','done',{loaded:100,total:100});a.success()});await page.waitForTimeout(350);
 for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('[data-task-id=done] progress').count(),0);assert.equal(await page.locator('#syncActivity .sync-nav').evaluate(el=>getComputedStyle(el).position),'sticky');const colors=await page.locator('#syncActivity').evaluate(el=>({tint:getComputedStyle(el).getPropertyValue('--sync-tint').trim(),paper:getComputedStyle(el).getPropertyValue('--paper').trim(),accent:getComputedStyle(el).getPropertyValue('--accent').trim()}));assert.equal(colors.tint,colors.accent);assert.ok(colors.paper)}}
 await page.setViewportSize({width:390,height:640});await page.evaluate(()=>scrollTo(0,500));assert.ok(await page.evaluate(()=>scrollY>0));assert.ok(Math.abs(await page.locator('#syncActivity .sync-nav').evaluate(el=>el.getBoundingClientRect().top))<1);await page.goBack();await page.waitForFunction(()=>document.body.dataset.page==='settings');await page.goForward();await page.waitForFunction(()=>document.body.dataset.page==='sync');
 const filter=page.locator('[data-sync-select=syncHistoryFilter]');
 await filter.click();
 const options=page.locator('#syncChoiceDialog [data-sync-option]');
 assert.equal(await options.first().evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('End');
 assert.equal(await options.last().evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Enter');
 assert.equal(await page.locator('#syncHistoryFilter').inputValue(),'failed');
 await filter.click();
 assert.equal(await options.last().getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Escape');
 assert.equal(await filter.evaluate(el=>el===document.activeElement),true);
 await page.locator('#syncHistoryEdit').click();
 await page.evaluate(()=>window.handleBack());
 assert.equal(await page.locator('#syncSelectionBar').isVisible(),false);
 assert.equal(await page.locator('#syncActivity').isVisible(),true);
 assert.equal(await page.locator('#syncHistoryEdit').evaluate(el=>el===document.activeElement),true);
 assert.equal((await page.locator('#attachmentCompression').boundingBox()).height>=44,true);
 await page.locator('#syncBack').click();
 await page.locator('#settingsCategory-sync').waitFor({state:'visible'});
 assert.equal(await page.locator('#activityEntry').evaluate(el=>el===document.activeElement),true);
 await page.evaluate(()=>window.handleBack());
 await page.locator('#settingsHome').waitFor({state:'visible'});
 assert.equal(await page.locator('#navigation').isVisible(),false);
 const header=await page.locator('.topbar').evaluate(el=>({
  background:getComputedStyle(el).backgroundColor,
  pageBackground:getComputedStyle(document.body).backgroundColor,
  blur:getComputedStyle(el).backdropFilter
 }));
 assert.equal(header.background,header.pageBackground,'settings navigation blends into the page');
 assert.equal(header.blur,'none','only the back button carries glass material');
 assert.equal(await page.locator('[data-settings-category=sync]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-settings-category=performance]').click();
 const performance=page.locator('#fastMode');
 const marker=await page.evaluate(()=>window.performance.timeOrigin);
 await performance.click();
 assert.equal(await performance.getAttribute('aria-checked'),'true');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.glass),'reduced');
 assert.equal(await page.evaluate(()=>localStorage.getItem('easybook-fast-mode')),'true');
 assert.equal(await page.evaluate(()=>window.performance.timeOrigin),marker);
 await performance.click();
 assert.equal(await performance.getAttribute('aria-checked'),'false');
 console.log('PASS Chromium: 320/390/1024px, light/dark, no horizontal overflow/modal/completed progress, sticky navigation, keyboard choices, selection back, and live performance mode');
}finally{await browser.close();server.close()}
