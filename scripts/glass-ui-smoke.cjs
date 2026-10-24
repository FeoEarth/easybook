const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{value:false});localStorage.setItem('easybook-glass','reduced');Object.defineProperty(navigator,'deviceMemory',{value:8})});
 await page.route('https://easybook.test/**',r=>r.fulfill({contentType:r.request().url().endsWith('/editor.js')?'text/javascript':'text/html',body:fs.readFileSync(r.request().url().endsWith('/editor.js')?'app/src/main/assets/editor.js':'app/src/main/assets/index.html')}));
 await page.goto('https://easybook.test');await page.waitForFunction(()=>window.easybookRich);
 assert.equal(await page.locator('#glassToggle,#glassValue').count(),0);assert.equal(await page.evaluate(()=>localStorage.getItem('easybook-glass')),null);assert.equal(await page.evaluate(()=>document.documentElement.dataset.glass),'normal');
 const bounds=async selector=>{await page.locator(selector).evaluate(async e=>{const animations=[];for(let n=e;n;n=n.parentElement)animations.push(...n.getAnimations());await Promise.all(animations.filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});const r=await page.locator(selector).boundingBox(),v=page.viewportSize();assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,selector+' stays in viewport '+JSON.stringify({r,v}))};
 for(const width of [320,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:640});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('#listMore').click();await page.waitForTimeout(260);await bounds('#listDialog');
  await page.locator('#listSortOpen').click();await page.waitForTimeout(260);await bounds('#listDialog');
  await page.evaluate(()=>handleBack());await page.waitForTimeout(200);
 }
 await page.setViewportSize({width:320,height:640});await page.locator('#newTop').click();await page.locator('#title').fill('材质检查');await page.waitForTimeout(280);
 await bounds('.editor-header');
 const nav=await page.locator('.editor-header').evaluate(e=>({w:e.scrollWidth,c:e.clientWidth}));assert.ok(nav.w<=nav.c);
 await page.locator('#formatButton').click();await page.waitForTimeout(260);
 for(const width of [320,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:640});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await bounds('#formatDialog');
  const controls=await page.locator('#formatDialog .format-row button').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})));
  assert.ok(controls.every(r=>r.w>=43.9&&r.h>=43.9),JSON.stringify({width,controls}));
  assert.equal(await page.locator('#formatDialog').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 }
 await page.setViewportSize({width:320,height:640});
 await page.evaluate(()=>document.getElementById('formatDialog').close());
 await page.locator('#moreButton').click();await page.locator('#findButton').click();await bounds('#findbar');
 const find=await page.evaluate(()=>({nav:document.querySelector('.editor-header').getBoundingClientRect().bottom,top:document.getElementById('findbar').getBoundingClientRect().top}));assert.ok(find.top>=find.nav-1);
 await page.locator('#findClose').click();
 // Layout-only preview fixture: a tall image and all Android action controls.
 for(const size of [{width:320,height:640},{width:640,height:320}]){
  await page.setViewportSize(size);
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=1800;const c=canvas.getContext('2d');c.fillStyle='#e9b900';c.fillRect(0,0,600,1800);const img=document.getElementById('attachmentPreview');img.hidden=false;img.src=canvas.toDataURL();await img.decode();document.getElementById('attachmentTitle').textContent='长附件名称 '.repeat(10);document.getElementById('attachmentInfo').textContent='预览布局检查';document.querySelectorAll('.preview-actions button').forEach(b=>b.hidden=false);document.getElementById('attachmentDialog').showModal()});
  await bounds('#attachmentDialog');await bounds('.preview-actions');
  const preview=await page.locator('#previewStage').boundingBox(),image=await page.locator('#attachmentPreview').boundingBox();assert.ok(preview&&image,JSON.stringify({size,preview,image}));assert.ok(image.height<=preview.height+1&&image.width<=preview.width+1);if(size.height===640)assert.ok(image.height>size.height*.5);
  await page.locator('[data-close=attachmentDialog]').click();await page.waitForFunction(()=>document.getElementById('attachmentPreview').hidden);
 }
 await page.setViewportSize({width:320,height:640});await page.locator('#back').click();
 await page.locator('#listMore').click();await page.locator('#selectNotes').click();await page.locator('#selectAll').click();await bounds('#selectionHeader');await bounds('#batchbar');
 await page.locator('#batchMove').click();await page.waitForTimeout(300);await bounds('#moveDialog');await page.locator('#moveCancel').click();await page.waitForTimeout(300);await page.locator('#cancelSelection').click();
 await page.locator('#foldersButton').click();await page.locator('#createFolder').click();await bounds('#newFolderDialog');await page.locator('#folderName').fill('玻璃检查');await page.locator('#createFolderSubmit').click();
 const row=await page.locator('.folder-entry').first().evaluate(e=>({row:e.clientWidth,action:e.lastElementChild.getBoundingClientRect().width}));assert.ok(Math.abs(row.row-row.action)<2,'folder keeps its full-width touch target');
 await page.locator('#createFolder').click();await page.locator('#folderName').fill('归档');await page.locator('#createFolderSubmit').click();
 assert.equal(await page.locator('.folder-entry .folder-row').first().evaluate(e=>getComputedStyle(e,'::after').content),'""');
 await page.locator('#folderSettings').click();await page.waitForTimeout(280);await bounds('.topbar');
 await page.locator('#activityEntry').click();await page.waitForTimeout(280);await bounds('.sync-nav');
 await page.locator('#syncBack').click();await page.waitForTimeout(280);assert.equal(await page.locator('#settings').isVisible(),true);
 // System-level transparency reduction must also win over dark theme tokens.
 const cdp=await page.context().newCDPSession(page);
 for(const theme of ['light','dark']){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.dataset.glass='normal'},theme);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches),true);
  const material=await page.locator('#listDialog').evaluate(e=>({blur:getComputedStyle(e).backdropFilter,fill:getComputedStyle(e).backgroundColor,paper:getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()}));
  assert.equal(material.blur,'none');assert.ok(!material.fill.startsWith('rgba('),JSON.stringify(material));
 }
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 // One fallback contract across every material role, including generated notices.
 for(const mode of ['normal','reduced']){
  await page.evaluate(mode=>document.documentElement.dataset.glass=mode,mode);
  const values=await page.evaluate(()=>[...document.querySelectorAll('.ui-material,.glass')].map(e=>({id:e.id,blur:getComputedStyle(e).backdropFilter,fill:getComputedStyle(e).backgroundColor})));
  assert.ok(values.length>10);assert.ok(values.every(v=>v.blur===(mode==='reduced'?'none':'blur(24px) saturate(1.35)')),JSON.stringify(values));
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('#createFolder').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
 assert.deepEqual(errors,[]);
 console.log('PASS scoped glass UI: light/dark 320/390 menus, editor, format panel, selection/move, folder creation/full-row touch target, 44px format controls, findbar alignment, portrait/landscape preview, folder separators, shared reduced transparency and motion. No emulator or full regression.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
