import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,createHash,randomBytes,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {passkeyRoutes,PASSKEY_ORIGIN as origin,PASSKEY_RP_ID as rpID,PASSKEY_COOKIE} from '../src/passkeys.mjs';
import {session,csrf,ACCOUNT_COOKIE,accountRoutes,finishLogin} from '../src/accounts.mjs';

const sqlite=new DatabaseSync(':memory:');
for(const file of ['0002_accounts.sql','0003_passkeys.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
sqlite.exec(readFileSync(new URL('../migrations/0003_passkeys.sql',import.meta.url),'utf8'));
export const DB={prepare(sql){const q=sqlite.prepare(sql);let p=[];return {bind(...args){p=args;return this},async first(){return q.get(...p)||null},async all(){return {results:q.all(...p)}},async run(){return q.run(...p)}}},async batch(stmts){sqlite.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.all());sqlite.exec('COMMIT');return result}catch(error){sqlite.exec('ROLLBACK');throw error}}};
const env={DB},cookies=new Map();let serial=0;
function save(response){for(const c of response.headers.getSetCookie()){const [pair]=c.split(';'),at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}}
function cookieHeader(){return [...cookies].map(([k,v])=>k+'='+v).join('; ')}
async function request(path,data={},headers={},saveCookies=true){let response;try{response=await passkeyRoutes(new Request(origin+'/account/passkeys/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Easybook-Passkey':'1',Cookie:cookieHeader(),'CF-Connecting-IP':'synthetic-'+serial++,...headers},body:JSON.stringify(data)}),env)}catch(error){if(!(error instanceof Response))throw error;response=error}if(saveCookies)save(response);return response;}
async function currentSession(){return session(new Request(origin,{headers:{Cookie:cookieHeader()}}),env)}
async function token(){const s=await currentSession();return s?csrf(new Request(origin,{headers:{Cookie:cookieHeader()}}),s):undefined;}
async function options(kind,data={}){const r=await request(kind+'/options',{csrf:await token(),name:'Synthetic Passkey User',...data});assert.equal(r.status,200,await r.clone().text());return (await r.json()).options;}
const digest=bytes=>createHash('sha256').update(bytes).digest();
function clientData(type,challenge,changes={}){return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false,...changes}));}
function authenticator(){const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32).toString('base64url');return {privateKey,id,key:isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))};}
function registration(o,k,changes={}){
 const client=clientData('webauthn.create',o.challenge,changes.client),credential=Buffer.from(k.id,'base64url'),length=Buffer.alloc(2);length.writeUInt16BE(credential.length);
 const flags=changes.flags??0x45,auth=Buffer.concat([digest(changes.rpID||rpID),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),length,credential,Buffer.from(k.key)]);
 const attestation=isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(auth)]]));
 return {id:k.id,rawId:k.id,type:'public-key',response:{attestationObject:Buffer.from(attestation).toString('base64url'),clientDataJSON:client.toString('base64url'),transports:['internal']},clientExtensionResults:{},authenticatorAttachment:'platform'};
}
function authentication(o,k,userHandle,counter=1,changes={}){
 const client=clientData('webauthn.get',o.challenge,changes.client),number=Buffer.alloc(4);number.writeUInt32BE(counter);
 const auth=Buffer.concat([digest(changes.rpID||rpID),Buffer.from([changes.flags??0x05]),number]);
 const signature=sign('sha256',Buffer.concat([auth,digest(client)]),changes.privateKey||k.privateKey);
 return {id:k.id,rawId:k.id,type:'public-key',response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:signature.toString('base64url'),userHandle},clientExtensionResults:{},authenticatorAttachment:'platform'};
}
async function rejectRegistration(changes){const o=await options('register'),k=authenticator();const r=await request('register/verify',{response:registration(o,k,changes)});assert.equal(r.status,400);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM accounts').get().n,0);}
assert.equal((await request('register/options',{name:'bad'},{Origin:'https://evil.example'})).status,403);
assert.equal((await request('register/options',{name:'bad'},{'X-Easybook-Passkey':'0'})).status,403);
await rejectRegistration({client:{origin:'https://evil.example'}});
await rejectRegistration({client:{challenge:'wrong-challenge'}});
await rejectRegistration({rpID:'evil.example'});
await rejectRegistration({flags:0x41}); // Presence without user verification.
let o=await options('register'),k=authenticator();sqlite.prepare('UPDATE account_passkey_challenges SET expires_at=0').run();assert.equal((await request('register/verify',{response:registration(o,k)})).status,400);
o=await options('register');k=authenticator();const response=registration(o,k),browser=cookieHeader();
assert.equal((await request('register/verify',{response},{Cookie:''})).status,400,'browser-bound ceremony');
const created=await request('register/verify',{response},{Cookie:browser});assert.equal(created.status,200,await created.clone().text());
const signupSession=await currentSession(),handle=o.user.id;assert.ok(signupSession);assert.equal(Buffer.from(handle,'base64url').toString(),signupSession.account_id);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM account_identities').get().n,0,'GitHub not needed for signup');
assert.equal((await request('register/verify',{response},{Cookie:browser})).status,400,'registration challenge cannot replay');
const sessionCookie=cookieHeader();
assert.equal((await request('revoke',{id:k.id,csrf:await token()})).status,409,'cannot remove sole login method');
assert.equal((await request('register/options',{name:'bad',csrf:'wrong'})).status,403,'session CSRF checked');
const second=authenticator(),enroll=await options('register');assert.equal((await request('register/verify',{response:registration(enroll,second),csrf:await token()})).status,200);
const firstSession=signupSession.id;
assert.equal((await request('revoke',{id:k.id,csrf:await token()})).status,200);
assert.equal(await session(new Request(origin,{headers:{Cookie:sessionCookie}}),env),null,'revocation invalidates sessions made with that key');
assert.ok(sqlite.prepare('SELECT revoked_at FROM account_sessions WHERE id=?').get(firstSession).revoked_at);
cookies.delete(ACCOUNT_COOKIE);
let authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,k,handle)})).status,400,'revoked key cannot login');
for(const changes of [{client:{origin:'https://evil.example'}},{client:{challenge:'wrong'}},{rpID:'evil.example'},{flags:0x01},{privateKey:authenticator().privateKey}]){
 authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,second,handle,1,changes)})).status,400,'cryptographically invalid authentication rejected');
}
authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,second,'wrong-handle')})).status,400,'account handle cannot be substituted');
authOptions=await options('login');const assertion=authentication(authOptions,second,handle),oldBrowser=cookieHeader();
const outcomes=await Promise.all([request('login/verify',{response:assertion},{Cookie:oldBrowser},false),request('login/verify',{response:assertion},{Cookie:oldBrowser},false)]);
assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,400],'one concurrent ceremony succeeds');save(outcomes.find(r=>r.status===200));
assert.equal((await currentSession()).account_id,signupSession.account_id,'discoverable Passkey logs into correct local account');
cookies.delete(ACCOUNT_COOKIE);authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,second,handle,1)})).status,400,'counter rollback/reuse rejected');
authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,second,handle,2)})).status,200);
async function linkGithub(subject){
 const start=await accountRoutes(new Request(origin+'/account/identities/github',{method:'POST',headers:{Origin:origin,Cookie:cookieHeader(),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:await token()})}),env);assert.equal(start.status,303);save(start);
 const state=new URL(start.headers.get('Location')).searchParams.get('state');
 const result=await finishLogin(new Request(origin+'/callback?state='+state+'&code=synthetic-code',{headers:{Cookie:cookieHeader()}}),env,async url=>Response.json(String(url).includes('access_token')?{access_token:'synthetic-only'}:{id:subject,type:'User',login:'SyntheticGithub'}));save(result);return result;
}
const otherAccount=crypto.randomUUID();sqlite.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').run(otherAccount,'Other synthetic account',Date.now());sqlite.prepare("INSERT INTO account_identities(provider,subject,account_id) VALUES('github','555',?)").run(otherAccount);
assert.equal((await linkGithub(555)).status,409,'an existing GitHub identity cannot be claimed');
assert.equal((await linkGithub(777)).status,303,'GitHub can be explicitly linked as backup');
assert.equal(sqlite.prepare("SELECT account_id FROM account_identities WHERE provider='github' AND subject='777'").get().account_id,signupSession.account_id);
const active=await currentSession();sqlite.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').run(Date.now(),active.account_id);assert.equal(await currentSession(),null);
cookies.delete(ACCOUNT_COOKIE);authOptions=await options('login');assert.equal((await request('login/verify',{response:authentication(authOptions,second,handle,3)})).status,400,'deleted account cannot authenticate');
for(let i=0;i<30;i++)assert.equal((await request('login/options',{}, {'CF-Connecting-IP':'rate-test'})).status,200);
assert.equal((await request('login/options',{}, {'CF-Connecting-IP':'rate-test'})).status,429);
console.log('PASS Passkeys: actual SimpleWebAuthn verification; standalone signup, credential enrollment, signed discoverable login, UV/origin/RP/challenge/signature/handle checks, CSRF, expiry, browser binding, concurrent replay, counters, key/session revocation, sole-factor protection, deleted accounts, rate limit and retryable migration. Synthetic keys only.');

// Optional CI browser test: Chromium's virtual authenticator exercises the real browser API.
if(process.env.EASYBOOK_PASSKEY_BROWSER==='1'){
 const {chromium}=await import('../../node_modules/playwright/index.mjs');
 const browser=await chromium.launch({headless:true});let context;
 try{
  context=await browser.newContext({viewport:{width:360,height:740}});const browserCookies=new Map();
  await context.route(origin+'/**',async route=>{
   const req=route.request();let result;try{result=await passkeyRoutes(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='POST'?{body:req.postData()}: {})}),env);if(!result&&new URL(req.url()).pathname==='/account')result=new Response('<!doctype html><title>Signed in</title><h1>Signed in</h1>');if(!result)result=new Response('Not found',{status:404})}catch(error){result=error instanceof Response?error:new Response('Unexpected error',{status:500})}
   const headers=Object.fromEntries(result.headers),cookieList=result.headers.getSetCookie();delete headers['set-cookie'];
   if(cookieList.length)await context.addCookies(cookieList.map(c=>{const first=c.split(';')[0],pos=first.indexOf('=');return {name:first.slice(0,pos),value:first.slice(pos+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}}));
   await route.fulfill({status:result.status,headers,body:Buffer.from(await result.arrayBuffer())});
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto(origin+'/account/passkeys');await page.locator('#passkey-name').fill('Synthetic browser signup');await page.locator('#passkey-register').click();await page.waitForURL(origin+'/account');
  const signedCookie=(await context.cookies()).find(c=>c.name===ACCOUNT_COOKIE);assert.ok(signedCookie?.httpOnly&&signedCookie?.secure);
  await context.clearCookies();await page.goto(origin+'/account/passkeys');await page.locator('#passkey-login').click();await page.waitForURL(origin+'/account');
  await page.goto(origin+'/account/passkeys');for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'account-ui-passkey-'+theme+'.png',fullPage:true});}
  console.log('PASS Chromium virtual authenticator: real navigator.credentials signup and subsequent passwordless login, HttpOnly session, mobile light/dark page.');
 }finally{await context?.close();await browser.close()}
}
