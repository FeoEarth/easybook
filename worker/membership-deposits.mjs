import {money} from './membership-ledger.mjs';
export function topupUnits(value){if(!['string','number'].includes(typeof value))throw Object.assign(Error('invalid_topup_amount'),{status:400});const text=String(value??'');if(!/^[1-9][0-9]{0,8}$/.test(text))throw Object.assign(Error('invalid_topup_amount'),{status:400});return (BigInt(text)*1000000n).toString()}
export async function topupProgress(env,accountId,after){const rows=(await env.DB.prepare("SELECT units FROM membership_balance_events WHERE account_id=? AND kind='credit' AND rowid>?").bind(accountId,after).all()).results;const units=rows.reduce((sum,r)=>sum+BigInt(r.units),0n);return {received:money(units),receivedUnits:String(units),transfers:rows.length}}
export async function chainReceipts(env,accountId,cursor){
 let boundary=[];if(cursor){try{boundary=JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));if(boundary.length!==4||!Number.isSafeInteger(boundary[0])||boundary[0]<0||!Number.isSafeInteger(boundary[1])||!/^0x[0-9a-f]{64}$/i.test(boundary[2])||!Number.isSafeInteger(boundary[3])||boundary[3]<0)throw Error()}catch{throw Object.assign(Error('invalid_cursor'),{status:400})}}
 // The receipts table is the source of truth for actual on-chain amounts.
 // Legacy direct payments predate the balance ledger and must remain visible too.
 const sql=`WITH owned AS (
 SELECT r.* FROM membership_balance_events b JOIN membership_receipts r ON r.chain_id=b.chain_id AND r.tx=b.tx AND r.log_index=b.log_index WHERE b.account_id=? AND b.kind='credit'
 UNION ALL
 SELECT r.* FROM membership_receipts r JOIN membership_orders o ON o.id=r.order_id WHERE o.account_id=? AND NOT EXISTS(SELECT 1 FROM membership_balance_events b WHERE b.account_id=? AND b.kind='credit' AND b.chain_id=r.chain_id AND b.tx=r.tx AND b.log_index=r.log_index)
 ) SELECT chain_id,tx,log_index,amount,block,status,created_at FROM owned ${cursor?'WHERE (created_at,chain_id,tx,log_index)<(?,?,?,?)':''} ORDER BY created_at DESC,chain_id DESC,tx DESC,log_index DESC LIMIT 21`;
 const rows=(await env.DB.prepare(sql).bind(accountId,accountId,accountId,...boundary).all()).results,visible=rows.slice(0,20),last=visible.at(-1);
 return {receipts:visible.map(r=>({...r,amountUnits:r.amount,amount:money(r.amount)})),nextCursor:rows.length>20?btoa(JSON.stringify([last.created_at,last.chain_id,last.tx,last.log_index])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null};
}
