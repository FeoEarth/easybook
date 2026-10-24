const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{value:false}));
 await page.route('https://easybook.test/**',r=>r.fulfill({contentType:r.request().url().endsWith('/editor.js')?'text/javascript':'text/html',body:fs.readFileSync(r.request().url().endsWith('/editor.js')?'app/src/main/assets/editor.js':'app/src/main/assets/index.html')}));
 await page.goto('https://easybook.test');await page.waitForFunction(()=>window.easybookRich);
 const bounds=async selector=>{const r=await page.locator(selector).boundingBox(),v=page.viewportSize();assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,selector+' stays in viewport '+JSON.stringify({r,v}))};
 for(const width of [320,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:640});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('#listMore').click();await page.waitForTimeout(260);await bounds('#listDialog');
  await page.locator('#listSortOpen').click();await page.waitForTimeout(260);await bounds('#listDialog');
  await page.evaluate(()=>handleBack());await page.waitForTimeout(200);
 }
 await page.setViewportSize({width:320,height:640});await page.locator('#newTop').click();await page.locator('#title').fill('材质检查');await page.waitForTimeout(280);
 await bounds('.editor-header');
 const nav=await page.locator('.editor-header').evaluate(e=>({w:e.scrollWidth,c:e.clientWidth}));assert.ok(nav.w<=nav.c);
 await page.locator('#formatButton').click();await page.waitForTimeout(260);await bounds('#formatDialog');
 await page.evaluate(()=>document.getElementById('formatDialog').close());await page.locator('#back').click();
 await page.locator('#listMore').click();await page.locator('#selectNotes').click();await page.locator('#selectAll').click();await bounds('#selectionHeader');await bounds('#batchbar');
 await page.locator('#batchMove').click();await page.waitForTimeout(300);await bounds('#moveDialog');await page.locator('#moveCancel').click();await page.waitForTimeout(300);await page.locator('#cancelSelection').click();
 await page.locator('#foldersButton').click();await page.locator('#createFolder').click();await bounds('#newFolderDialog');await page.locator('#folderName').fill('玻璃检查');await page.locator('#createFolderSubmit').click();
 const row=await page.locator('.folder-entry').first().evaluate(e=>({row:e.clientWidth,action:e.lastElementChild.getBoundingClientRect().width}));assert.ok(Math.abs(row.row-row.action)<2,'folder keeps its full-width touch target');
 await page.locator('#folderSettings').click();await page.waitForTimeout(280);await bounds('.topbar');
 await page.locator('#activityEntry').click();await page.waitForTimeout(280);await bounds('.sync-nav');
 await page.locator('#syncBack').click();await page.waitForTimeout(280);assert.equal(await page.locator('#settings').isVisible(),true);
 // One fallback contract across every material role, including generated notices.
 for(const mode of ['normal','reduced']){
  await page.evaluate(mode=>document.documentElement.dataset.glass=mode,mode);
  const values=await page.evaluate(()=>[...document.querySelectorAll('.ui-material,.glass')].map(e=>({id:e.id,blur:getComputedStyle(e).backdropFilter,fill:getComputedStyle(e).backgroundColor})));
  assert.ok(values.length>10);assert.ok(values.every(v=>v.blur===(mode==='reduced'?'none':'blur(24px) saturate(1.35)')),JSON.stringify(values));
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('#createFolder').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 assert.deepEqual(errors,[]);
 console.log('PASS scoped glass UI: light/dark 320/390 menus, editor, format panel, selection/move, folder creation/full-row touch target, shared reduced transparency and motion. No emulator or full regression.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
