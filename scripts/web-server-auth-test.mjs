import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';
import {WebServerAuth} from '../shared/web-server-auth.mjs';

const ORIGIN='https://notes.example',CLIENT='https://app.example',TOKEN='a'.repeat(64),FLOW='b'.repeat(64),CODE='c'.repeat(64);
const SESSION='server-web-session-v1',REVOKED='server-web-revocations-v1';
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve}};
async function until(check){for(let attempt=0;attempt<200;attempt++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2))}throw Error('Timed out waiting for authorization task')}

async function fixture(options={}){
 const store=new WebStore(new IDBFactory());await store.open();
 const requests=[],channels=[],popups=[],changes=[];let active=true,offline=false,time=1000,token=TOKEN;
 class Channel{
  constructor(name){this.name=name;channels.push(this)}
  close(){this.closed=true}
  send(data,origin=CLIENT){if(!this.closed)this.onmessage?.({data,origin})}
 }
 const window={open(){if(options.blocked)return null;const popup={closed:false,opener:{},location:{replace(url){assert.equal(popup.opener,null,'untrusted authorization page cannot navigate the app through opener');popup.url=url}},close(){this.closed=true}};popups.push(popup);return popup}};
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  requests.push({url,init,body});
  if(offline)throw Error('offline');
  if(options.fetch){const overridden=await options.fetch(path,body,init);if(overridden)return overridden}
  if(path==='/account/web/start')return reply({flow:FLOW,authorization_url:ORIGIN+'/account/web/authorize?flow='+FLOW+'&state='+body.state,expires_in:300});
  if(path==='/account/web/token')return reply({token,session_id:'session-a',expires_in:604800});
  if(path==='/account/web/session')return reply({signedIn:true,account:{id:'account-a',name:'Alice'}});
  if(path==='/account/web/logout')return reply({ok:true});
  throw Error('Unexpected path');
 };
 const authOptions={profile:{id:'d'.repeat(64),origin:ORIGIN,builtin:false,epoch:1},store,clientOrigin:CLIENT,window,BroadcastChannel:Channel,fetch,
  now:()=>time,onChange:value=>changes.push(value),assertActive:async()=>{if(!active)throw Object.assign(Error('profile changed'),{code:'SERVER_PROFILE_CHANGED'})},...options.auth};
 const auth=new WebServerAuth(authOptions);
 const callback=(overrides={})=>({type:'easybook-server-login',server:ORIGIN,flow:FLOW,state:requests.find(request=>request.body?.state)?.body.state,code:CODE,...overrides});
 const start=async()=>{const result=auth.login();result.catch(()=>{});assert.equal(popups.length,1,'popup opens synchronously from the click');await until(()=>channels.length===1);return {result,channel:channels[0]}};
 const login=async()=>{const {result,channel}=await start();channel.send(callback());return result};
 return {auth,store,requests,channels,popups,changes,callback,start,login,anotherAuth:()=>new WebServerAuth(authOptions),setToken:value=>token=value,setActive:value=>active=value,setOffline:value=>offline=value,setTime:value=>time=value,close:async()=>{await auth.cancel();store.db.close()}};
}

{
 const f=await fixture();
 try{
  const {result,channel}=await f.start(),start=f.requests[0].body;
  assert.match(start.challenge,/^[A-Za-z0-9_-]{43}$/);assert.match(start.state,/^[a-f0-9]{64}$/);assert.equal(start.redirect_uri,CLIENT+'/server-callback');
  assert.equal(channel.name,'easybook-server-login:'+FLOW);
  channel.send(f.callback({server:'https://other.example'}));channel.send(f.callback({state:'e'.repeat(64)}));channel.send(f.callback(),'https://other.example');
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.requests.length,1,'unrelated callbacks cannot exchange a code');
  channel.send(f.callback());channel.send(f.callback());const status=await result;
  assert.equal(status.signedIn,true);assert.equal(status.token,undefined);assert.equal(f.popups[0].closed,true);
  const exchanges=f.requests.filter(request=>new URL(request.url).pathname==='/account/web/token');assert.equal(exchanges.length,1);
  const expected=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(exchanges[0].body.verifier))).toString('base64url');assert.equal(start.challenge,expected);
  const stored=await f.store.vaultGet(SESSION);assert.equal(stored.profileId,'d'.repeat(64));assert.equal(stored.origin,ORIGIN);assert.equal(stored.data instanceof ArrayBuffer,true);
  assert.equal(JSON.stringify(stored).includes(TOKEN),false);assert.equal((await f.store.vaultKey()).extractable,false);
  assert.deepEqual(await f.auth.authorizationHeaders(),{Authorization:'Easybook-Web '+TOKEN});
  const session=await f.auth.session();assert.equal(session.name,'Alice');assert.equal(session.account.id,'account-a');assert.equal(session.signedIn,true);
  for(const request of f.requests){assert.equal(new URL(request.url).origin,ORIGIN);assert.equal(request.init.credentials,'omit');assert.equal(request.init.redirect,'error');assert.equal(request.init.cache,'no-store')}
 }finally{await f.close()}
 console.log('PASS Web server authorization: popup PKCE, strict callback binding, one exchange, encrypted profile vault, normalized session and cookie-free fixed-origin requests');
}

{
 const f=await fixture({blocked:true});try{await assert.rejects(f.auth.login(),{code:'POPUP_BLOCKED'});assert.equal(f.requests.length,0);assert.equal(await f.store.vaultGet(SESSION),undefined)}finally{await f.close()}
 const g=await fixture({fetch:path=>path==='/account/web/start'?reply({flow:FLOW,authorization_url:'https://attacker.example/account/web/authorize',expires_in:300}):null});
 try{await assert.rejects(g.auth.login(),{code:'INVALID_AUTH_DESTINATION'});assert.equal(g.popups[0].closed,true);assert.equal(g.requests.length,1)}finally{await g.close()}
 console.log('PASS Web server authorization: blocked popup and untrusted destination fail without navigation or credentials');
}

{
 const response=deferred(),entered=deferred();
 const f=await fixture({fetch:async path=>{if(path==='/account/web/token'){entered.resolve();await response.promise;return reply({token:TOKEN,session_id:'cancelled',expires_in:604800})}}});
 try{
  const {result,channel}=await f.start();channel.send(f.callback());await entered.promise;
  const cleanup=f.auth.cancel();await assert.rejects(result,{code:'AUTH_CANCELLED'});response.resolve();await cleanup;
  assert.equal(await f.store.vaultGet(SESSION),undefined);assert.equal(f.changes.length,0);assert.equal(channel.closed,true);
 }finally{response.resolve();await f.close()}
 const g=await fixture();
 try{
  const written=deferred(),release=deferred(),put=g.store.vaultPut.bind(g.store);
  g.store.vaultPut=async(name,value)=>{await put(name,value);if(name===SESSION){written.resolve();await release.promise}};
  const {result,channel}=await g.start();channel.send(g.callback());await written.promise;
  let settled=false;const cleanup=g.auth.cancel().then(()=>settled=true);await assert.rejects(result,{code:'AUTH_CANCELLED'});
  await Promise.resolve();assert.equal(settled,false,'cancel waits for storage rollback before a profile switch');
  release.resolve();await cleanup;assert.equal(await g.store.vaultGet(SESSION),undefined);
 }finally{await g.close()}
 console.log('PASS Web server authorization: cancellation rejects delayed tokens and awaits in-flight vault cleanup');
}

{
 const response=deferred(),entered=deferred();
 const f=await fixture({fetch:async path=>{if(path==='/account/web/token'){entered.resolve();await response.promise;return reply({token:TOKEN,session_id:'stale',expires_in:604800})}}});
 try{
  const {result,channel}=await f.start();channel.send(f.callback());await entered.promise;f.setActive(false);response.resolve();
  await assert.rejects(result,{code:'SERVER_PROFILE_CHANGED'});assert.equal(await f.store.vaultGet(SESSION),undefined);
 }finally{response.resolve();await f.close()}
 const g=await fixture();
 try{
  const {result,channel}=await g.start();g.setTime(301001);channel.send(g.callback());await assert.rejects(result,{code:'AUTH_EXPIRED'});assert.equal(g.requests.length,1);
 }finally{await g.close()}
 console.log('PASS Web server authorization: changed profile and expired callbacks cannot store a session');
}

{
 const tokenB='e'.repeat(64),entered=deferred(),release=deferred();let block=false,failB=true,tail=Promise.resolve();
 const names=[],locks={request(name,task){names.push(name);const result=tail.then(task,task);tail=result.catch(()=>{});return result}};
 const f=await fixture({auth:{locks},fetch:async(path,body,init)=>{
  if(path!=='/account/web/logout')return;
  if(block&&init.headers.Authorization==='Easybook-Web '+TOKEN){entered.resolve();await release.promise;return reply({ok:true})}
  if(failB&&init.headers.Authorization==='Easybook-Web '+tokenB)throw Error('offline B');
 }});
 try{
  await f.login();f.setOffline(true);await f.auth.logout();f.setOffline(false);f.setToken(tokenB);
  const second=f.anotherAuth(),login=second.login();login.catch(()=>{});await until(()=>f.channels.length===2);
  const state=f.requests.filter(request=>new URL(request.url).pathname==='/account/web/start').at(-1).body.state;
  f.channels.at(-1).send(f.callback({state}));await login;
  block=true;const retry=f.auth.retryLogout();await entered.promise;let loggedOut=false;
  const logout=second.logout().then(value=>{loggedOut=true;return value});await Promise.resolve();assert.equal(loggedOut,false);
  release.resolve();await retry;assert.equal((await logout).revocationPending,true);assert.ok(await f.store.vaultGet(REVOKED));
  failB=false;assert.deepEqual(await second.retryLogout(),{pending:false});assert.equal(await f.store.vaultGet(REVOKED),undefined);
  assert.ok(names.length>=4);assert.equal(new Set(names).size,1);assert.match(names[0],/d{64}$/);
  await second.cancel();
 }finally{release.resolve();await f.close()}
 console.log('PASS Web server authorization: concurrent logout retries preserve newly queued revocations under the profile Web Lock');
}

{
 const f=await fixture();try{
  await f.login();f.setOffline(true);const status=await f.auth.logout();assert.equal(status.signedIn,false);assert.equal(status.revocationPending,true);
  assert.equal(await f.store.vaultGet(SESSION),undefined);assert.deepEqual(await f.auth.authorizationHeaders(),{});
  const pending=await f.store.vaultGet(REVOKED);assert.ok(pending);assert.equal(JSON.stringify(pending).includes(TOKEN),false);
  f.setOffline(false);assert.deepEqual(await f.auth.retryLogout(),{pending:false});assert.equal(await f.store.vaultGet(REVOKED),undefined);
  const revoke=f.requests.filter(request=>new URL(request.url).pathname==='/account/web/logout');assert.equal(revoke.length,2);assert.equal(revoke[1].init.headers.Authorization,'Easybook-Web '+TOKEN);
 }finally{await f.close()}
 console.log('PASS Web server authorization: offline logout removes usable credentials and retries encrypted, profile-bound revocation');
}

{
 const f=await fixture();try{
  await f.login();
  const other=new WebServerAuth({profile:{id:'e'.repeat(64),origin:'https://other.example'},store:f.store,clientOrigin:CLIENT});
  await assert.rejects(other.authorizationHeaders(),{code:'CREDENTIAL_UNAVAILABLE'});
  f.setTime(604801001);assert.deepEqual(await f.auth.authorizationHeaders(),{});assert.equal(await f.store.vaultGet(SESSION),undefined);
  assert.throws(()=>new WebServerAuth({profile:{id:'e'.repeat(64),origin:'https://other.example',builtin:true},store:f.store,clientOrigin:CLIENT}),{code:'INVALID_SERVER'});
 }finally{await f.close()}
 console.log('PASS Web server authorization: credentials cannot cross profiles, expired tokens are removed, built-in Cookie auth stays separate');
}
