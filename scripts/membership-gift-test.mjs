// Opt-in isolated regression coverage; never run against production.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {buyGift,redeemGift,revealGift,readGift,revokeGift} from '../worker/membership-gifts.mjs';
import {accountBalance} from '../worker/membership-bonus.mjs';
import {applyBalance} from '../worker/membership-ledger.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {orderHistory} from '../worker/membership-history.mjs';
import {PRICE_VERSION} from '../worker/membership-plans.mjs';
const f=await fixture(),buyer=f.account,recipient=crypto.randomUUID();
const call=(path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const reserve=async plan=>{const r=await call('/orders',{plan,chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),reserveOnly:true});assert.ok(r.ok,await r.clone().text());return r.json()};
try{
 f.sql.prepare('INSERT INTO accounts VALUES(?,?,?,NULL)').run(recipient,'Gift recipient',Date.now());await call('');
 f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('25000000',buyer);f.sql.prepare('UPDATE membership_bonus_balances SET units=? WHERE account_id=?').run('5000000',buyer);
 const request={amount:'10',idempotency:crypto.randomUUID()},card=await buyGift(f.env,buyer,request);assert.equal((await buyGift(f.env,buyer,request)).id,card.id);assert.deepEqual(await accountBalance(f.env,buyer),{balance:'15.00',bonusBalance:'5.00'});
 await assert.rejects(()=>revealGift(f.env,recipient,card.id),/not_found/);assert.equal((await revealGift(f.env,buyer,card.id)).code,card.code);
 const claim={code:card.code,idempotency:crypto.randomUUID()};await redeemGift(f.env,recipient,claim);await redeemGift(f.env,recipient,claim);assert.deepEqual(await accountBalance(f.env,recipient),{balance:'10.00',bonusBalance:'0.00'});await assert.rejects(()=>redeemGift(f.env,buyer,{code:card.code,idempotency:crypto.randomUUID()}),/gift_already_used/);
 const payCard=await buyGift(f.env,buyer,{amount:'5',idempotency:crypto.randomUUID()}),order=await reserve('month');await applyBalance(f.env,buyer,{explicit:true,orderId:order.id,gift:await readGift(f.env,payCard.code)});
 assert.deepEqual(await accountBalance(f.env,buyer),{balance:'14.00',bonusBalance:'5.00'});assert.equal(f.sql.prepare('SELECT payment_method FROM membership_purchases WHERE id=?').get(order.id).payment_method,'gift_card');assert.equal(f.sql.prepare('SELECT redeem_order FROM membership_gift_cards WHERE id=?').get(payCard.id).redeem_order,order.id);
 const refundable=await buyGift(f.env,buyer,{amount:'2',idempotency:crypto.randomUUID()});await revokeGift(f.env,'test-admin',refundable.id,{reason:'Refund test'});await revokeGift(f.env,'test-admin',refundable.id,{reason:'Retry'});assert.equal((await accountBalance(f.env,buyer)).balance,'14.00');await assert.rejects(()=>readGift(f.env,refundable.code),/gift_unavailable/);await assert.rejects(()=>revokeGift(f.env,'test-admin',payCard.id,{reason:'Cannot refund spent card'}),/gift_already_used/);
 const rollbackCard=await buyGift(f.env,buyer,{amount:'1',idempotency:crypto.randomUUID()}),pending=await reserve('quarter');f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('0',buyer);f.sql.prepare('UPDATE membership_bonus_balances SET units=? WHERE account_id=?').run('0',buyer);await assert.rejects(async()=>applyBalance(f.env,buyer,{explicit:true,orderId:pending.id,gift:await readGift(f.env,rollbackCard.code)}),/insufficient_balance/);assert.equal(f.sql.prepare('SELECT redeemed_at FROM membership_gift_cards WHERE id=?').get(rollbackCard.id).redeemed_at,null);
 f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('5000000',buyer);f.sql.prepare('UPDATE membership_bonus_balances SET units=? WHERE account_id=?').run('5000000',buyer);await assert.rejects(()=>buyGift(f.env,buyer,{amount:'1',idempotency:crypto.randomUUID()}),/insufficient_cash_balance/);
 const history=await orderHistory(f.env,{accountId:buyer});assert.ok(history.orders.some(o=>o.record_type==='gift_purchase'));assert.ok(history.orders.some(o=>o.kind==='gift_credit'));assert.ok(!JSON.stringify(history).includes(payCard.code));assert.ok(history.orders.every(o=>o.account_id===buyer));
 console.log('PASS gift purchase/redeem idempotency, owner-only reveal, atomic membership payment, bonus exclusion, refunds, rollback and scoped history');
}finally{f.close()}
