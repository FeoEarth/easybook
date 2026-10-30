import assert from 'node:assert/strict';
import {verifyWorkspaceCreation,turnstileConfig} from '../worker/turnstile.mjs';

const request=new Request('https://easybook.loonxy.com/api/workspaces',{headers:{'CF-Connecting-IP':'203.0.113.9'}});
const base={TURNSTILE_SECRET:'secret',TURNSTILE_HOSTNAMES:'easybook.loonxy.com'};
const verify=result=>({fetch:async(url,init)=>{assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');const body=new URLSearchParams(init.body);assert.equal(body.get('secret'),'secret');assert.equal(body.get('remoteip'),'203.0.113.9');return Response.json(result)}});

await verifyWorkspaceCreation(request,{...base,TURNSTILE_VERIFY:verify({success:true,action:'create_workspace',hostname:'easybook.loonxy.com'})},'token');
for(const result of [
 {success:false,action:'create_workspace',hostname:'easybook.loonxy.com'},
 {success:true,action:'login',hostname:'easybook.loonxy.com'},
 {success:true,action:'create_workspace',hostname:'evil.example'}
])await assert.rejects(()=>verifyWorkspaceCreation(request,{...base,TURNSTILE_VERIFY:verify(result)},'token'),error=>error.code==='turnstile_verification_failed'&&error.status===403);
await assert.rejects(()=>verifyWorkspaceCreation(request,base,''),error=>error.code==='turnstile_verification_failed');
await assert.rejects(()=>verifyWorkspaceCreation(request,{...base,TURNSTILE_VERIFY:{fetch:async()=>{throw Error('network')}}},'token'),error=>error.code==='turnstile_verification_failed');
assert.equal(turnstileConfig({TURNSTILE_SITE_KEY:'REPLACE_WITH_TURNSTILE_SITE_KEY'}).status,503);
assert.equal(turnstileConfig({TURNSTILE_SITE_KEY:'1x00000000000000000000AA'}).status,200);
console.log('PASS: Turnstile workspace gate validates token, action and hostname and fails closed.');
