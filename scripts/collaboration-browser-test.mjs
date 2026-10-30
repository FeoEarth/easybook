import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {env,sql,a,b} from './core-workspace-release-test.mjs';
import worker from '../worker/index.mjs';
import {hash} from '../worker/mcp-common.mjs';
const origin='https://easybook.loonxy.com',token='5'.repeat(64),sid=crypto.randomUUID(),now=Date.now();
sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(sid,await hash(token),a.id,now,now+86400000,now,'Synthetic browser');
let tail=Promise.resolve();const batch=env.DB.batch.bind(env.DB);env.DB.batch=ss=>{const out=tail.then(()=>batch(ss));tail=out.catch(()=>{});return out};
const browser=await chromium.launch({headless:true}),errors=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await context.addCookies([{name:'__Host-easybook-session',value:token,domain:'easybook.loonxy.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
 await context.route('**/*',async route=>{const r=route.request();if(!r.url().startsWith(origin)){await route.abort();return}try{const response=await worker.fetch(new Request(r.url(),{method:r.method(),headers:{...await r.allHeaders(),'CF-Connecting-IP':'203.0.113.55'},body:['GET','HEAD'].includes(r.method())?undefined:r.postDataBuffer()}),env);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})}catch(e){errors.push(String(e));await route.abort()}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('heading',{name:'全部备忘录',exact:true}).waitFor();
 async function settings(category='workspace'){if(!await page.locator('#settings').isVisible()){await page.locator('#foldersButton').click();await page.locator('#folderSettings').click()}const panel=page.locator('#settingsCategory-'+category);if(!await panel.isVisible()){if(!await page.locator('#settingsHome').isVisible())await page.locator('#foldersButton').click();await page.locator('[data-settings-category="'+category+'"]').click()}await panel.waitFor({state:'visible'});if(category==='workspace')await page.locator('#workspacePanel').waitFor({state:'visible'})}
 await settings();await page.locator('#workspaceCreate').click();await page.locator('#workspaceNameEditor').waitFor({state:'visible'});await page.locator('#workspaceName').fill('共享界面验收');const [created]=await Promise.all([page.waitForResponse(response=>response.url()===origin+'/api/workspaces'&&response.request().method()==='POST'),page.locator('#workspaceNameSave').click()]);assert.equal(created.status(),201,await created.text());await page.waitForLoadState('load');await page.getByRole('heading',{name:'全部备忘录',exact:true}).waitFor();await settings();await page.locator('#workspaceList [aria-current=true]').getByText('共享界面验收',{exact:true}).waitFor();
 await page.locator('#workspaceMembersOpen').click();await page.locator('#workspaceMemberSummary').filter({hasText:'manager'}).waitFor();
 await page.locator('#workspaceMemberId').fill(b.id);await page.locator('#workspaceMemberRole').selectOption('reader');await page.locator('#workspaceShare').click();await page.locator('#confirmAccept').click();
 await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(500);await settings('sync');
 // Shared workspaces never reveal a sync key, even if this device once owned a personal key.
 await page.locator('#pairButton').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('#pairDialog').isVisible(),false,'shared workspace key must stay hidden');
 await settings();
 await page.locator('#workspaceMembersOpen').click();await page.getByText(b.id+' · reader',{exact:true}).waitFor();
 await page.locator('#workspaceMemberId').fill(b.id);await page.locator('#workspaceMemberRole').selectOption('editor');await page.locator('#workspaceMemberSave').click();await page.getByText(b.id+' · editor',{exact:true}).waitFor();
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'phase-two-members-'+theme+'.png',fullPage:true})}
 await page.locator('#workspaceManagerTransfer').click();await page.locator('#confirmAccept').click();await page.waitForFunction(()=>document.querySelector('#workspaceManagerControls').hidden);assert.equal(await page.locator('#workspaceLeave').isVisible(),true);
 await page.locator('#workspaceLeave').click();await page.locator('#confirmAccept').click();await page.waitForFunction(()=>document.querySelector('#workspaceMembersPanel').hidden);
 const w=sql.prepare("SELECT id FROM workspaces WHERE name='共享界面验收'").get();assert.equal(sql.prepare('SELECT manager_account_id FROM workspaces WHERE id=?').get(w.id).manager_account_id,b.id);assert.equal(sql.prepare('SELECT 1 FROM workspace_members WHERE workspace_id=? AND account_id=?').get(w.id,a.id),undefined);
 assert.deepEqual(errors,[]);console.log('PASS browser collaboration: account workspace, member listing, explicit conversion, role change, manager transfer, member exit, light/dark mobile layout.');
}finally{await browser.close()}
