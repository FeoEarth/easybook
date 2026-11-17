import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {hooks} from './fixtures/ai-hub-harness.mjs';
const root=path.resolve('app/src/main/assets');
const html=readFileSync(path.join(root,'index.html'),'utf8').replace('})().catch(error=>',hooks+'\n})().catch(error=>');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(readFileSync(file))}catch{res.writeHead(404);res.end()}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const output='/tmp/easybook-ai-preview';mkdirSync(output,{recursive:true});
try{
 for(const [name,width,height]of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',locale:'zh-CN'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await context.addInitScript(()=>{localStorage.setItem('easybook-language','zh-CN');Object.defineProperty(navigator,'onLine',{get:()=>false})});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.aiHarness);await page.evaluate(()=>{window.aiHarness.setup();document.activeElement?.blur()});
  await page.screenshot({animations:'disabled',path:output+'/'+name+'-welcome.png'});
  assert.equal(await page.locator('#aiHub').evaluate(el=>el.scrollWidth>el.clientWidth),false,'No horizontal page overflow');
  const compact=await page.locator('#aiHubForm').boundingBox();assert.ok(compact.height<=64,'Original compact single-row composer');
  await page.locator('#aiHubPrompt').fill(Array.from({length:16},(_,i)=>'第 '+(i+1)+' 行：需要保留的多行草稿').join('\n'));
  const expanded=await page.locator('#aiHubPrompt').boundingBox();assert.ok(expanded.height>40&&expanded.height<=180,'Long draft expands within the scroll limit');
  await page.evaluate(()=>window.aiHarness.files([{name:'项目说明.md',type:'text',text:'附件草稿'}]));
  const tray=await page.locator('#aiHubAttachments').boundingBox(),inputBox=await page.locator('#aiHubForm').boundingBox();
  assert.ok(tray.y+tray.height<=inputBox.y+1,'Attachments remain above the original input shell');
  if(name==='mobile'){
   await page.screenshot({animations:'disabled',path:output+'/mobile-multiline.png'});
   await page.setViewportSize({width:320,height:568});
   const textBox=await page.locator('#aiHubPrompt').boundingBox(),sendBox=await page.locator('#aiHubSend').boundingBox();
   assert.ok(textBox.width>=100&&textBox.x+textBox.width<sendBox.x,'Narrow input keeps text and send button separate');
   assert.equal(await page.locator('#aiHub').evaluate(el=>el.scrollWidth>el.clientWidth),false);
   await page.setViewportSize({width,height});
  }
  await page.locator('#aiHubPrompt').fill('');await page.evaluate(()=>window.aiHarness.files([]));

  await page.evaluate(()=>{const app=window.aiHarness;app.session().mode='agent';document.activeElement?.blur();app.seed([
   {role:'user',content:'帮我整理本周的项目笔记，生成一份清晰的行动计划。'},
   {role:'assistant',content:'我已找到 **3 篇相关笔记**。本周的重点是完善 AI 对话体验，并完成发布前验证。\n\n### 建议的行动计划\n\n| 事项 | 下一步 |\n| --- | --- |\n| 对话体验 | 优化消息流与移动端输入 |\n| 上下文管理 | 保留任务要求及操作结果 |\n| 发布验证 | 完成回归与浏览器检查 |\n\n下面这份计划将保存为新笔记，请确认内容。',toolEvents:[{name:'notes_search',status:'done'},{name:'notes_get',status:'done'},{name:'notes_create',status:'approval'}]}
  ],{id:'visual-approval',tool:'notes_create',arguments:{title:'本周项目行动计划',text:'## 本周重点\n\n- [ ] 完善对话与 Agent 交互\n- [ ] 验证上下文管理\n- [ ] 完成发布前回归检查'},expiresAt:Date.now()+60000});});
  await page.locator('#aiHubLatest').evaluate(el=>{document.getElementById('aiHubMessages').scrollTop=document.getElementById('aiHubMessages').scrollHeight});
  await page.screenshot({animations:'disabled',path:output+'/'+name+'-agent.png'});
  const compose=await page.locator('#aiHubForm').boundingBox();assert.ok(compose.x>=0&&compose.x+compose.width<=width&&compose.y+compose.height<=height,'Composer stays in viewport');
  await page.evaluate(()=>window.aiHarness.theme('dark'));await page.screenshot({animations:'disabled',path:output+'/'+name+'-dark.png'});
  if(name==='mobile'){
   await page.locator('#aiHubSessions').click();await page.screenshot({animations:'disabled',path:output+'/mobile-history.png'});await page.locator('#aiSessionClose').click();
   await page.setViewportSize({width,height:480});assert.ok(await page.locator('#aiHubSend').isVisible(),'Composer survives short viewport / keyboard');
  }
  assert.deepEqual(errors,[],'No browser runtime errors');await context.close();
 }
 console.log('Desktop/mobile, dark mode, history and short viewport browser checks OK; previews: '+output);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
