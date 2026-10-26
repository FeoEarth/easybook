import assert from 'node:assert/strict';
const origin=process.argv[2];if(!origin)throw Error('Pass OAuth release origin');
const metadata=await fetch(origin+'/.well-known/oauth-authorization-server');assert.equal(metadata.status,200);const data=await metadata.json();assert.ok(data.authorization_endpoint);assert.ok(data.token_endpoint);
const unauthenticated=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})});assert.equal(unauthenticated.status,401,'OAuth authentication must remain enforced');
const cors=await fetch(origin+'/pairing/complete',{method:'OPTIONS',headers:{Origin:'https://easybook.loonxy.com','Access-Control-Request-Method':'POST'}});assert.ok([204,410].includes(cors.status));if(cors.status===204)assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'https://easybook.loonxy.com');
const bad=await fetch(origin+'/pairing/complete',{method:'POST',headers:{Origin:'https://easybook.loonxy.com','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,cors.status===410?410:403);if(cors.status===204)assert.equal(bad.headers.get('Access-Control-Allow-Origin'),'https://easybook.loonxy.com');
console.log('PASS: OAuth discovery, enforced 401, pairing preflight and visible error CORS');

import {verifyMcpReadiness} from './release-readiness.mjs';
await verifyMcpReadiness(origin);

