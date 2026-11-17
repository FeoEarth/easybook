// Opt-in local regression coverage. No production RPC or signing; not run during deployment.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {planCatalog,updatePricing} from '../worker/membership-pricing.mjs';
import {bonusPolicy,updateBonusPolicy,grantBonus,accountBalance,adminUsers} from '../worker/membership-bonus.mjs';
import {creditTransfer} from '../worker/membership-ledger.mjs';
const f=await fixture();
const call=(path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{method:body?'POST':'GET',headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},...(body?{body:JSON.stringify(body)}:{})}),f.env);
const ok=async response=>{assert.ok(response.ok,await response.clone().text());return response.json()};
const reserve=async(plan,priceVersion)=>(await call('/orders',{plan,chainId:137,priceVersion,idempotency:crypto.randomUUID(),reserveOnly:true}));
try{
 const initial=await planCatalog(f.env),locked=await ok(await reserve('month',initial.priceVersion));
 const changed=await updatePricing(f.env,'test-admin',{version:initial.priceVersion,plans:initial.plans.map(p=>({id:p.id,price:p.id==='month'?'1.25':p.price}))});
 assert.equal((await call('/quote?plan=month').then(ok)).required,'1.25');
 assert.equal((await reserve('month',initial.priceVersion)).status,409);
 await assert.rejects(()=>updatePricing(f.env,'other-admin',{version:initial.priceVersion,plans:initial.plans}),/pricing_conflict/);
 const body={accountId:f.account,amount:'2',reason:'Regression credit',idempotency:crypto.randomUUID()};
 await grantBonus(f.env,'test-admin',body);await grantBonus(f.env,'test-admin',body);
 assert.deepEqual(await accountBalance(f.env,f.account),{balance:'2.00',bonusBalance:'2.00'});
 await assert.rejects(()=>grantBonus(f.env,'test-admin',{...body,amount:'3'}),/idempotency_conflict/);
 const paid=await ok(await call('/orders/'+locked.id+'/pay',{plan:'month',amount:'1000000'}));assert.ok(paid.settled_at);assert.equal(paid.required,'1.00');
 assert.deepEqual(await accountBalance(f.env,f.account),{balance:'1.00',bonusBalance:'1.00'});
 assert.equal((await adminUsers(f.env,f.account)).users[0].bonusBalance,'1.00');
 const off=await bonusPolicy(f.env);await updateBonusPolicy(f.env,'test-admin',{version:off.version,enabled:true,tiers:[{minAmount:'1',kind:'fixed',amount:'0.25',capAmount:'0'},{minAmount:'10',kind:'percent',percent:'10',capAmount:'2'}]});
 const order=await ok(await reserve('month',changed.priceVersion));await ok(await call('/orders/'+order.id+'/fund',{chainId:137}));
 const chain=JSON.parse(f.env.MEMBERSHIP_NETWORKS).find(c=>c.chainId===137);
 const sameHash=(log,uppercase)=>({...log,transactionHash:'0x'+(uppercase?log.transactionHash.slice(2).toUpperCase():log.transactionHash.slice(2).toLowerCase())});
 const log=f.inject(order,{amount:'1000000',tx:'0x'+'ab'.repeat(32)});
 await creditTransfer(f.env,chain,log);
 await creditTransfer(f.env,chain,sameHash(log,true));
 await creditTransfer(f.env,chain,log);
 assert.ok((await ok(await call('/orders/'+order.id))).settled_at);
 assert.deepEqual(await accountBalance(f.env,f.account),{balance:'1.00',bonusBalance:'1.00'});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_recharge_rewards').get().n,1);
 assert.equal(f.sql.prepare("SELECT units FROM membership_balance_events WHERE kind='credit'").get().units,'1000000');
 assert.equal(f.sql.prepare("SELECT units FROM membership_balance_events WHERE kind='recharge_bonus'").get().units,'250000');

 const upperFirst=f.inject(order,{amount:'1000000',tx:'0x'+'CD'.repeat(32)});
 const canonical=sameHash(upperFirst,false);
 await creditTransfer(f.env,chain,upperFirst);
 await creditTransfer(f.env,chain,canonical);
 assert.equal(f.sql.prepare('SELECT tx FROM membership_receipts WHERE tx=? COLLATE NOCASE').get(upperFirst.transactionHash).tx,canonical.transactionHash);
 assert.deepEqual(await accountBalance(f.env,f.account),{balance:'2.25',bonusBalance:'1.25'});

 // Recreate a receipt and its ledger history as stored before hash canonicalization.
 for(const table of ['membership_receipts','membership_balance_events','membership_recharge_rewards']){
  f.sql.prepare('UPDATE '+table+' SET tx=? WHERE tx=?').run(upperFirst.transactionHash,canonical.transactionHash);
 }
 await creditTransfer(f.env,chain,canonical);
 await creditTransfer(f.env,chain,upperFirst);
 assert.deepEqual(await accountBalance(f.env,f.account),{balance:'2.25',bonusBalance:'1.25'});
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_receipts').get().n,2);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_balance_events WHERE kind='credit'").get().n,2);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_recharge_rewards').get().n,2);
 console.log('PASS versioned prices, locked quote settlement, grant idempotency, bonus consumption and duplicate receipt protection');
}finally{f.close()}
