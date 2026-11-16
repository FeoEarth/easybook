import {hash} from './mcp-common.mjs';
import {money,billingError} from './membership-money.mjs';
import {accountBalance} from './membership-bonus.mjs';
const first=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const columns='id,purchaser_id,units,created_at,redeemed_at,redeemed_by,redeem_order,revoked_at';
export const giftView=card=>({id:card.id,purchaserId:card.purchaser_id,amount:card.units,value:money(card.units),createdAt:card.created_at,status:card.revoked_at?'revoked':card.redeemed_at?'redeemed':'available',redeemedAt:card.redeemed_at,revokedAt:card.revoked_at});
export async function giftCode(env,card){
 if(!/^[0-9a-f]{64}$/.test(env.MEMBERSHIP_GIFT_KEY||''))throw billingError('gift_service_unavailable',503);
 const bytes=Uint8Array.from(env.MEMBERSHIP_GIFT_KEY.match(/../g),x=>parseInt(x,16)),key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']),signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('easybook-gift-v1:'+card.id+':'+card.purchaser_id))),hex=Array.from(signature.slice(0,20),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
 return 'EBGC-'+hex.match(/.{8}/g).join('-');
}
function normalizeCode(value){if(typeof value!=='string'||value.length>80)throw billingError('gift_invalid');const code=value.toUpperCase().replace(/[\s-]/g,'');if(!/^EBGC[A-F0-9]{40}$/.test(code))throw billingError('gift_invalid');return code}
export async function giftRateLimit(env,account){const now=Date.now(),bucket='gift:'+account+':'+Math.floor(now/60000),row=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+120000).first();if(row.count>40)throw billingError('rate_limited',429)}
async function initBalance(env,account){await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO membership_balances VALUES(?,'0')").bind(account),env.DB.prepare("INSERT OR IGNORE INTO membership_bonus_balances VALUES(?,'0')").bind(account),env.DB.prepare('INSERT OR IGNORE INTO membership_account_state(account_id) VALUES(?)').bind(account)])}
export async function readGift(env,code){const digest=await hash(normalizeCode(code)),card=await first(env,'SELECT * FROM membership_gift_cards WHERE code_hash=?',digest);if(!card||card.revoked_at)throw billingError('gift_unavailable',409);if(card.redeemed_at)throw billingError('gift_already_used',409);return card}
export async function listGifts(env,account){const cards=(await env.DB.prepare('SELECT '+columns+' FROM membership_gift_cards WHERE purchaser_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(account).all()).results;return {cards:cards.map(giftView),...await accountBalance(env,account)}}
export async function revealGift(env,account,id){const card=await first(env,'SELECT * FROM membership_gift_cards WHERE id=? AND purchaser_id=?',id,account);if(!card)throw billingError('not_found',404);let code;if(!card.redeemed_at&&!card.revoked_at){code=await giftCode(env,card);if(await hash(normalizeCode(code))!==card.code_hash)throw billingError('gift_service_unavailable',503)}return {...giftView(card),...(code?{code}:{})}}
export async function buyGift(env,account,body){
 if(!uuid(body?.idempotency)||!['number','string'].includes(typeof body.amount)||!/^([1-9][0-9]{0,5})$/.test(String(body.amount)))throw billingError('invalid_gift_amount');const units=String(BigInt(body.amount)*1000000n);
 const old=await first(env,'SELECT * FROM membership_gift_cards WHERE purchaser_id=? AND request_id=?',account,body.idempotency);if(old){if(old.units!==units)throw billingError('idempotency_conflict',409);return revealGift(env,account,old.id)}
 const card={id:crypto.randomUUID(),purchaser_id:account,units},code=await giftCode(env,card),digest=await hash(normalizeCode(code));await initBalance(env,account);
 for(let attempt=0;attempt<6;attempt++){
 const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',account),g=await first(env,'SELECT units FROM membership_bonus_balances WHERE account_id=?',account);if(BigInt(b.units)-BigInt(g.units)<BigInt(units)){const prior=await first(env,'SELECT id,units FROM membership_gift_cards WHERE purchaser_id=? AND request_id=?',account,body.idempotency);if(prior){if(prior.units!==units)throw billingError('idempotency_conflict',409);return revealGift(env,account,prior.id)}throw billingError('insufficient_cash_balance',409)}const assertion=crypto.randomUUID(),now=Date.now();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_bonus_balances WHERE account_id=? AND units=?)').bind(assertion,account,account,b.units,account,g.units),
 env.DB.prepare('INSERT INTO membership_gift_cards(id,purchaser_id,units,code_hash,request_id,created_at) VALUES(?,?,?,?,?,?)').bind(card.id,account,units,digest,body.idempotency,now),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(String(BigInt(b.units)-BigInt(units)),account),
 env.DB.prepare("INSERT INTO membership_balance_events VALUES(?,?,'gift_purchase',?,NULL,NULL,NULL,?,?)").bind('gift_purchase:'+card.id,account,units,card.id,now),
 env.DB.prepare("INSERT INTO membership_billing_audit VALUES(?,?,'gift_purchased',?,?)").bind(crypto.randomUUID(),account,JSON.stringify({cardId:card.id,units}),now),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);return {...giftView({...card,created_at:now}),code}}catch(e){const prior=await first(env,'SELECT * FROM membership_gift_cards WHERE purchaser_id=? AND request_id=?',account,body.idempotency);if(prior){if(prior.units!==units)throw billingError('idempotency_conflict',409);return revealGift(env,account,prior.id)}if(attempt===5)throw e}
 }
}
// Included in the SAME transaction as the balance credit or the membership settlement.
export function giftClaimStatements(env,card,account,request,orderId,now,assertion){return [
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_gift_cards WHERE id=? AND code_hash=? AND units=? AND redeemed_at IS NULL AND revoked_at IS NULL)').bind(assertion+'-gift',card.id,card.code_hash,card.units),
 env.DB.prepare('UPDATE membership_gift_cards SET redeemed_by=?,redeemed_at=?,redeem_request=?,redeem_order=? WHERE id=?').bind(account,now,request,orderId||'',card.id),
 env.DB.prepare("INSERT INTO membership_balance_events VALUES(?,?,'gift_credit',?,NULL,NULL,NULL,?,?)").bind('gift_redeem:'+card.id,account,card.units,orderId||'',now),
 env.DB.prepare("INSERT INTO membership_billing_audit VALUES(?,?,'gift_redeemed',?,?)").bind(crypto.randomUUID(),account,JSON.stringify({cardId:card.id,units:card.units,orderId:orderId||null}),now),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion+'-gift')
 ]}
export async function redeemGift(env,account,body){
 if(!uuid(body?.idempotency))throw billingError('invalid_request');const digest=await hash(normalizeCode(body.code));await initBalance(env,account);
 for(let attempt=0;attempt<6;attempt++){
 const card=await first(env,'SELECT * FROM membership_gift_cards WHERE code_hash=?',digest),prior=await first(env,'SELECT id FROM membership_gift_cards WHERE redeemed_by=? AND redeem_request=?',account,body.idempotency);if(prior&&prior.id!==card?.id)throw billingError('idempotency_conflict',409);if(!card||card.revoked_at)throw billingError('gift_unavailable',409);
 if(card.redeemed_at){if(card.redeemed_by===account&&card.redeem_request===body.idempotency)return {redeemed:true,repeated:true,value:money(card.units),...await accountBalance(env,account)};throw billingError('gift_already_used',409)}
 const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',account),assertion=crypto.randomUUID(),now=Date.now();try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL) AND EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?)').bind(assertion,account,account,b.units),
 ...giftClaimStatements(env,card,account,body.idempotency,'',now,assertion),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(String(BigInt(b.units)+BigInt(card.units)),account),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);return {redeemed:true,value:money(card.units),...await accountBalance(env,account)}}catch(e){if(attempt===5)throw e}
 }
}
export async function giftPreview(env,account,body){const card=await readGift(env,body?.code),balances=await accountBalance(env,account);let required='0';if(body.orderId){const order=await first(env,'SELECT * FROM membership_purchases WHERE id=? AND account_id=?',body.orderId,account);if(!order||order.cancelled_at||order.settled_at||order.expires_at<=Date.now())throw billingError('order_unavailable',409);required=order.amount}const due=BigInt(required),face=BigInt(card.units),balanceUnits=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',account),available=BigInt(balanceUnits?.units||'0');return {value:money(face),used:money(face<due?face:due),remainder:money(face>due?face-due:0n),balanceContribution:money(due>face?due-face:0n),sufficient:face+available>=due,required:money(due),...balances}}
export async function adminGiftCards(env){return {cards:(await env.DB.prepare('SELECT '+columns+',revoked_by,revoke_reason FROM membership_gift_cards ORDER BY created_at DESC,id DESC LIMIT 100').all()).results.map(c=>({...giftView(c),redeemedBy:c.redeemed_by,redeemOrder:c.redeem_order,revokedBy:c.revoked_by,revokeReason:c.revoke_reason}))}}
export async function revokeGift(env,actor,id,body){if(!uuid(id)||typeof body?.reason!=='string'||!body.reason.trim()||body.reason.trim().length>240)throw billingError('invalid_request');const reason=body.reason.trim();for(let attempt=0;attempt<6;attempt++){
 const card=await first(env,'SELECT * FROM membership_gift_cards WHERE id=?',id);if(!card)throw billingError('not_found',404);if(card.revoked_at)return {revoked:true,repeated:true};if(card.redeemed_at)throw billingError('gift_already_used',409);await initBalance(env,card.purchaser_id);const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',card.purchaser_id),now=Date.now(),assertion=crypto.randomUUID();try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_gift_cards WHERE id=? AND redeemed_at IS NULL AND revoked_at IS NULL) AND EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?)').bind(assertion,id,card.purchaser_id,b.units),
 env.DB.prepare('UPDATE membership_gift_cards SET revoked_at=?,revoked_by=?,revoke_reason=? WHERE id=?').bind(now,actor,reason,id),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(String(BigInt(b.units)+BigInt(card.units)),card.purchaser_id),
 env.DB.prepare("INSERT INTO membership_balance_events VALUES(?,?,'gift_refund',?,NULL,NULL,NULL,?,?)").bind('gift_refund:'+id,card.purchaser_id,card.units,id,now),
 env.DB.prepare("INSERT INTO membership_billing_audit VALUES(?,?,'gift_revoked',?,?)").bind(crypto.randomUUID(),actor,JSON.stringify({cardId:id,units:card.units,purchaserId:card.purchaser_id,reason}),now),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);return {revoked:true,refunded:money(card.units)}}catch(e){if(attempt===5)throw e}
 }}
