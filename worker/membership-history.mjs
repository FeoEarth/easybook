import {money} from './membership-money.mjs';
import {purchaseView} from './membership-ledger.mjs';

// Project existing ledger entries into read-only history; never create another credit.
export async function orderHistory(env,{accountId,admin=false}={}){
 const scoped=typeof accountId==='string';if(!scoped&&!admin)throw Error('account_required');
 const purchases=env.DB.prepare('SELECT * FROM membership_purchases'+(scoped?' WHERE account_id=?':'')+' ORDER BY created_at DESC,id DESC LIMIT 100');
 const credits=env.DB.prepare(`SELECT e.*,g.reason,COALESCE(r.bonus_units,'0') recharge_bonus_units
 FROM membership_balance_events e
 LEFT JOIN membership_bonus_grants g ON e.kind='admin_bonus' AND e.id='admin_bonus:'||g.id AND e.account_id=g.account_id
 LEFT JOIN membership_recharge_rewards r ON e.kind='credit' AND r.account_id=e.account_id AND r.chain_id=e.chain_id AND r.tx=e.tx AND r.log_index=e.log_index
 WHERE e.kind IN ('credit','admin_credit','admin_bonus') ${scoped?'AND e.account_id=?':''}
 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`);
 const results=await env.DB.batch([scoped?purchases.bind(accountId):purchases,scoped?credits.bind(accountId):credits]);
 const membership=await Promise.all(results[0].results.map(async row=>({...(admin?row:await purchaseView(env,row)),record_type:'membership'})));
 const balance=results[1].results.filter(row=>BigInt(row.units)>0n).map(row=>({
  id:'balance:'+row.id,ledger_id:row.id,record_type:'balance_credit',
  kind:row.kind==='credit'?'recharge':row.kind,account_id:row.account_id,
  amount:row.units,required:money(row.units),price:money(row.units),
  bonus:money(row.recharge_bonus_units),creditedTotal:money(BigInt(row.units)+BigInt(row.recharge_bonus_units)),
  payment_method:row.kind==='credit'?'chain':'admin',chain_id:row.chain_id,
  tx:row.tx,log_index:row.log_index,created_at:row.created_at,settled_at:row.created_at,
  status:'credited',reason:row.reason||(row.kind==='admin_bonus'?'管理员赠金':row.kind==='admin_credit'?'管理员加款':'链上充值入账')
 }));
 return {orders:[...membership,...balance].sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id)).slice(0,100)};
}
