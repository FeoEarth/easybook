// Non-mutating cross-Worker verification: an unknown random challenge must pass
// HMAC verification and reach the expired/unknown challenge rejection (409).
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const origin=process.argv[2];if(!origin)throw Error('Pass candidate origin');
const challenge=randomBytes(32).toString('base64url'),key=randomBytes(32).toString('hex');
const headers={Origin:'https://easybook.loonxy.com','Content-Type':'application/json'};
const preflight=await fetch(origin+'/api/mcp/attest',{method:'OPTIONS',headers:{Origin:headers.Origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(preflight.status,204);
const proof=await fetch(origin+'/api/mcp/attest',{method:'POST',headers:{...headers,Authorization:'Bearer '+key},body:JSON.stringify({challenge})});assert.equal(proof.status,200,'Attestation failed');const {assertion}=await proof.json();assert.equal(typeof assertion,'string');
const response=await fetch('https://easybook-mcp-oauth.1902521952.workers.dev/pairing/complete',{method:'POST',headers,body:JSON.stringify({challenge,assertion})});
assert.equal(response.status,409,'Valid cross-Worker proof must reach unknown challenge rejection');
console.log('PASS: live preflight and cross-Worker HMAC verified; unknown challenge rejected; no grants created or notes accessed');
