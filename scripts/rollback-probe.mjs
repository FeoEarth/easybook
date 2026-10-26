// Exercise the exact release rollback code against a binding-free synthetic Worker.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const worker='easybook-release-rollback-probe',base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
async function request(path,body,method=body?'POST':'GET') {const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok||!d.success)throw Error('Rollback probe API failed '+r.status);return d.result}
async function upload(status){const f=new FormData();f.set('metadata',JSON.stringify({main_module:'index.mjs',compatibility_date:'2026-10-23',bindings:[]}));f.set('index.mjs',new Blob([`export default {fetch(){return new Response('synthetic rollback probe',{status:${status}})}}`],{type:'application/javascript+module'}),'index.mjs');return request('',f,'PUT')}
await upload(200);
const baseline=(await request('/deployments')).deployments[0];
await upload(503);
const failed=(await request('/deployments')).deployments[0];
assert.notEqual(failed.versions[0].version_id,baseline.versions[0].version_id);
writeFileSync('release-state.json',JSON.stringify({worker,baseline,candidate:failed.versions[0].version_id,promotionStarted:true,sha:process.env.GITHUB_SHA||'probe'}));
execFileSync(process.execPath,['scripts/cloudflare-release.mjs','rollback','--probe'],{stdio:'inherit'});
assert.deepEqual((await request('/deployments')).deployments[0].versions,baseline.versions);
console.log('PASS: exact automatic rollback code restored synthetic Worker baseline through Cloudflare API; production and storage untouched');
