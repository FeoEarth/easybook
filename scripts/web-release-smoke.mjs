import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin=process.argv[2];
if(!origin)throw Error('Pass the exact release origin');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'});
 // A fresh, random synthetic workspace. Never attach to user browser data.
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url()===origin+'/editor.js'&&r.status()!==200)errors.push('editor HTTP '+r.status())});
 const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:45000});
 assert.equal(response.status(),200);
 await page.getByRole('heading',{name:'全部备忘录',exact:true}).waitFor();
 await page.getByRole('button',{name:'列表更多操作',exact:true}).click();
 await page.getByRole('menuitem',{name:'选择备忘录',exact:true}).waitFor();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'新建笔记',exact:true}).click();
 await page.getByRole('textbox',{name:'笔记正文',exact:true}).waitFor();
 assert.deepEqual(errors,[],'Browser runtime errors');
 const health=await context.request.get(origin+'/health');assert.equal(health.status(),200);assert.equal((await health.json()).ok,true);
 await page.screenshot({path:'web-release-smoke.png'});
 console.log('PASS: HTML, editor load, list menu, new editor, health; no user notes read');
 await context.close();
}finally{await browser.close()}

import {verifyMcpReadiness} from './release-readiness.mjs';
await verifyMcpReadiness(origin);
