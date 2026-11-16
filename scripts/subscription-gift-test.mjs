// Opt-in isolated regression coverage; not executed as part of deployment.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {buyGift,redeemGift,readGift,giftClaimStatements,giftPreview} from '../worker/membership-gifts.mjs';
import {planCatalog,updatePricing} from '../worker/membership-pricing.mjs';
import {accountBalance} from '../worker/membership-bonus.mjs';
import {addMonths} from '../worker/membership-duration.mjs';
import {orderHistory} from '../worker/membership-history.mjs';
import {membershipAPI} from '../worker/membership.mjs';
const f=await fixture(),buyer=f.account,recipient=crypto.randomUUID();
const call=(path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const reserve=async plan=>{const catalog=await planCatalog(f.env),r=await call('/orders',{plan,chainId:137,priceVersion:catalog.priceVersion,idempotency:crypto.randomUUID(),reserveOnly:true});assert.ok(r.ok,await r.clone().text());return r.json()};
try{
 await call('');f.sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(recipient,'Subscription recipient',Date.now());f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('20000000',buyer);
 const catalog=await planCatalog(f.env),request={kind:'subscription',plan:'quarter',priceVersion:catalog.priceVersion,idempotency:crypto.randomUUID()},card=await buyGift(f.env,buyer,request);assert.equal(card.months,3);assert.equal((await buyGift(f.env,buyer,request)).id,card.id);assert.equal((await accountBalance(f.env,buyer)).balance,'18.00');
 const price=await updatePricing(f.env,'test-admin',{version:catalog.priceVersion,plans:catalog.plans.map(p=>({id:p.id,price:p.id==='quarter'?'99':p.price}))});assert.equal((await buyGift(f.env,buyer,request)).value,'2.00');
 const raw=await readGift(f.env,card.code);assert.throws(()=>giftClaimStatements(f.env,raw,recipient,crypto.randomUUID(),'',Date.now(),crypto.randomUUID()),/gift_subscription_only/);
 const claim={code:card.code,idempotency:crypto.randomUUID()},received=await redeemGift(f.env,recipient,claim),repeat=await redeemGift(f.env,recipient,claim);assert.equal(received.kind,'subscription');assert.equal(received.record.months,3);assert.equal(repeat.record.expiresAt,received.record.expiresAt);assert.equal(repeat.repeated,true);assert.equal((await accountBalance(f.env,recipient)).balance,'0.00');
 const activeExpiry=addMonths(Date.now(),12);f.sql.prepare('INSERT INTO account_memberships VALUES(?,?,?)').run(buyer,0,activeExpiry);const monthly=await buyGift(f.env,buyer,{kind:'subscription',plan:'month',priceVersion:price.priceVersion,idempotency:crypto.randomUUID()}),pending=await reserve('month');f.sql.prepare("UPDATE membership_purchases SET payment_method='chain' WHERE id=?").run(pending.id);
 await assert.rejects(()=>redeemGift(f.env,buyer,{code:monthly.code,idempotency:crypto.randomUUID()}),/gift_pending_order/);assert.equal((await giftPreview(f.env,buyer,{code:monthly.code,orderId:pending.id})).redeemable,true);const before=await accountBalance(f.env,buyer),fulfilled=await redeemGift(f.env,buyer,{code:monthly.code,idempotency:crypto.randomUUID(),orderId:pending.id});assert.equal(fulfilled.record.expiresAt,addMonths(activeExpiry,1));assert.deepEqual(await accountBalance(f.env,buyer),before);assert.equal(f.sql.prepare('SELECT cancel_reason FROM membership_purchases WHERE id=?').get(pending.id).cancel_reason,'subscription_gift');assert.ok(f.sql.prepare('SELECT cancel_version FROM membership_account_state WHERE account_id=?').get(buyer).cancel_version>0);
 const history=await orderHistory(f.env,{accountId:recipient});assert.ok(history.orders.some(o=>o.record_type==='subscription_redemption'&&o.months===3));assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_balance_events WHERE kind='gift_credit'").get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_subscription_gift_redemptions').get().n,2);
 console.log('PASS locked plan prices, single-use subscription claims, duration extension, cash isolation, pending invoice guards and redemption history');
}finally{f.close()}
