import assert from 'node:assert/strict';
import {verifyGithubIdentity,ALLOWED_GITHUB_USER_ID} from '../worker/mcp-github-identity.mjs';
const fake=(id,type='User')=>async()=>({ok:true,json:async()=>({id,type,login:'FeoEarth'})});
assert.equal((await verifyGithubIdentity('example',fake(ALLOWED_GITHUB_USER_ID))).githubUserId,ALLOWED_GITHUB_USER_ID);
await assert.rejects(()=>verifyGithubIdentity('example',fake(1)),/not authorized/);
await assert.rejects(()=>verifyGithubIdentity('example',fake(ALLOWED_GITHUB_USER_ID,'Organization')),/not authorized/);
await assert.rejects(()=>verifyGithubIdentity('',fake(ALLOWED_GITHUB_USER_ID)),/Invalid upstream token/);
console.log('GitHub identity gate checks passed');
