// Optional local regression source. Not executed during deployment.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {issueAdminGiftCards,revealAdminGift,exportAdminGiftBatch} from '../admin-worker/gift-issuance.mjs';
import {redeemGift,readGift,buyGift,revokeGift} from '../worker/membership-gifts.mjs';
import {grantBonus,accountBalance} from '../worker/membership-bonus.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {applyBalance} from '../worker/membership-ledger.mjs';
import {PRICE_VERSION} from '../worker/membership-plans.mjs';
const f=await fixture(),env={...f.env,IODASH_GIFT_ISSUE_KEY:'22'.repeat(32)},actor='test-admin',account=f.account;
const call=(path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},...(body?{body:JSON.stringify(body)}:{})}),env);
try{
 await call('');
 const request={kind:'balance',balanceType:'bonus',amount:'10',quantity:2,reason:'Gift bonus coverage',idempotency:crypto.randomUUID()},batch=await issueAdminGiftCards(env,actor,request),repeat=await issueAdminGiftCards(env,actor,request);
 assert.equal(batch.batch.id,repeat.batch.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_gift_cards').get().n,2);assert.equal((await accountBalance(env,account)).balance,'0.00');
 const card=batch.cards[0];assert.equal((await revealAdminGift(env,actor,card.id)).code,card.code);assert.ok(!f.sql.prepare('SELECT ciphertext FROM membership_admin_gift_secrets WHERE card_id=?').get(card.id).ciphertext.includes(card.code));
 await redeemGift(env,account,{code:card.code,idempotency:crypto.randomUUID()});assert.deepEqual(await accountBalance(env,account),{balance:'10.00',bonusBalance:'10.00'});
 const response=await call('/orders',{plan:'month',chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),reserveOnly:true});assert.ok(response.ok,await response.clone().text());const order=await response.json();await applyBalance(env,account,{explicit:true,orderId:order.id,gift:await readGift(env,batch.cards[1].code)});
 assert.deepEqual(await accountBalance(env,account),{balance:'19.00',bonusBalance:'19.00'});await assert.rejects(()=>buyGift(env,account,{amount:'1',idempotency:crypto.randomUUID()}),/insufficient_cash_balance/);
 const cash=await issueAdminGiftCards(env,actor,{kind:'balance',balanceType:'cash',amount:'7',quantity:2,reason:'Cash card coverage',idempotency:crypto.randomUUID()});await redeemGift(env,account,{code:cash.cards[0].code,idempotency:crypto.randomUUID()});assert.deepEqual(await accountBalance(env,account),{balance:'26.00',bonusBalance:'19.00'});
 await buyGift(env,account,{amount:'5',idempotency:crypto.randomUUID()});const before=await accountBalance(env,account);await revokeGift(env,actor,cash.cards[1].id,{reason:'Void a free card'});await revokeGift(env,actor,cash.cards[1].id,{reason:'Retry'});assert.deepEqual(await accountBalance(env,account),before);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_balance_events WHERE kind='gift_refund'").get().n,0);
 const exported=await exportAdminGiftBatch(env,actor,cash.batch.id);assert.ok(exported.cards.every(c=>!c.code));
 const grant={accountId:account,amount:'3',balanceType:'cash',reason:'Cash grant coverage',idempotency:crypto.randomUUID()};await grantBonus(env,actor,grant);await grantBonus(env,actor,grant);assert.deepEqual(await accountBalance(env,account),{balance:'24.00',bonusBalance:'19.00'});await assert.rejects(()=>grantBonus(env,actor,{...grant,balanceType:'bonus'}),/idempotency_conflict/);
 await grantBonus(env,actor,{...grant,amount:'2',balanceType:'bonus',idempotency:crypto.randomUUID()});assert.deepEqual(await accountBalance(env,account),{balance:'26.00',bonusBalance:'21.00'});
 const sub=await issueAdminGiftCards(env,actor,{kind:'subscription',plan:'quarter',priceVersion:PRICE_VERSION,quantity:1,reason:'Subscription issuance',idempotency:crypto.randomUUID()}),moneyBefore=await accountBalance(env,account),redeemed=await redeemGift(env,account,{code:sub.cards[0].code,idempotency:crypto.randomUUID()});assert.equal(redeemed.record.months,3);assert.deepEqual(await accountBalance(env,account),moneyBefore);
 console.log('PASS issuance idempotency, encrypted code recovery, bonus isolation, non-refundable free cards, typed grants and subscription cards');
}finally{f.close()}
