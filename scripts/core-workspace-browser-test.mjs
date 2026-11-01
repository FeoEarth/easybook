import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {env,sql,a,req} from './core-workspace-release-test.mjs';
import worker from '../worker/index.mjs';
import {hash} from '../worker/mcp-common.mjs';
import {createHash} from 'node:crypto';
class DigestStream extends WritableStream{constructor(){const h=createHash('sha256');let resolve;const digest=new Promise(r=>resolve=r);super({write(b){h.update(b)},close(){resolve(h.digest())}});this.digest=digest}}
Object.defineProperty(crypto,'DigestStream',{value:DigestStream,configurable:true});
const objects=new Map();env.ATTACHMENTS={async put(k,data,o={}){if(o.onlyIf&&objects.has(k))return null;objects.set(k,{blob:new Blob([data]),customMetadata:o.customMetadata});return {}},async head(k){const o=objects.get(k);return o?{size:o.blob.size,customMetadata:o.customMetadata}:null},async get(k){const o=objects.get(k);return o?{size:o.blob.size,customMetadata:o.customMetadata,body:o.blob.stream(),arrayBuffer:()=>o.blob.arrayBuffer(),json:async()=>JSON.parse(await o.blob.text())}:null},async delete(k){objects.delete(k)}};
const origin='https://easybook.loonxy.com';
// Serialize the synthetic D1 transaction adapter across simultaneous browser requests.
const batch=env.DB.batch.bind(env.DB);let tail=Promise.resolve();env.DB.batch=statements=>{const result=tail.then(()=>batch(statements));tail=result.catch(()=>{});return result};
const browser=await chromium.launch({headless:true});
const errors=[];
let contextSerial=0;async function context(){const ip='203.0.113.'+(++contextSerial);const c=await browser.newContext({serviceWorkers:'block'});await c.addInitScript(()=>{let options;window.turnstile={render(_container,value){options=value;return 1},execute(){queueMicrotask(()=>options.callback('verified'))},remove(){}}});await c.route('**/*',async route=>{const r=route.request();if(!r.url().startsWith(origin)){await route.abort();return}try{const response=await worker.fetch(new Request(r.url(),{method:r.method(),headers:{...await r.allHeaders(),'CF-Connecting-IP':ip},body:['GET','HEAD'].includes(r.method())?undefined:r.postDataBuffer()}),env);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})}catch(e){errors.push(String(e));await route.abort()}});return c}
async function ready(c){const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin);await p.getByRole('heading',{name:'全部备忘录',exact:true}).waitFor();return p}
async function settings(p,category='workspace'){if(await p.locator('#syncActivity').isVisible())await p.locator('#syncBack').click();if(!await p.locator('#settings').isVisible()){if(await p.locator('#foldersButton').isVisible())await p.locator('#foldersButton').click();await p.locator('#folderSettings').click()}const panel=p.locator('#settingsCategory-'+category);if(!await panel.isVisible()){if(!await p.locator('#settingsHome').isVisible())await p.locator('#foldersButton').click();await p.locator('[data-settings-category="'+category+'"]').click()}await panel.waitFor({state:'visible'});if(category==='workspace')await p.locator('#workspacePanel').waitFor({state:'visible'})}
async function readKey(p){await settings(p,'sync');await p.locator('#pairButton').click();await p.locator('#pairDialog').waitFor({state:'visible'});const key=await p.locator('#pairKey').inputValue();await p.locator('[data-close=pairDialog]').click();return key}
async function leaveSettings(p){if(!await p.locator('#settingsHome').isVisible())await p.locator('#foldersButton').click();await p.locator('#foldersButton').click();await p.locator('#folders').waitFor({state:'visible'})}
try{
 const c1=await context(),p1=await ready(c1);assert.equal(await p1.locator('#folders').isVisible(),true,'tablet home keeps the folder sidebar visible');assert.equal(await p1.locator('#home').isVisible(),true,'tablet home keeps the notes visible');const k=await readKey(p1);assert.equal(await p1.evaluate(()=>localStorage.getItem('easybook-key')),null,'no plaintext active credential');await leaveSettings(p1);await p1.locator('[data-tab=all]').click();await p1.waitForTimeout(800);
 await p1.getByRole('button',{name:'新建笔记',exact:true}).click();await p1.locator('#title').fill('匿名跨设备验收');await p1.locator('#title').dispatchEvent('input');
 await p1.locator('#attachmentButton').click();await p1.locator('[data-content-action=media]').click();await p1.locator('#mediaFile').setInputFiles({name:'acceptance.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1cAAAAASUVORK5CYII=','base64')});await p1.locator('[data-type=image] img').waitFor();await p1.waitForTimeout(800);await p1.evaluate(()=>window.persistNow());
 await p1.locator('#back').click();await settings(p1,'sync');await p1.locator('#activityEntry').click();await p1.locator('#syncNow').click();await p1.waitForTimeout(2000);
 const c2=await context();await c2.addInitScript(value=>localStorage.setItem('easybook-key',value),k);const p2=await ready(c2);await p2.getByText('匿名跨设备验收',{exact:true}).waitFor({timeout:20000});await p2.getByText('匿名跨设备验收',{exact:true}).click();await p2.waitForFunction(()=>document.querySelector('[data-type=image] img')?.src.startsWith('blob:'));assert.ok(objects.size>=2,'real chunk and manifest uploaded');
 // Signed-out users can switch among personal workspaces stored on this device.
 await settings(p1);await p1.locator('#workspaceCreate').click();
 await p1.locator('#workspaceName').fill('第二个本地工作区');
 await Promise.all([p1.waitForEvent('load'),p1.locator('#workspaceNameSave').click()]);
 await settings(p1);await p1.locator('#workspaceList [aria-current=true]').getByText('第二个本地工作区',{exact:true}).waitFor();
 await leaveSettings(p1);await p1.locator('[data-tab=all]').click();
 await p1.locator('#workspaceHome').click();
 await p1.locator('#workspaceSwitchList button').filter({hasText:'我的工作区'}).waitFor({state:'visible'});
 await Promise.all([p1.waitForEvent('load'),p1.locator('#workspaceSwitchList button').filter({hasText:'我的工作区'}).click()]);
 await p1.locator('#cards').getByText('匿名跨设备验收',{exact:true}).waitFor();

 // Account cookie is seeded only in this isolated fixture; production login remains real OAuth/Passkey.
 const cookie='e'.repeat(64),sid=crypto.randomUUID(),now=Date.now();sql.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?,NULL)').run(sid,await hash(cookie),a.id,now,now+86400000,now,'Synthetic browser');
 const ca=await context();await ca.addCookies([{name:'__Host-easybook-session',value:cookie,domain:'easybook.loonxy.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);const pa=await ready(ca);await settings(pa);
 // Create and rename have distinct, explicit editor states.
 await pa.locator('#workspaceCreate').click();await pa.locator('#workspaceNameEditor').waitFor({state:'visible'});
 assert.equal(await pa.locator('#workspaceEditorTitle').innerText(),'新工作区名称');
 await pa.locator('#workspaceName').fill('浏览器工作区');
 await Promise.all([pa.waitForEvent('load'),pa.locator('#workspaceNameSave').click()]);await settings(pa);
 await pa.locator('#workspaceList [aria-current=true]').getByText('浏览器工作区',{exact:true}).waitFor();
 await pa.locator('#workspaceRename').click();assert.equal(await pa.locator('#workspaceName').inputValue(),'浏览器工作区');
 await pa.locator('#workspaceName').fill('我的主工作区');await pa.locator('#workspaceNameSave').click();
 await pa.locator('#workspaceList [aria-current=true]').getByText('我的主工作区',{exact:true}).waitFor();
 await pa.locator('#workspaceCreate').click();await pa.locator('#workspaceName').fill('其他工作区');
 await Promise.all([pa.waitForEvent('load'),pa.locator('#workspaceNameSave').click()]);await settings(pa);
 await pa.locator('#workspaceList [aria-current=true]').getByText('其他工作区',{exact:true}).waitFor();
 // Rotate an anonymous/key-backed workspace before switching to account-only access.
 const old=await readKey(pa);
 await settings(pa);
 await pa.locator('#workspaceRotate').click();await pa.locator('#confirmAccept').click();
 await pa.waitForTimeout(1500);const fresh=await readKey(pa);assert.notEqual(fresh,old);
 assert.equal((await req('/api/notes?cursor=0',{headers:{Authorization:'Bearer '+old}})).status,401);
 // Quick switch on the home page, with no internal workspace ID shown to users.
 await leaveSettings(pa);await pa.locator('[data-tab=all]').click();
 await pa.locator('#workspaceHome').waitFor({state:'visible'});await pa.locator('#workspaceHome').click();
 await pa.locator('#workspaceSwitchDialog').waitFor({state:'visible'});
 assert.equal(await pa.locator('#workspaceSwitchList [aria-current=true]').count(),1);
 await Promise.all([pa.waitForEvent('load'),pa.locator('#workspaceSwitchList button').filter({hasText:'我的主工作区'}).click()]);
 await settings(pa);
 await pa.locator('#workspaceList [aria-current=true]').getByText('我的主工作区',{exact:true}).waitFor();
 // An account-linked PERSONAL workspace still exposes a key that is present on this device.
 const firstPersonalKey=await readKey(pa);
 assert.match(firstPersonalKey,/^[a-f0-9]{64}$/);
 assert.notEqual(firstPersonalKey,fresh,'switching must not mix workspace credentials');
 const firstIdentity=await req('/api/workspaces',{headers:{Authorization:'Bearer '+firstPersonalKey}});
 assert.equal(firstIdentity.status,200,'existing personal key remains usable after account switch');
 assert.equal((await firstIdentity.json()).workspaces[0].name,'我的主工作区');
 assert.deepEqual(errors,[]);console.log('PASS browser: anonymous two-device sync; workspace create, rename, home quick-switch and isolation; key rotation and no runtime errors.');
}finally{await browser.close()}
