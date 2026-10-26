import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const challenge=process.env.SYNTHETIC_PAIRING_CHALLENGE;
if(!/^[A-Za-z0-9_-]{24,128}$/.test(challenge||''))throw Error('Provide a fresh synthetic challenge; never use real client/workspace secrets');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://easybook.loonxy.com/',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'返回文件夹',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'AI 与 MCP 授权当前工作区供 AI 只读访问',exact:true}).click();
 await page.getByRole('textbox',{name:'一次性配对码',exact:true}).fill(challenge);
 const completion=page.waitForResponse(r=>r.url().endsWith('/pairing/complete')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'授权当前工作区',exact:true}).click();
 const response=await completion;assert.equal(response.status(),200,'Synthetic browser pairing failed');assert.equal((await response.json()).paired,true);
 await page.getByRole('dialog',{name:'AI 与 MCP 工作区授权'}).waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'browser-pairing-success.png'});
 console.log('PASS: real browser fresh empty workspace → same-origin attestation → cross-origin pairing completion → dialog closed; no user notes read');
 await context.close();
}finally{await browser.close()}
