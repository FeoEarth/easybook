import {Buffer} from 'node:buffer';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {IDENTITY_ORIGIN,identityEnabled} from '../../worker/identity-origin.mjs';
import {ANDROID_APP_ORIGIN} from '../../worker/android-identity.mjs';
import {hash,object} from '../../worker/mcp-common.mjs';
import {json,random,rateLimit,createSession} from './accounts.mjs';
import {nativeBody,nativeSession,s256} from './native-sessions.mjs';
const rpID=new URL(IDENTITY_ORIGIN).hostname,algorithms=[-7,-257],HEX=/^[a-f0-9]{64}$/;
const failure=()=>json({error:'passkey_verification_failed'},400);
async function issued(request,env,account,credential){
 const established=await createSession(request,env,account,credential);
 await env.DB.prepare('INSERT INTO account_native_sessions(session_id,created_at) VALUES(?,?)').bind(established.id,Date.now()).run();
 return json({token:established.token,session_id:established.id,expires_in:604800});
}
export async function nativePasskeyRoutes(request,env){
 const url=new URL(request.url),match=url.pathname.match(/^\/account\/native\/passkeys\/(login|register)\/(options|verify)$/);if(!match)return null;
 if(!identityEnabled(env))return json({error:'not_available'},404);
 if(url.origin!==IDENTITY_ORIGIN)return json({error:'identity_origin_required'},403);
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 await rateLimit(request,env,'native-passkey',30);
 const input=await nativeBody(request,65536),[,kind,action]=match;
 const current=await nativeSession(request,env);
 if(request.headers.has('Authorization')&&!current)return json({error:'unauthorized'},401);
 if(action==='options'){
  if(!/^[A-Za-z0-9_-]{43}$/.test(input.challenge||'')||!HEX.test(input.state||''))return json({error:'invalid_pkce_or_state'},400);
  let options,purpose='login',accountId=null,name=null;
  if(kind==='register'){
   if(current&&Date.now()-current.authenticated_at>300000)return json({error:'reauthentication_required'},403);
   purpose=current?'enroll':'signup';accountId=current?.account_id||crypto.randomUUID();name=current?.display_name||(typeof input.name==='string'?input.name.trim():'');
   if(typeof name!=='string'||!name||name.length>100)return json({error:'invalid_name'},400);
   const keys=current?(await env.DB.prepare('SELECT id,transports FROM account_passkeys WHERE account_id=? AND revoked_at IS NULL LIMIT 20').bind(accountId).all()).results:[];
   if(keys.length>=20)return json({error:'credential_limit'},409);
   options=await generateRegistrationOptions({rpName:'Easybook',rpID,userID:new TextEncoder().encode(accountId),userName:accountId,userDisplayName:name,attestationType:'none',supportedAlgorithmIDs:algorithms,timeout:120000,authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
  }else options=await generateAuthenticationOptions({rpID,timeout:120000,userVerification:'required',allowCredentials:[]});
  const flow=random();await env.DB.prepare('INSERT INTO account_native_passkey_challenges(id,challenge,pkce_challenge,state_hash,purpose,account_id,session_id,display_name,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(flow,options.challenge,input.challenge,await hash(input.state),purpose,accountId,current?.id||null,name,Date.now()+300000).run();
  return json({flow,options,expires_in:300});
 }
 if(!HEX.test(input.flow||'')||!HEX.test(input.state||'')||typeof input.verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)||!object(input.response))return failure();
 const pending=await env.DB.prepare('DELETE FROM account_native_passkey_challenges WHERE id=? AND pkce_challenge=? AND state_hash=? AND expires_at>? RETURNING *').bind(input.flow,await s256(input.verifier),await hash(input.state),Date.now()).first();
 if(!pending||(kind==='login')!==(pending.purpose==='login'))return failure();
 if(kind==='register'){
  if(pending.purpose==='enroll'&&(!current||current.account_id!==pending.account_id||current.id!==pending.session_id||Date.now()-current.authenticated_at>300000))return json({error:'account_session_changed'},403);
  if(pending.purpose==='signup'&&current)return json({error:'account_session_changed'},409);
  let checked;try{checked=await verifyRegistrationResponse({response:input.response,expectedChallenge:pending.challenge,expectedOrigin:ANDROID_APP_ORIGIN,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:algorithms})}catch{return failure()}
  if(!checked.verified)return failure();
  const info=checked.registrationInfo,k=info.credential,statements=[];
  if(pending.purpose==='signup')statements.push(env.DB.prepare('INSERT INTO accounts(id,display_name,created_at) VALUES(?,?,?)').bind(pending.account_id,pending.display_name,Date.now()));
  statements.push(env.DB.prepare('INSERT INTO account_passkeys(id,account_id,public_key,counter,transports,device_type,backed_up,label,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(k.id,pending.account_id,Buffer.from(k.publicKey).toString('base64url'),k.counter,JSON.stringify(k.transports||[]),info.credentialDeviceType,Number(info.credentialBackedUp),'Android 通行密钥',Date.now()));
  statements.push(env.DB.prepare('INSERT INTO account_passkey_rps(credential_id,rp_id) VALUES(?,?)').bind(k.id,rpID));
  try{await env.DB.batch(statements)}catch{return json({error:'credential_already_used_or_account_changed'},409)}
  return issued(request,env,pending.account_id,k.id);
 }
 const id=input.response?.id;if(typeof id!=='string'||id.length>2048)return failure();
 const k=await env.DB.prepare('SELECT k.* FROM account_passkeys k JOIN accounts a ON a.id=k.account_id JOIN account_passkey_rps r ON r.credential_id=k.id WHERE k.id=? AND r.rp_id=? AND k.revoked_at IS NULL AND a.deleted_at IS NULL').bind(id,rpID).first();
 if(!k||input.response?.response?.userHandle!==Buffer.from(k.account_id).toString('base64url'))return failure();
 let checked;try{checked=await verifyAuthenticationResponse({response:input.response,expectedChallenge:pending.challenge,expectedOrigin:ANDROID_APP_ORIGIN,expectedRPID:rpID,requireUserVerification:true,credential:{id:k.id,publicKey:new Uint8Array(Buffer.from(k.public_key,'base64url')),counter:k.counter,transports:JSON.parse(k.transports)}})}catch{return failure()}
 if(!checked.verified)return failure();
 const updated=await env.DB.prepare('UPDATE account_passkeys SET counter=?,last_used_at=?,backed_up=? WHERE id=? AND counter=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM accounts WHERE id=account_passkeys.account_id AND deleted_at IS NULL) RETURNING id').bind(checked.authenticationInfo.newCounter,Date.now(),Number(checked.authenticationInfo.credentialBackedUp),k.id,k.counter).first();
 if(!updated)return json({error:'credential_changed'},409);
 return issued(request,env,k.account_id,k.id);
}
