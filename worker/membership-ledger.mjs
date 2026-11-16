import {hash} from './mcp-common.mjs';
import {HDKey} from '@scure/bip32';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {keccak_256} from '@noble/hashes/sha3.js';
export const PLAN_RANK={month:1,'half-year':2,year:3,permanent:4};
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
export async function quotePurchase(env,accountId,plan){
 const now=Date.now(),state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',accountId),membership=await first(env,'SELECT * FROM account_memberships WHERE account_id=?',accountId);
 if(membership?.permanent)throw error('already_permanent');
 const active=membership?.expires_at>now,current=state?.plan||'',rank=PLAN_RANK[plan.id];
 if(active&&current&&rank<PLAN_RANK[current])throw error('downgrade_not_supported');
 const kind=active&&current&&rank>PLAN_RANK[current]?'upgrade':active&&current===plan.id?'renewal':'purchase';let credit=0n;
 if(kind==='upgrade'){const lots=(await env.DB.prepare('SELECT * FROM membership_value_lots WHERE account_id=? AND consumed_at IS NULL AND ends_at>?').bind(accountId,now).all()).results;for(const lot of lots){const remaining=BigInt(Math.max(0,lot.ends_at-Math.max(now,lot.starts_at))),duration=BigInt(lot.ends_at-lot.starts_at);if(duration>0n)credit+=BigInt(lot.units)*remaining/duration}}
 // Excess prepaid value stays as spendable member balance when an upgrade settles.
 const list=10000n;return {kind,list_units:String(list),credit_units:String(credit),amount:String(credit>=list?0n:list-credit),state_version:state?.version||0};
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
export async function applyBalance(env,accountId,{explicit=false,orderId}={}){
 for(let attempt=0;attempt<6;attempt++){
 await expirePurchase(env,accountId);
 const order=await first(env,'SELECT * FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL',accountId);if(!order){if(explicit)throw error('order_unavailable');return}if(orderId&&order.id!==orderId)throw error('order_changed');
 const state=await first(env,'SELECT * FROM membership_account_state WHERE account_id=?',accountId);if(!state||(!explicit&&state.cancel_version>state.ack_version))return;
 const balance=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',accountId),member=await first(env,'SELECT * FROM account_memberships WHERE account_id=?',accountId);if(!balance||BigInt(balance.units)<BigInt(order.amount)){if(explicit)throw error('insufficient_balance');return;}
 if(member?.permanent||state.version!==order.state_version){await env.DB.prepare("UPDATE membership_purchases SET cancelled_at=?,cancel_reason='membership_changed' WHERE id=? AND settled_at IS NULL").bind(Date.now(),order.id).run();return}
 const now=Date.now(),start=order.kind==='renewal'?Math.max(now,member?.expires_at||0):now,expires=order.months?addMonths(start,order.months):0,excess=BigInt(order.credit_units)>BigInt(order.list_units)?BigInt(order.credit_units)-BigInt(order.list_units):0n,next=String(BigInt(balance.units)-BigInt(order.amount)+excess),assertion=crypto.randomUUID();
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_balances WHERE account_id=? AND units=?) AND EXISTS(SELECT 1 FROM membership_account_state WHERE account_id=? AND version=? AND cancel_version=? AND ack_version=? AND (?=1 OR cancel_version<=ack_version)) AND EXISTS(SELECT 1 FROM membership_purchases WHERE id=? AND settled_at IS NULL AND cancelled_at IS NULL AND expires_at>?) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)').bind(assertion,accountId,balance.units,accountId,state.version,state.cancel_version,state.ack_version,explicit?1:0,order.id,now,accountId),
 env.DB.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').bind(next,accountId),
 env.DB.prepare('INSERT INTO membership_balance_events VALUES(?,?,\'debit\',?,NULL,NULL,NULL,?,?)').bind('purchase:'+order.id,accountId,order.amount,order.id,now),
 env.DB.prepare("INSERT INTO membership_balance_events VALUES(?,?,'upgrade_excess',?,NULL,NULL,NULL,?,?)").bind('excess:'+order.id,accountId,String(excess),order.id,now),
 env.DB.prepare('INSERT INTO account_memberships VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET permanent=excluded.permanent,expires_at=excluded.expires_at').bind(accountId,order.months?0:1,expires),
 env.DB.prepare('UPDATE membership_account_state SET plan=?,version=version+1,ack_version=CASE WHEN ?=1 THEN cancel_version ELSE ack_version END,needs_ack=CASE WHEN ?=1 THEN 0 ELSE needs_ack END WHERE account_id=?').bind(order.plan,explicit?1:0,explicit?1:0,accountId),
 env.DB.prepare('UPDATE membership_value_lots SET consumed_at=? WHERE account_id=? AND consumed_at IS NULL AND ?=\'upgrade\'').bind(now,accountId,order.kind),
 env.DB.prepare('INSERT INTO membership_value_lots VALUES(?,?,?,?,?,NULL)').bind(order.id,accountId,start,expires||null,order.list_units),
 env.DB.prepare('INSERT INTO membership_changes VALUES(?,?,?,?,?)').bind(order.id,accountId,order.months?0:1,expires,now),
 env.DB.prepare('UPDATE membership_purchases SET settled_at=? WHERE id=?').bind(now,order.id),
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
export async function purchaseView(env,order){if(!order)return order;const b=await first(env,'SELECT units FROM membership_balances WHERE account_id=?',order.account_id),available=BigInt(b?.units||0),due=BigInt(order.amount);return {...order,price:money(order.list_units),upgradeCredit:money(order.credit_units),required:money(order.amount),received:money(available<due?available:due),remaining:money(available>=due?0n:due-available),balance:money(available)}}
