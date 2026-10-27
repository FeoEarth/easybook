import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,createHash,randomBytes,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {nativePasskeyRoutes} from '../src/native-passkeys.mjs';
import {nativeSession,s256} from '../src/native-sessions.mjs';
import {passkeyRoutes} from '../src/passkeys.mjs';
import {session as webSession} from '../src/accounts.mjs';
import {ANDROID_APP_ORIGIN,androidAssetLinks,ANDROID_SIGNING_SHA256} from '../../worker/android-identity.mjs';
const sql=new DatabaseSync(':memory:');for(const file of ['0002_accounts.sql','0003_passkeys.sql','0004_native_identity.sql'])sql.exec(readFileSync('mcp-oauth/migrations/'+file,'utf8'));
const DB={prepare(s){const q=sql.prepare(s);let p=[];return {bind(...args){p=args;return this},async first(){return q.get(...p)||null},async all(){return {results:q.all(...p)}},async run(){return q.run(...p)}}},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.all());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={DB,IDENTITY_CANONICAL_V2:'true'},origin='https://easybook.loonxy.com',rpID='easybook.loonxy.com',verifier='v'.repeat(64),state='f'.repeat(64);let serial=0;
async function request(path,input,token=null,headers={}){try{return await nativePasskeyRoutes(new Request(origin+'/account/native/passkeys/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Easybook-Native':'1','CF-Connecting-IP':'synthetic-passkey-'+serial++,...(token?{Authorization:'Easybook-Session '+token}:{}),...headers},body:JSON.stringify(input)}),env)}catch(e){if(e instanceof Response)return e;throw e}}
async function options(kind,token=null){const r=await request(kind+'/options',{challenge:await s256(verifier),state,name:'Synthetic native user'},token);assert.equal(r.status,200,await r.clone().text());return r.json()}
const digest=value=>createHash('sha256').update(value).digest();
function authenticator(){const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32).toString('base64url');return {privateKey,id,key:isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))}}
function clientData(type,challenge,changes={}){return Buffer.from(JSON.stringify({type,challenge,origin:ANDROID_APP_ORIGIN,crossOrigin:false,...changes}))}
function registration(options,k,changes={}){const credential=Buffer.from(k.id,'base64url'),length=Buffer.alloc(2);length.writeUInt16BE(credential.length);const auth=Buffer.concat([digest(changes.rpID||rpID),Buffer.from([changes.flags??0x45]),Buffer.alloc(4),Buffer.alloc(16),length,credential,Buffer.from(k.key)]),attestation=isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(auth)]]));return {id:k.id,rawId:k.id,type:'public-key',response:{attestationObject:Buffer.from(attestation).toString('base64url'),clientDataJSON:clientData('webauthn.create',options.challenge,changes.client).toString('base64url'),transports:['internal']},clientExtensionResults:{},authenticatorAttachment:'platform'}}
function authentication(options,k,userHandle,counter=1,changes={}){const client=clientData('webauthn.get',options.challenge,changes.client),number=Buffer.alloc(4);number.writeUInt32BE(counter);const auth=Buffer.concat([digest(changes.rpID||rpID),Buffer.from([changes.flags??0x05]),number]);return {id:k.id,rawId:k.id,type:'public-key',response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:sign('sha256',Buffer.concat([auth,digest(client)]),changes.privateKey||k.privateKey).toString('base64url'),userHandle},clientExtensionResults:{},authenticatorAttachment:'platform'}}
const verify=(kind,p,response,token=null,extra={})=>request(kind+'/verify',{flow:p.flow,state,verifier,response,...extra},token);
for(const changes of [{client:{origin:'android:apk-key-hash:foreign'}},{client:{origin}},{rpID:'evil.example'},{flags:0x41},{client:{challenge:'wrong'}}]){const p=await options('register'),k=authenticator();assert.equal((await verify('register',p,registration(p.options,k,changes))).status,400);assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,0)}
let p=await options('register'),k=authenticator();assert.equal(p.options.rp.id,rpID);const registered=await verify('register',p,registration(p.options,k));assert.equal(registered.status,200,await registered.clone().text());const token=(await registered.json()).token;
assert.equal((await verify('register',p,registration(p.options,k))).status,400,'challenge replay denied');
let s=await nativeSession(new Request(origin,{headers:{Authorization:'Easybook-Session '+token}}),env);assert.ok(s);assert.equal(sql.prepare('SELECT rp_id FROM account_passkey_rps WHERE credential_id=?').get(k.id).rp_id,rpID);
const handle=Buffer.from(s.account_id).toString('base64url');
// Real signatures through both endpoints verify server interoperability.
// Device/provider UI and Digital Asset Links caching still need device acceptance.
let webCookies='';
async function web(path,input){
 const r=await passkeyRoutes(new Request(origin+'/account/passkeys/'+path,{method:'POST',headers:{Origin:origin,'X-Easybook-Passkey':'1','Content-Type':'application/json',Cookie:webCookies,'CF-Connecting-IP':'cross-client-'+serial++},body:JSON.stringify(input)}),env);
 for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],name=pair.split('=')[0];webCookies=webCookies.split('; ').filter(v=>v&&!v.startsWith(name+'=')).concat(pair).join('; ')}return r;
}
let webOptions=await web('login/options',{});assert.equal(webOptions.status,200);
let webLogin=await web('login/verify',{response:authentication((await webOptions.json()).options,k,handle,0,{client:{origin}})});
assert.equal(webLogin.status,200,await webLogin.clone().text());
assert.equal((await webSession(new Request(origin,{headers:{Cookie:webCookies}}),env)).account_id,s.account_id,'Android-created key logs into the same Web account');
webCookies='';
webOptions=await web('register/options',{name:'Web-created account'});assert.equal(webOptions.status,200);
const webRegistrationOptions=(await webOptions.json()).options,webKey=authenticator();
const webRegistered=await web('register/verify',{response:registration(webRegistrationOptions,webKey,{client:{origin}})});assert.equal(webRegistered.status,200,await webRegistered.clone().text());
const webAccount=await webSession(new Request(origin,{headers:{Cookie:webCookies}}),env);
let nativeOptions=await options('login');
const fromWeb=await verify('login',nativeOptions,authentication(nativeOptions.options,webKey,webRegistrationOptions.user.id));
assert.equal(fromWeb.status,200,await fromWeb.clone().text());
assert.equal((await nativeSession(new Request(origin,{headers:{Authorization:'Easybook-Session '+(await fromWeb.json()).token}}),env)).account_id,webAccount.account_id,'Web-created key logs into the same Android account');
for(const changes of [{client:{origin:'android:apk-key-hash:foreign'}},{rpID:'evil.example'},{flags:0x01},{privateKey:authenticator().privateKey}]){p=await options('login');assert.equal((await verify('login',p,authentication(p.options,k,handle,1,changes))).status,400)}
p=await options('login');assert.equal((await verify('login',p,authentication(p.options,k,'foreign-handle'))).status,400);
p=await options('login');const signed=authentication(p.options,k,handle);assert.equal((await verify('login',p,signed,null,{verifier:'x'.repeat(64)})).status,400);
const logged=await verify('login',p,signed);assert.equal(logged.status,200,'real Android-origin signature accepted');const secondToken=(await logged.json()).token;assert.ok(await nativeSession(new Request(origin,{headers:{Authorization:'Easybook-Session '+secondToken}}),env));
p=await options('register',token);const secondKey=authenticator();assert.equal((await verify('register',p,registration(p.options,secondKey),token)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM accounts').get().n,2,'enrollment keeps account identity');
p=await options('register',token);sql.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').run(Date.now(),s.id);assert.equal((await verify('register',p,registration(p.options,authenticator()),token)).status,401,'revoked enrollment session denied');
p=await options('login');sql.prepare('UPDATE account_native_passkey_challenges SET expires_at=0 WHERE id=?').run(p.flow);assert.equal((await verify('login',p,authentication(p.options,k,handle,2))).status,400);
p=await options('login');sql.prepare('UPDATE account_passkeys SET revoked_at=? WHERE id=?').run(Date.now(),k.id);assert.equal((await verify('login',p,authentication(p.options,k,handle,2))).status,400);assert.equal(await nativeSession(new Request(origin,{headers:{Authorization:'Easybook-Session '+secondToken}}),env),null,'credential revocation closes derived sessions');
assert.equal((await request('login/options',{challenge:await s256(verifier),state},null,{Origin:origin})).status,403,'browser cannot invoke native ceremony');
assert.equal(androidAssetLinks[0].target.sha256_cert_fingerprints[0].replaceAll(':','').toLowerCase(),ANDROID_SIGNING_SHA256);
console.log('PASS native Passkeys: actual signed Android-origin WebAuthn signup/login/enrollment; application/RP/challenge/UV/signature/handle checks; PKCE/replay/expiry; revoked credential/session denial; stable account identity; signing association consistency.');

