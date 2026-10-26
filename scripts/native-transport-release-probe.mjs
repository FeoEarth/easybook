import assert from 'node:assert/strict';
const origin=process.argv[2];if(!origin)throw Error('Exact native transport origin required');
const state=crypto.randomUUID().replaceAll('-','').repeat(2),verifier=crypto.randomUUID().replaceAll('-','').repeat(2);
const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
async function post(path,body,headers={}){const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Easybook-Native':'1',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return r}
let r=await post('/account/native/start',{state,challenge,provider:'github'});assert.equal(r.status,200);const started=await r.json(),auth=new URL(started.authorization_url);assert.equal(auth.origin,'https://easybook.loonxy.com');assert.equal(auth.pathname,'/account/login');assert.match(auth.searchParams.get('return'),/^\/account\/handoff\?flow=[a-f0-9]{64}&state=[a-f0-9]{64}$/);
r=await post('/account/native/poll',{flow:started.flow,state,verifier});assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'pending'},'status probe must never return a credential');
r=await post('/account/native/passkeys/login/options',{state,challenge});assert.equal(r.status,200);const passkey=await r.json();assert.equal(passkey.options.rpId,'easybook.loonxy.com');assert.equal(passkey.options.userVerification,'required');
r=await post('/account/native/manage',{action:'history'});assert.equal(r.status,401,'management requires a valid native session');
r=await post('/account/native/start',{state,challenge},{Origin:'https://evil.example'});assert.equal(r.status,403,'browser native transport denied');
console.log('PASS native transport: canonical GitHub handoff and Passkey RP, user verification, management authentication and Origin denial; no real account or workspace accessed.');
