import {ensureOrderCutoffs,chainOrderCutoff} from './membership-order-cutoff.mjs';
import {giftCode} from './membership-gifts.mjs';
import {normalizeGiftCode} from './membership-gift-codes.mjs';
import {planCatalog} from './membership-pricing.mjs';
import {hash} from './mcp-common.mjs';
import {money,billingError} from './membership-money.mjs';
const first=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const pending="settled_at IS NULL AND cancelled_at IS NULL";
export async function expireGiftOrders(env,account){await ensureOrderCutoffs(env.DB);await env.DB.prepare("UPDATE membership_gift_orders SET cancelled_at=?,cancel_reason='expired' WHERE account_id=? AND "+pending+' AND expires_at<=?').bind(Date.now(),account,Date.now()).run()}
export async function giftOrderFunds(env,order){const {lastEvent,before}=await chainOrderCutoff(env.DB,'membership_gift_orders',order);const rows=(await env.DB.prepare("SELECT units FROM membership_balance_events WHERE account_id=? AND kind='credit' AND rowid>? AND rowid<=COALESCE(?,9223372036854775807) AND created_at<COALESCE(?,9223372036854775807) AND rowid<COALESCE((SELECT rowid FROM membership_balance_events WHERE id=?),9223372036854775807)").bind(order.account_id,order.funding_cursor,lastEvent,before,'gift_purchase:'+order.id).all()).results;return rows.reduce((sum,r)=>sum+BigInt(r.units),0n)}
export async function giftOrderView(env,order){if(!order)return order;const card=order.settled_at?await first(env,'SELECT redeemed_at,revoked_at FROM membership_gift_cards WHERE id=?',order.id):null,b=await first(env,"SELECT b.units,COALESCE(g.units,'0') bonus FROM membership_balances b LEFT JOIN membership_bonus_balances g ON g.account_id=b.account_id WHERE b.account_id=?",order.account_id),available=BigInt(b?.units||'0'),cash=available-BigInt(b?.bonus||'0'),actual=order.payment_method==='chain'?await giftOrderFunds(env,order):0n,due=BigInt(order.amount),funded=order.settled_at?due:order.payment_method==='chain'?actual:cash;return {...order,code_hash:undefined,record_type:'gift_purchase_order',kind:'gift_purchase_order',cardStatus:card?(card.revoked_at?'revoked':card.redeemed_at?'redeemed':'available'):null,plan:order.card_plan,months:order.card_months,giftKind:order.card_kind,giftPlanName:order.card_plan_name,price:money(due),required:money(due),discount:'0.00',received:money(actual),rechargeBonus:'0.00',funded:money(funded),remaining:money(funded>=due?0n:due-funded),balance:money(available),cashBalance:money(cash),bonusBalance:money(b?.bonus||'0')}}
const giftOrderByKey=(env,account,key)=>first(env,'SELECT * FROM membership_gift_orders WHERE account_id=? AND idempotency=?',account,key);
const pendingGiftOrder=(env,account)=>first(env,'SELECT * FROM membership_gift_orders WHERE account_id=? AND '+pending,account);
const pendingMembership=(env,account)=>first(env,'SELECT * FROM membership_purchases WHERE account_id=? AND '+pending,account);
const issuedGiftByKey=(env,account,key)=>first(env,'SELECT id FROM membership_gift_cards WHERE purchaser_id=? AND request_id=?',account,key);

export async function reserveGiftOrder(env,account,body,wallet,chain){
 const key=body?.idempotency,kind=body?.kind;
 if(typeof key!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)||!['balance','subscription'].includes(kind))throw billingError('invalid_request');
 let units,plan,catalog;
 if(kind==='balance'){
  if(!['number','string'].includes(typeof body.amount)||!/^[1-9][0-9]{0,5}$/.test(String(body.amount)))throw billingError('invalid_gift_amount');
  units=String(BigInt(body.amount)*1000000n);
 }
 async function replay(order){
  if(order.card_kind!==kind||(kind==='subscription'?order.card_plan!==body.plan:order.amount!==units))throw billingError('idempotency_conflict',409);
  return giftOrderView(env,order);
 }
 async function conflict(order){
  throw Object.assign(billingError('pending_order_exists',409),{order:await giftOrderView(env,order)});
 }
 const old=await giftOrderByKey(env,account,key);
 if(old)return replay(old);
 if(await issuedGiftByKey(env,account,key)){
  // A matching reservation may have been created and settled since the first read.
  const reserved=await giftOrderByKey(env,account,key);
  if(reserved)return replay(reserved);
  throw billingError('idempotency_conflict',409);
 }
 if(kind==='subscription'){
  catalog=await planCatalog(env);
  if(body.priceVersion!==catalog.priceVersion)throw billingError('price_changed',409);
  plan=catalog.plans.find(p=>p.id===body.plan);
  if(!plan)throw billingError('invalid_plan');
  units=plan.units;
 }
 const existing=await pendingGiftOrder(env,account);
 if(existing){
  if(existing.idempotency===key)return replay(existing);
  return conflict(existing);
 }
 const member=await pendingMembership(env,account);
 if(member&&member.payment_method!=='unselected')throw billingError('gift_pending_order',409);
 const card={id:crypto.randomUUID(),purchaser_id:account,code_version:2,card_kind:kind};
 const digest=await hash(normalizeGiftCode(await giftCode(env,card)));
 const now=Date.now(),check=crypto.randomUUID();
 // A legacy direct purchase and a checkout reservation cannot share the same intent.
 const statements=[
  env.DB.prepare('INSERT INTO membership_assertions SELECT ?,NOT EXISTS(SELECT 1 FROM membership_gift_cards WHERE purchaser_id=? AND request_id=?)').bind(check,account,key)
 ];
 if(member)statements.push(env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='replaced' WHERE id=? AND payment_method='unselected' AND "+pending).bind(now,member.id));
 statements.push(
  env.DB.prepare('INSERT INTO membership_gift_orders(id,account_id,idempotency,card_kind,card_plan,card_months,card_plan_name,price_version,amount,code_hash,chain_id,token,address,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(card.id,account,key,kind,plan?.id||'',plan?.months||0,plan?.name||'',catalog?.priceVersion||'',units,digest,chain.chainId,chain.token.toLowerCase(),wallet.address,now,now+1800000),
  env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(check)
 );
 try{await env.DB.batch(statements)}catch(error){
  const prior=await giftOrderByKey(env,account,key);
  if(prior)return replay(prior);
  if(await issuedGiftByKey(env,account,key))throw billingError('idempotency_conflict',409);
  const competing=await pendingGiftOrder(env,account);
  if(competing){
   if(competing.idempotency===key)return replay(competing);
   return conflict(competing);
  }
  if(String(error.message).includes('pending_order_exists'))throw billingError('gift_pending_order',409);
  throw error;
 }
 return giftOrderView(env,await first(env,'SELECT * FROM membership_gift_orders WHERE id=?',card.id));
}
export async function cancelGiftOrder(env,account,id){await ensureOrderCutoffs(env.DB);for(let attempt=0;attempt<6;attempt++){const o=await first(env,'SELECT * FROM membership_gift_orders WHERE id=? AND account_id=?',id,account);if(!o)throw billingError('not_found',404);if(o.settled_at)throw billingError('order_already_paid',409);if(o.cancelled_at)return giftOrderView(env,o);const result=await env.DB.prepare("UPDATE membership_gift_orders SET cancelled_at=?,cancel_reason='user' WHERE id=? AND "+pending+' RETURNING *').bind(Date.now(),id).first();if(result)return giftOrderView(env,result)}throw billingError('order_changed',409)}
// Issuance uses the hash fixed at reservation: the scanner never needs a gift secret.
export async function settleGiftOrder(env,account,{explicit=false,orderId}={}){
 for(let attempt=0;attempt<6;attempt++){
 await expireGiftOrders(env,account);
 const o=orderId?await first(env,'SELECT * FROM membership_gift_orders WHERE id=? AND account_id=?',orderId,account):await pendingGiftOrder(env,account);
 if(o?.settled_at)return;
 if(!o||o.cancelled_at){if(explicit)throw billingError('order_unavailable',409);return}
 if(!explicit&&o.payment_method!=='chain')return;
 const state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',account);if(!state||(!explicit&&state.cancel_version>state.ack_version))return;if(!explicit&&(await giftOrderFunds(env,o))<BigInt(o.amount))return;
 const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',account);
 const g=await first(env,'SELECT units FROM membership_bonus_balances WHERE account_id=?',account);
 if(!b||!g||BigInt(b.units)-BigInt(g.units)<BigInt(o.amount)){
  if(!explicit)return;
  // A parallel confirmation may have charged exactly the remaining cash.
  const latest=await first(env,'SELECT settled_at,cancelled_at FROM membership_gift_orders WHERE id=? AND account_id=?',o.id,account);
  if(latest?.settled_at)return;
  if(!latest||latest.cancelled_at)throw billingError('order_unavailable',409);
  const issued=await issuedGiftByKey(env,account,o.idempotency);
  if(issued&&issued.id!==o.id)throw billingError('idempotency_conflict',409);
  throw billingError('insufficient_cash_balance',409);
 }
 const now=Date.now(),check=crypto.randomUUID();try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_bonus_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_account_state WHERE account_id=? AND cancel_version=? AND ack_version=? AND (?=1 OR cancel_version<=ack_version)) AND EXISTS(SELECT 1 FROM membership_gift_orders WHERE id=? AND payment_method=? AND funding_cursor=? AND settled_at IS NULL AND cancelled_at IS NULL AND expires_at>?)').bind(check,account,account,b.units,account,g.units,account,state.cancel_version,state.ack_version,explicit?1:0,o.id,o.payment_method,o.funding_cursor,now),
 env.DB.prepare('INSERT INTO membership_gift_cards(id,purchaser_id,units,code_hash,request_id,created_at,card_kind,card_plan,card_months,card_plan_name,price_version,code_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,2)').bind(o.id,account,o.amount,o.code_hash,o.idempotency,now,o.card_kind,o.card_plan,o.card_months,o.card_plan_name,o.price_version),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(String(BigInt(b.units)-BigInt(o.amount)),account),
 env.DB.prepare("INSERT INTO membership_balance_events VALUES(?,?,'gift_purchase',?,NULL,NULL,NULL,?,?)").bind('gift_purchase:'+o.id,account,o.amount,o.id,now),
 env.DB.prepare("UPDATE membership_gift_orders SET settled_at=?,payment_method=CASE WHEN ?=1 THEN 'balance' ELSE payment_method END WHERE id=?").bind(now,explicit?1:0,o.id),
 env.DB.prepare('UPDATE membership_account_state SET ack_version=CASE WHEN ?=1 THEN cancel_version ELSE ack_version END,needs_ack=CASE WHEN ?=1 THEN 0 ELSE needs_ack END WHERE account_id=?').bind(explicit?1:0,explicit?1:0,account),
 env.DB.prepare("INSERT INTO membership_billing_audit VALUES(?,?,'gift_purchased',?,?)").bind(crypto.randomUUID(),account,JSON.stringify({cardId:o.id,units:o.amount,kind:o.card_kind,plan:o.card_plan,months:o.card_months,paymentMethod:explicit?'balance':'chain'}),now),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(check)
 ]);return}catch(e){
  const old=await first(env,'SELECT settled_at FROM membership_gift_orders WHERE id=? AND account_id=?',o.id,account);
  if(old?.settled_at)return;
  // Older reservations can already conflict with a legacy direct purchase.
  // Leave the issued card and the credited cash intact and let automatic scans continue.
  const issued=await issuedGiftByKey(env,account,o.idempotency);
  if(issued&&issued.id!==o.id){
   if(explicit)throw billingError('idempotency_conflict',409);
   return;
  }
  if(attempt===5)throw e;
 }
 }
}
