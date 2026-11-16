import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI,deriveAddress,addMonths} from '../worker/membership.mjs';
const f=await fixture();
const call=(path,body,headers={})=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf,...headers},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const value=async response=>{assert.ok(response.ok,await response.clone().text());return response.json()};
const order=(plan='month',chainId=137,extra={})=>call('/orders',{plan,chainId,idempotency:crypto.randomUUID(),...extra}).then(value);
try{
 const initial=await value(await call(''));assert.equal(initial.address,deriveAddress(f.env.MEMBERSHIP_XPUB,3));
 const first=await order(),same=await order('month',9745);assert.equal(first.id,same.id);assert.equal(first.address,same.address);
 assert.equal((await call('/orders',{plan:'year',chainId:137,idempotency:crypto.randomUUID()})).status,409);
 f.inject(first,{amount:'4000'});await f.scan();let partial=await value(await call('/orders/'+first.id));assert.equal(partial.received,'0.004');assert.equal(partial.remaining,'0.006');assert.equal(partial.settled_at,null);
 f.inject({...first,chain_id:43114,token:JSON.parse(f.env.MEMBERSHIP_NETWORKS).find(c=>c.chainId===43114).token.toLowerCase()},{amount:'6000'});await f.scan();const paid=await value(await call('/orders/'+first.id));assert.ok(paid.settled_at);assert.equal((await value(await call(''))).balance,'0.00');
 const renewal=await order();assert.equal(renewal.kind,'renewal');await value(await call('/orders/'+renewal.id+'/cancel',{}));
 const replacement=await order('year');f.inject(replacement,{amount:'3000'});await f.scan();const cancelled=await value(await call('/orders/'+replacement.id));assert.equal(cancelled.cancel_reason,'late_payment');let state=await value(await call(''));assert.equal(state.balance,'0.003');assert.equal(state.needsAcknowledgement,true);
 const continuation=await order('year',137,{acknowledgeLatePayment:true});assert.equal(continuation.address,initial.address);assert.equal(continuation.kind,'upgrade');assert.ok(continuation.settled_at);state=await value(await call(''));assert.equal(state.plan,'year');assert.equal(state.needsAcknowledgement,false);
 const quote=await value(await call('/quote?plan=permanent'));assert.equal(quote.kind,'upgrade');assert.ok(Number(quote.upgradeCredit)<=.01);assert.ok(Number(quote.required)>=0);
 const upgrade=await order('permanent');if(!upgrade.settled_at){f.inject(upgrade,{amount:upgrade.amount});await f.scan()}assert.equal((await value(await call(''))).permanent,true);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL').get(f.account).n,0);
 assert.equal((await call('/orders/'+first.id+'/cancel',{})).status,409);
 const count=f.sql.prepare('SELECT COUNT(*) n FROM membership_balance_events').get().n;await f.scan();assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_balance_events').get().n,count);
 assert.equal((await call('/orders/'+first.id+'/cancel',{}, {'X-Easybook-CSRF':'bad'})).status,403);
 assert.equal(new Date(addMonths(Date.UTC(2024,0,31),1)).toISOString(),'2024-02-29T00:00:00.000Z');
 console.log('PASS fixed account addresses, multi-chain top-ups, cancellation guard, balances and prorated upgrades');
}finally{f.close()}
