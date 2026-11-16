import {PRICE_VERSION} from '../worker/membership-plans.mjs';
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI,deriveAddress,addMonths} from '../worker/membership.mjs';
const f=await fixture();
const call=(path,body,headers={})=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf,...headers},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const value=async response=>{assert.ok(response.ok,await response.clone().text());return response.json()};
const order=(plan='month',chainId=137,extra={})=>call('/orders',{plan,chainId,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),...extra}).then(value);
try{
 const initial=await value(await call(''));assert.equal(initial.address,deriveAddress(f.env.MEMBERSHIP_XPUB,3));
 const first=await order(),same=await order('month',9745);assert.equal(first.id,same.id);assert.equal(first.address,same.address);
 assert.equal((await call('/orders',{plan:'year',chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID()})).status,409);
 f.inject(first,{amount:'400000'});await f.scan();let partial=await value(await call('/orders/'+first.id));assert.equal(partial.received,'0.40');assert.equal(partial.remaining,'0.60');assert.equal(partial.settled_at,null);
 f.inject({...first,chain_id:43114,token:JSON.parse(f.env.MEMBERSHIP_NETWORKS).find(c=>c.chainId===43114).token.toLowerCase()},{amount:'600000'});await f.scan();const paid=await value(await call('/orders/'+first.id));assert.ok(paid.settled_at);assert.equal((await value(await call(''))).balance,'0.00');
 const renewal=await order();assert.equal(renewal.kind,'renewal');await value(await call('/orders/'+renewal.id+'/cancel',{}));
 const replacement=await order('year');f.inject(replacement,{amount:'3000000'});await f.scan();const cancelled=await value(await call('/orders/'+replacement.id));assert.equal(cancelled.cancel_reason,'late_payment');let state=await value(await call(''));assert.equal(state.balance,'3.00');assert.equal(state.needsAcknowledgement,true);
 const continuation=await order('year',137,{acknowledgeLatePayment:true});assert.equal(continuation.address,initial.address);assert.equal(continuation.kind,'renewal');if(!continuation.settled_at){const b=f.sql.prepare('SELECT units FROM membership_balances WHERE account_id=?').get(f.account);f.inject(continuation,{amount:String(BigInt(continuation.amount)-BigInt(b.units))});await f.scan()}assert.ok((await value(await call('/orders/'+continuation.id))).settled_at);state=await value(await call(''));assert.equal(state.plan,'year');assert.equal(state.needsAcknowledgement,false);
 // Mixed packages extend the full existing expiry, with no credit or upgrade reset.
 const catalog=await value(await call('/plans'));assert.deepEqual(catalog.plans.map(p=>[p.id,p.months,p.price]),[['month',1,'1.00'],['quarter',3,'2.00'],['half-year',6,'3.00'],['year',12,'5.00']]);
 assert.equal((await call('/quote?plan=permanent')).status,400);
 f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('50000000',f.account);
 let expiry=state.expiresAt;
 for(const [plan,months,units] of [['half-year',6,'3000000'],['half-year',6,'3000000'],['year',12,'5000000'],['quarter',3,'2000000'],['month',1,'1000000']]){
 const q=await value(await call('/quote?plan='+plan));assert.equal(q.amount,units);assert.equal(q.credit_units,'0');assert.equal(q.kind,'renewal');
 const before=await value(await call('')),reserved=await order(plan,137,{reserveOnly:true});assert.equal(reserved.payment_method,'unselected');assert.equal(reserved.balance,before.balance);assert.equal((await value(await call(''))).expiresAt,expiry);
 const settled=await value(await call('/orders/'+reserved.id+'/pay',{plan,amount:units}));assert.ok(settled.settled_at);expiry=addMonths(expiry,months);const current=await value(await call(''));assert.equal(current.expiresAt,expiry);assert.equal(current.permanent,false);assert.equal(current.plan,plan);
 }
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL').get(f.account).n,0);
 assert.equal((await call('/orders/'+first.id+'/cancel',{})).status,409);
 const count=f.sql.prepare('SELECT COUNT(*) n FROM membership_balance_events').get().n;await f.scan();assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_balance_events').get().n,count);
 assert.equal((await call('/orders/'+first.id+'/cancel',{}, {'X-Easybook-CSRF':'bad'})).status,403);
 assert.equal(new Date(addMonths(Date.UTC(2024,0,31),1)).toISOString(),'2024-02-29T00:00:00.000Z');
 console.log('PASS fixed account addresses, multi-chain top-ups, cancellation guard, balances and full-duration mixed-package renewals');
}finally{f.close()}
