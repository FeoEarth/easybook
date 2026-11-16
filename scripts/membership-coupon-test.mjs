// Local-only coupon integration coverage; uses the existing isolated fixture and mocked RPC.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {createCoupon,toggleCoupon} from '../worker/membership-coupons.mjs';
import {PRICE_VERSION} from '../worker/membership-plans.mjs';
const f=await fixture();
const call=(path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const ok=async r=>{assert.ok(r.ok,await r.clone().text());return r.json()};
const reserve=(plan,code,idempotency=crypto.randomUUID())=>call('/orders',{plan,chainId:137,priceVersion:PRICE_VERSION,idempotency,reserveOnly:true,couponCode:code}).then(ok);
try{
 assert.equal((await call('/coupons/admin')).status,404);
 const c=await createCoupon(f.env,'iodash-test',{code:'SAVE20',kind:'percent',percent:'20',maxUses:1,perAccountLimit:1});
 const q=await ok(await call('/quote?plan=month&coupon=save20'));assert.equal(q.required,'0.80');assert.equal(q.discount,'0.20');
 const key=crypto.randomUUID(),first=await reserve('month','SAVE20',key);assert.equal(first.payment_method,'unselected');assert.equal((await reserve('month','SAVE20',key)).id,first.id);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_coupon_uses').get().n,1);
 await ok(await call('/orders/'+first.id+'/cancel',{}));assert.ok(f.sql.prepare('SELECT released_at FROM membership_coupon_uses WHERE order_id=?').get(first.id).released_at);
 const pending=await reserve('month','SAVE20');f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('800000',f.account);
 await toggleCoupon(f.env,'iodash-test',c.id,false); // Locked orders survive deactivation.
 const paid=await ok(await call('/orders/'+pending.id+'/pay',{plan:'month',amount:'800000'}));assert.ok(paid.settled_at);
 await ok(await call('/orders/'+pending.id+'/pay',{}));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_balance_events WHERE order_id=? AND kind=?').get(pending.id,'debit').n,1);
 assert.ok(f.sql.prepare('SELECT redeemed_at FROM membership_coupon_uses WHERE order_id=?').get(pending.id).redeemed_at);
 assert.equal((await call('/quote?plan=month&coupon=SAVE20')).status,409);
 await createCoupon(f.env,'iodash-test',{code:'FREE100',kind:'percent',percent:'100',maxUses:1,perAccountLimit:1});
 const free=await reserve('quarter','FREE100');assert.equal(free.required,'0.00');await ok(await call(''));assert.equal(f.sql.prepare('SELECT settled_at FROM membership_purchases WHERE id=?').get(free.id).settled_at,null);
 assert.ok((await ok(await call('/orders/'+free.id+'/pay',{}))).settled_at);assert.equal((await ok(await call(''))).balance,'0.00');
 await createCoupon(f.env,'iodash-test',{code:'HALF125',kind:'fixed',amount:'1.25',plans:['half-year'],perAccountLimit:0});
 assert.equal((await call('/quote?plan=month&coupon=HALF125')).status,409);assert.equal((await ok(await call('/quote?plan=half-year&coupon=HALF125'))).required,'1.75');
 const capped=await createCoupon(f.env,'iodash-test',{code:'LASTONE',kind:'percent',percent:'50',maxUses:1,perAccountLimit:0});
 const final=await reserve('month','LASTONE'),another=crypto.randomUUID(),now=Date.now();
 await assert.rejects(()=>f.DB.batch([
 f.DB.prepare("INSERT INTO membership_purchases(id,account_id,plan,months,chain_id,token,amount,address,idempotency,created_at,expires_at,kind,list_units,credit_units,state_version,payment_method,coupon_id,coupon_code,discount_units) VALUES(?,?,'month',1,137,?,'500000',?,?,?,?,'purchase','1000000','0',0,'unselected',?,'LASTONE','500000')").bind(another,'other-account',final.token,final.address,crypto.randomUUID(),now,now+60000,capped.id),
 f.DB.prepare('INSERT INTO membership_coupon_uses(order_id,coupon_id,account_id,expires_at,created_at) VALUES(?,?,?,?,?)').bind(another,capped.id,'other-account',now+60000,now)
 ]),/coupon_unavailable/);
 assert.equal(f.sql.prepare('SELECT id FROM membership_purchases WHERE id=?').get(another),undefined);
 console.log('PASS coupon admin access, fixed/percent prices, reservations, release, locked orders, idempotent redemption, free confirmation and quota rollback');
}finally{f.close()}
