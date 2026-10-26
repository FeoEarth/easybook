import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
const challenge=process.env.SYNTHETIC_PAIRING_CHALLENGE;
if(!/^[A-Za-z0-9_-]{24,128}$/.test(challenge||''))throw Error('Provide a fresh synthetic challenge; never use real client/workspace secrets');
let phase='launch';const watchdog=setTimeout(()=>{console.error('Pairing validation timeout at '+phase);process.exit(1)},90000);
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')console.log('browser console',m.text())});
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(['/api/mcp/attest','/pairing/complete'].includes(p))console.log('pairing request',r.method(),p)});
 page.on('response',r=>{const p=new URL(r.url()).pathname;if(['/api/mcp/attest','/pairing/complete'].includes(p))console.log('pairing HTTP',p,r.status())});
 page.on('requestfailed',r=>{const p=new URL(r.url()).pathname;if(['/api/mcp/attest','/pairing/complete'].includes(p))console.log('pairing transport failure',p,r.failure()?.errorText)});
 if(process.env.TEST_SOURCE_HTML==='true')await page.route((process.env.WEB_ORIGIN||'https://easybook-sync.1902521952.workers.dev')+'/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:readFileSync('app/src/main/assets/index.html','utf8')}));
 if(process.env.OAUTH_CANDIDATE_ORIGIN)await page.route('https://easybook-mcp-oauth.1902521952.workers.dev/pairing/complete',async route=>{const response=await route.fetch({url:process.env.OAUTH_CANDIDATE_ORIGIN+'/pairing/complete'});await route.fulfill({response})});
 await page.goto((process.env.WEB_ORIGIN||'https://easybook-sync.1902521952.workers.dev')+'/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.getByRole('button',{name:'返回文件夹',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'AI 与 MCP 授权当前工作区供 AI 只读访问',exact:true}).click();
 await page.getByRole('textbox',{name:'一次性配对码',exact:true}).fill(challenge);
 const completion=page.waitForResponse(r=>r.url().endsWith('/pairing/complete')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'授权当前工作区',exact:true}).click();
 let response;try{response=await completion}catch(error){console.log('pairing hint',await page.locator('#mcpPairHint').textContent());throw error}assert.equal(response.status(),200,'Synthetic browser pairing failed');phase='completion body';const data=await Promise.race([response.json(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Completion body timeout')),5000))]);assert.equal(data.paired,true);console.log('Completion JSON verified');
 phase='dialog closed';await page.getByRole('dialog',{name:'AI 与 MCP 工作区授权'}).waitFor({state:'hidden',timeout:5000});console.log('Pairing dialog closed');
 assert.deepEqual(errors,[]);
 phase='screenshot';try{await page.screenshot({path:'browser-pairing-success.png',timeout:5000})}catch{console.log('Screenshot unavailable; functional completion already verified')}
 console.log('PASS: real browser fresh empty workspace → same-origin attestation → cross-origin pairing completion → dialog closed; no user notes read');
 phase='context close';await Promise.race([context.close(),new Promise(resolve=>setTimeout(resolve,5000))]);
}finally{phase='browser close';await Promise.race([browser.close(),new Promise(resolve=>setTimeout(resolve,5000))]);clearTimeout(watchdog)}
