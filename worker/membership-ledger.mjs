import {couponDiscount,validPurchasePrice} from './membership-coupons.mjs';
import {plans,priceUnits,PRICE_VERSION} from './membership-plans.mjs';
import {hash} from './mcp-common.mjs';
import {HDKey} from '@scure/bip32';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {keccak_256} from '@noble/hashes/sha3.js';
export const money=units=>{const n=BigInt(units||0);return (n/1000000n).toString()+'.'+(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0')};
export function deriveAddress(xpub,index){const key=HDKey.fromExtendedKey(xpub);if(key.privateKey)throw Error('Public key required');const child=key.deriveChild(index),bytes=secp256k1.Point.fromBytes(child.publicKey).toBytes(false);return '0x'+Array.from(keccak_256(bytes.slice(1)).slice(-20),b=>b.toString(16).padStart(2,'0')).join('')}
export function addMonths(time,months){const d=new Date(time),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.getTime()}
const error=(code,status=409)=>Object.assign(Error(code),{status});
const first=(env,q,...p)=>env.DB.prepare(q).bind(...p).first();
export async function ensureWallet(env,accountId){
 const offset=Number(env.MEMBERSHIP_ADDRESS_OFFSET||0);if(!env.MEMBERSHIP_XPUB||!Number.isSafeInteger(offset)||offset<0||offset>=2147483647)throw error('invalid_wallet_configuration',503);
 const fingerprint=await hash(env.MEMBERSHIP_XPUB);await env.DB.prepare('INSERT OR IGNORE INTO membership_wallet_config VALUES(1,?,?)').bind(fingerprint,offset).run();
 const saved=await first(env,'SELECT * FROM membership_wallet_config WHERE id=1');if(saved.wallet_hash!==fingerprint||saved.address_offset!==offset)throw error('wallet_configuration_changed');
 let wallet=await first(env,'SELECT * FROM membership_account_wallets WHERE account_id=?',accountId);
 if(!wallet){const marker='account:'+accountId;await env.DB.prepare('INSERT OR IGNORE INTO membership_addresses(order_id) VALUES(?)').bind(marker).run();const row=await first(env,'SELECT id FROM membership_addresses WHERE order_id=?',marker),address=deriveAddress(env.MEMBERSHIP_XPUB,row.id+offset),now=Date.now();
 await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO membership_address_owners VALUES(?,?,?,?)').bind(row.id,address,accountId,now),env.DB.prepare('INSERT OR IGNORE INTO membership_account_wallets VALUES(?,?,?,?)').bind(accountId,row.id,address,now)]);wallet=await first(env,'SELECT * FROM membership_account_wallets WHERE account_id=?',accountId)}
 await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO membership_balances VALUES(?,'0')").bind(accountId),env.DB.prepare('INSERT OR IGNORE INTO membership_account_state(account_id) VALUES(?)').bind(accountId)]);return wallet;
}
export async function expirePurchase(env,accountId){await env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='expired' WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL AND expires_at<=?").bind(Date.now(),accountId,Date.now()).run()}
export async function quotePurchase(env,accountId,plan,code=''){
 const now=Date.now(),state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',accountId),membership=await first(env,'SELECT * FROM account_memberships WHERE account_id=?',accountId);
 if(membership?.permanent)throw error('already_permanent');
 const list=priceUnits[plan.id];if(!list)throw error('invalid_plan',400);
 const discount=await couponDiscount(env,accountId,plan.id,list,code);return {priceVersion:PRICE_VERSION,kind:membership?.expires_at>now?'renewal':'purchase',list_units:list,credit_units:'0',...discount,amount:String(BigInt(list)-BigInt(discount.discount_units)),state_version:state?.version||0};
}
export async function cancelPurchase(env,accountId,id){
 for(let attempt=0;attempt<4;attempt++){
 const order=await first(env,'SELECT * FROM membership_purchases WHERE id=? AND account_id=?',id,accountId);if(!order)throw error('not_found',404);if(order.settled_at)throw error('order_already_paid');if(order.cancelled_at)return order;
 const now=Date.now(),assertion=crypto.randomUUID();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_purchases WHERE id=? AND account_id=? AND settled_at IS NULL AND cancelled_at IS NULL)').bind(assertion,id,accountId),
 env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='user' WHERE id=?").bind(now,id),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);return first(env,'SELECT * FROM membership_purchases WHERE id=?',id)}catch(e){if(attempt===3)throw e}
 }
}
export async function chainFunding(env,order){const rows=(await env.DB.prepare("SELECT units FROM membership_balance_events WHERE account_id=? AND kind='credit' AND rowid>?").bind(order.account_id,order.funding_cursor||0).all()).results;return rows.reduce((sum,row)=>sum+BigInt(row.units),0n)}
export async function applyBalance(env,accountId,{explicit=false,orderId}={}){
 for(let attempt=0;attempt<6;attempt++){
 await expirePurchase(env,accountId);
 const order=await first(env,'SELECT * FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL',accountId);if(!order){if(explicit)throw error('order_unavailable');return}if(orderId&&order.id!==orderId)throw error('order_changed');
 const plan=plans.find(p=>p.id===order.plan);if(!plan||order.months!==plan.months||!validPurchasePrice(order,plan)||!['purchase','renewal'].includes(order.kind)){await env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='billing_changed' WHERE id=? AND settled_at IS NULL AND cancelled_at IS NULL").bind(Date.now(),order.id).run();if(explicit)throw error('order_unavailable');return}
 if(!explicit&&order.payment_method==='unselected')return;
 if(!explicit&&order.payment_method==='chain'&&(await chainFunding(env,order))<BigInt(order.amount))return;
 const state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',accountId);if(!state||(!explicit&&state.cancel_version>state.ack_version))return;
 const balance=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',accountId),member=await first(env,'SELECT * FROM account_memberships WHERE account_id=?',accountId);if(!balance||BigInt(balance.units)<BigInt(order.amount)){if(explicit)throw error('insufficient_balance');return;}
 if(member?.permanent||state.version!==order.state_version){await env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='membership_changed' WHERE id=? AND settled_at IS NULL").bind(Date.now(),order.id).run();return}
 // Every package adds its full duration to the existing expiry, regardless of prior package.
 const now=Date.now(),start=Math.max(now,member?.expires_at||0),expires=addMonths(start,plan.months),next=String(BigInt(balance.units)-BigInt(order.amount)),assertion=crypto.randomUUID();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_account_state WHERE account_id=? AND version=? AND cancel_version=? AND ack_version=? AND (?=1 OR cancel_version<=ack_version)) AND EXISTS(SELECT 1 FROM membership_purchases WHERE id=? AND payment_method=? AND funding_cursor=? AND settled_at IS NULL AND cancelled_at IS NULL AND expires_at>?) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)').bind(assertion,accountId,balance.units,accountId,state.version,state.cancel_version,state.ack_version,explicit?1:0,order.id,order.payment_method,order.funding_cursor,now,accountId),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(next,accountId),
 env.DB.prepare('INSERT INTO membership_balance_events VALUES(?,?,\'debit\',?,NULL,NULL,NULL,?,?)').bind('purchase:'+order.id,accountId,order.amount,order.id,now),
 env.DB.prepare('INSERT INTO account_memberships VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET permanent=excluded.permanent,expires_at=excluded.expires_at').bind(accountId,0,expires),
 env.DB.prepare('UPDATE membership_account_state SET plan=?,version=version+1,ack_version=CASE WHEN ?=1 THEN cancel_version ELSE ack_version END,needs_ack=CASE WHEN ?=1 THEN 0 ELSE needs_ack END WHERE account_id=?').bind(order.plan,explicit?1:0,explicit?1:0,accountId),
 env.DB.prepare('INSERT INTO membership_changes VALUES(?,?,?,?,?)').bind(order.id,accountId,0,expires,now),
 env.DB.prepare("UPDATE membership_purchases SET settled_at=?,payment_method=CASE WHEN ?=1 THEN 'balance' ELSE payment_method END WHERE id=?").bind(now,explicit?1:0,order.id),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);return}catch(e){if(attempt===5)throw e}
 }
}
export async function creditTransfer(env,c,log){
 if(c.decimals!==6||log.removed||log.address?.toLowerCase()!==c.token.toLowerCase()||log.topics?.[0]!=='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'||log.topics.length!==3||!/^0x[0-9a-fA-F]{64}$/.test(log.data))return;
 const address='0x'+log.topics[2].slice(-40).toLowerCase(),owner=await first(env,'SELECT * FROM membership_address_owners WHERE address=?',address);if(!owner)return;
 const accountId=owner.account_id,amount=BigInt(log.data).toString(),tx=log.transactionHash,index=Number(BigInt(log.logIndex)),key=c.chainId+':'+tx+':'+index;
 if(BigInt(amount)===0n)return;
 await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO membership_balances VALUES(?,'0')").bind(accountId),env.DB.prepare('INSERT OR IGNORE INTO membership_account_state(account_id) VALUES(?)').bind(accountId)]);
 for(let attempt=0;attempt<6;attempt++){
 if(await first(env,'SELECT 1 FROM membership_receipts WHERE chain_id=? AND tx=? AND log_index=?',c.chainId,tx,index)){await applyBalance(env,accountId);return}
 const balance=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',accountId),state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',accountId),live=await first(env,'SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL',accountId),guard=state.cancel_version>state.ack_version,now=Date.now(),assertion=crypto.randomUUID();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_account_state WHERE account_id=? AND cancel_version=? AND ack_version=?) AND NOT EXISTS(SELECT 1 FROM membership_receipts WHERE chain_id=? AND tx=? AND log_index=?)').bind(assertion,accountId,balance.units,accountId,state.cancel_version,state.ack_version,c.chainId,tx,index),
 env.DB.prepare('INSERT INTO membership_receipts VALUES(?,?,?,\'\',?,?,?,?)').bind(c.chainId,tx,index,amount,Number(BigInt(log.blockNumber)),live?'credited':'account_unavailable',now),
 env.DB.prepare('INSERT INTO membership_balance_events VALUES(?,?,\'credit\',?,?,?,?,\'\',?)').bind(key,accountId,amount,c.chainId,tx,index,now),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(String(BigInt(balance.units)+BigInt(amount)),accountId),
 env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='late_payment' WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL AND ?=1").bind(now,accountId,guard?1:0),
 env.DB.prepare('UPDATE membership_account_state SET needs_ack=1 WHERE account_id=? AND ?=1').bind(accountId,guard?1:0),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion)
 ]);if(live&&!guard)await applyBalance(env,accountId);return}catch(e){if(attempt===5)throw e}
 }
}
export async function purchaseView(env,order){if(!order)return order;const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',order.account_id),available=BigInt(b?.units||0),due=BigInt(order.amount),funded=order.settled_at?due:order.payment_method==='chain'?await chainFunding(env,order):available;return {...order,price:money(order.list_units),discount:money(order.discount_units||'0'),required:money(order.amount),received:money(funded<due?funded:due),remaining:money(funded>=due?0n:due-funded),balance:money(available)}}
