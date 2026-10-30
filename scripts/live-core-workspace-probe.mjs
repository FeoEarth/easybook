import assert from 'node:assert/strict';

const origin=process.argv[2];
if(!origin?.startsWith('https://'))throw Error('Pass exact HTTPS release origin');
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 let data;try{data=await response.json()}catch{throw Error('Release probe non-JSON HTTP '+response.status)}
 return {response,data};
}

const health=await request('/health');
assert.equal(health.response.status,200);
assert.equal(health.data.ok,true);
assert.equal(health.data.workspaceIdentityV2,true);

const config=await request('/api/turnstile');
assert.equal(config.response.status,200,'Turnstile site key must be configured before promotion');
assert.equal(config.data.action,'create_workspace');
assert.match(config.data.sitekey,/^[A-Za-z0-9_-]{10,}$/);

// CI cannot mint a real, single-use browser token. Verify the deployed boundary
// fails closed; full create/isolation/attachment/rotation flows run locally.
const denied=await request('/api/workspaces',{name:'Release verification '+Date.now()});
assert.equal(denied.response.status,403);
assert.equal(denied.data.error,'turnstile_verification_failed');

console.log(JSON.stringify({result:'passed',checks:['health','identity v2','Turnstile configured','anonymous creation fails closed without browser proof']}));
