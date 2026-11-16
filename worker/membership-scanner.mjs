import {configuration,addMonths} from './membership.mjs';
import {requireRestoreAccess} from './security-checkpoint.mjs';
const topic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
async function rpc(c,method,params,fetcher){const r=await fetcher(c.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('RPC unavailable');const v=await r.json();if(v.error||v.result===undefined)throw Error('RPC error');return v.result}
const hex=n=>'0x'+n.toString(16);
export async function settle(env,c,log){
 if(log.removed||log.address?.toLowerCase()!==c.token.toLowerCase()||log.topics?.[0]!==topic||log.topics.length!==3||!/^0x[0-9a-fA-F]{64}$/.test(log.data))return;
 const address='0x'+log.topics[2].slice(-40).toLowerCase(),order=await env.DB.prepare('SELECT * FROM membership_orders WHERE chain_id=? AND address=? AND token=?').bind(c.chainId,address,c.token.toLowerCase()).first();if(!order)return;
 const amount=BigInt(log.data).toString(),tx=log.transactionHash,index=Number(BigInt(log.logIndex)),now=Date.now();
 for(let attempt=0;attempt<5;attempt++){
 const m=await env.DB.prepare('SELECT * FROM account_memberships WHERE account_id=?').bind(order.account_id).first();
 const expires=order.months?addMonths(Math.max(now,m?.expires_at||0),order.months):0;
 const status=amount!==order.amount?'amount_mismatch':order.settled_at?'duplicate_payment':m?.permanent?'already_permanent':'paid';
 const live=await env.DB.prepare('SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL').bind(order.account_id).first();const result=live?status:'account_unavailable';
 // A failed CHECK rolls back the batch; retry with the new account state.
 const record=env.DB.prepare('INSERT OR IGNORE INTO membership_receipts(chain_id,tx,log_index,order_id,amount,block,status,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(c.chainId,tx,index,order.id,amount,Number(BigInt(log.blockNumber)),result,now);
 if(result!=='paid'){await record.run();return}
 try{await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_assertions(id,valid) SELECT ?, (NOT EXISTS(SELECT 1 FROM account_memberships WHERE account_id=? AND (permanent<>? OR expires_at<>?))) AND NOT EXISTS(SELECT 1 FROM membership_receipts WHERE chain_id=? AND tx=? AND log_index=?) AND EXISTS(SELECT 1 FROM membership_orders WHERE id=? AND settled_at IS NULL) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)').bind(tx+':'+index,order.account_id,m?.permanent||0,m?.expires_at||0,c.chainId,tx,index,order.id,order.account_id),record,
 env.DB.prepare('INSERT INTO account_memberships VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET permanent=excluded.permanent,expires_at=excluded.expires_at').bind(order.account_id,order.months?0:1,expires),
 env.DB.prepare('INSERT INTO membership_changes VALUES(?,?,?,?,?)').bind(order.id,order.account_id,order.months?0:1,expires,now),
 env.DB.prepare('UPDATE membership_orders SET settled_at=? WHERE id=?').bind(now,order.id),
 env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(tx+':'+index)
 ]);return}catch(e){const seen=await env.DB.prepare('SELECT 1 FROM membership_receipts WHERE chain_id=? AND tx=? AND log_index=?').bind(c.chainId,tx,index).first();if(seen)return;const updated=await env.DB.prepare('SELECT settled_at FROM membership_orders WHERE id=?').bind(order.id).first();order.settled_at=updated?.settled_at;if(attempt===4)throw e}
 }
}
// Finalized eth_getLogs contains only successful canonical transaction logs.
// Address batches and durable windows bound RPC work without scanning the entire token.
export async function scanMembership(env,{fetcher=fetch}={}){
 if(env.MEMBERSHIP_ENABLED!=='true')return;
 if(env.MEMBERSHIP_SIMULATION==='true'&&fetcher===fetch)throw Error('Simulation requires an injected local RPC');
 await requireRestoreAccess(env);
 const results=await Promise.all(configuration(env).map(async c=>{
 try{
 const call=(method,params)=>rpc(c,method,params,fetcher);
 if(Number(BigInt(await call('eth_chainId',[])))!==c.chainId)throw Error('Wrong RPC chain');
 const finalized=await call('eth_getBlockByNumber',['finalized',false]);
 if(!finalized||!/^0x[0-9a-f]+$/i.test(finalized.number))throw Error('Finality unavailable');
 const head=Number(BigInt(finalized.number));if(!Number.isSafeInteger(head))throw Error('Invalid height');
 for(let page=0;page<5;page++){
 let window=await env.DB.prepare('SELECT * FROM membership_scan_windows WHERE chain_id=?').bind(c.chainId).first();
 if(!window){
 const cursor=await env.DB.prepare('SELECT block FROM membership_cursors WHERE chain_id=?').bind(c.chainId).first();
 const from=cursor?cursor.block+1:c.startBlock;
 if(from>head){await heartbeat(env,c.chainId,head);return}
 const snapshot=await env.DB.prepare('SELECT COALESCE(MAX(a.id),0) id FROM membership_addresses a JOIN membership_orders o ON o.id=a.order_id WHERE o.chain_id=?').bind(c.chainId).first();
 await env.DB.prepare('INSERT OR IGNORE INTO membership_scan_windows VALUES(?,?,?,0,?)').bind(c.chainId,from,Math.min(head,from+99),snapshot.id).run();
 window=await env.DB.prepare('SELECT * FROM membership_scan_windows WHERE chain_id=?').bind(c.chainId).first();
 }
 if(window.to_block>head)throw Error('Finalized height regressed');
 const rows=(await env.DB.prepare('SELECT a.id,o.address FROM membership_addresses a JOIN membership_orders o ON o.id=a.order_id WHERE o.chain_id=? AND a.id>? AND a.id<=? ORDER BY a.id LIMIT 64').bind(c.chainId,window.last_address_id,window.snapshot_id).all()).results;
 if(rows.length){
 const recipients=rows.map(r=>'0x'+r.address.slice(2).padStart(64,'0'));
 const logs=await call('eth_getLogs',[{address:c.token,topics:[topic,null,recipients],fromBlock:hex(window.from_block),toBlock:hex(window.to_block)}]);
 if(!Array.isArray(logs)||logs.length>1000)throw Error('Invalid or excessive log response');
 const accepted=new Set(rows.map(r=>r.address.toLowerCase()));
 for(const log of logs){
 if(!/^0x[0-9a-f]{64}$/i.test(log.transactionHash)||!/^0x[0-9a-f]+$/i.test(log.blockNumber)||!/^0x[0-9a-f]+$/i.test(log.logIndex)||!/^0x[0-9a-f]{64}$/i.test(log.topics?.[2]||''))throw Error('Malformed log');
 const number=Number(BigInt(log.blockNumber));if(number<window.from_block||number>window.to_block||!accepted.has('0x'+log.topics[2].slice(-40).toLowerCase()))throw Error('Log outside filter');
 }
 logs.sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
 for(const log of logs)await settle(env,c,log);
 // A stale concurrent runner cannot move the address checkpoint into a new window.
 await env.DB.prepare('UPDATE membership_scan_windows SET last_address_id=MAX(last_address_id,?) WHERE chain_id=? AND from_block=? AND to_block=?').bind(rows.at(-1).id,c.chainId,window.from_block,window.to_block).run();
 if(rows.length===64)continue;
 }
 await env.DB.batch([
 env.DB.prepare('INSERT INTO membership_cursors VALUES(?,?,?) ON CONFLICT(chain_id) DO UPDATE SET block=MAX(block,excluded.block),updated_at=CASE WHEN excluded.block>=membership_cursors.block THEN excluded.updated_at ELSE membership_cursors.updated_at END').bind(c.chainId,window.to_block,window.to_block===head?Date.now():0),
 env.DB.prepare('DELETE FROM membership_scan_windows WHERE chain_id=? AND from_block=? AND to_block=?').bind(c.chainId,window.from_block,window.to_block)
 ]);
 if(window.to_block===head)return;
 }
 }catch{console.error(JSON.stringify({event:'membership_scan_failed',chainId:c.chainId}));return false}
 return true;
 }));return results;
}
async function heartbeat(env,chainId,head){await env.DB.prepare('INSERT INTO membership_cursors VALUES(?,?,?) ON CONFLICT(chain_id) DO UPDATE SET updated_at=excluded.updated_at WHERE block=excluded.block').bind(chainId,head,Date.now()).run()}
