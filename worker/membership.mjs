import {plans,PRICE_VERSION} from './membership-plans.mjs';
export {plans} from './membership-plans.mjs';
import {hash} from './mcp-common.mjs';
import {sessionAllowed} from './security-checkpoint.mjs';
import {readCookie} from '../mcp-oauth/src/accounts.mjs';
import {workspacePrincipal} from './workspace-api.mjs';
import {boundedJSON} from './mcp-common.mjs';
import {ensureWallet,expirePurchase,quotePurchase,cancelPurchase,applyBalance,purchaseView,money} from './membership-ledger.mjs';
export {deriveAddress,addMonths} from './membership-ledger.mjs';

const networks={43114:'Avalanche C-Chain',9745:'Plasma',137:'Polygon PoS',42161:'Arbitrum One'};
const reply=(v,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
const fail=(code,status=400,order)=>{throw Object.assign(Error(code),{status,order})};
export function configuration(env){if(env.MEMBERSHIP_ENABLED!=='true')return [];const values=JSON.parse(env.MEMBERSHIP_NETWORKS||'[]');return values.filter(c=>networks[c.chainId]&&c.verified===true&&/^0x[a-fA-F0-9]{40}$/.test(c.token)&&c.decimals===6&&Number.isSafeInteger(c.startBlock)&&c.startBlock>=0&&c.finality==='finalized'&&new URL(c.rpc).protocol==='https:').map(c=>({...c,fallbackRPCs:c.fallbackRPCs||(c.chainId===42161?['https://arb1.arbitrum.io/rpc','https://arbitrum-one-rpc.publicnode.com','https://1rpc.io/arb','https://arbitrum.drpc.org']:[]),name:networks[c.chainId]}))}
async function warmScanner(env,chainId){const rows=(await env.DB.prepare('SELECT chain_id,updated_at FROM membership_cursors').all()).results;const stale=configuration(env).filter(c=>!chainId||c.chainId===chainId).some(c=>!rows.some(r=>r.chain_id===c.chainId&&r.updated_at>Date.now()-300000));if(stale&&env.MEMBERSHIP_SCANNER&&env.MEMBERSHIP_JOB_TOKEN){try{await env.MEMBERSHIP_SCANNER.fetch('https://payments.internal/run',{method:'POST',headers:{Authorization:'Bearer '+env.MEMBERSHIP_JOB_TOKEN}})}catch{}}}
async function input(request){try{const v=await boundedJSON(request,2048);if(!v||Array.isArray(v)||typeof v!=='object')fail('invalid_request');return v}catch{fail('invalid_request')}}
export async function membershipAPI(request,env){let recovery;
 try{
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(env.MEMBERSHIP_SIMULATION==='true'&&!['localhost','127.0.0.1','membership.test'].includes(url.hostname))return reply({error:'simulation_local_only'},403);
 if(path==='/api/membership/plans'&&method==='GET')return reply({priceVersion:PRICE_VERSION,simulation:env.MEMBERSHIP_SIMULATION==='true',plans,networks:configuration(env).filter(c=>c.acceptOrders!==false).map(c=>({chainId:c.chainId,name:c.name,symbol:c.symbol||'USDT',token:c.token}))});
 const p=await membershipPrincipal(request,env,{mutation:method!=='GET'});if(p.kind!=='account')fail('account_required',403);
 const alive=await env.DB.prepare('SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL').bind(p.accountId).first();if(!alive)fail('account_required',401);
 const wallet=await ensureWallet(env,p.accountId);await expirePurchase(env,p.accountId);
 if(path==='/api/membership'&&method==='GET'){
 const available=await env.DB.prepare('SELECT units FROM membership_balances WHERE account_id=?').bind(p.accountId).first();if(!available||BigInt(available.units)===0n)await warmScanner(env);await applyBalance(env,p.accountId);
 const m=await env.DB.prepare('SELECT * FROM account_memberships WHERE account_id=?').bind(p.accountId).first(),b=await env.DB.prepare('SELECT units FROM membership_balances WHERE account_id=?').bind(p.accountId).first(),state=await env.DB.prepare('SELECT * FROM membership_account_state WHERE account_id=?').bind(p.accountId).first();
 return reply({permanent:!!m?.permanent,expiresAt:m?.expires_at||null,active:!!m?.permanent||m?.expires_at>Date.now(),plan:state.plan,balance:money(b.units),address:wallet.address,cancellationGuard:state.cancel_version>state.ack_version,needsAcknowledgement:!!state.needs_ack});
 }
 if(path==='/api/membership/quote'&&method==='GET'){const plan=plans.find(v=>v.id===url.searchParams.get('plan'));if(!plan)fail('invalid_plan');const q=await quotePurchase(env,p.accountId,plan);return reply({...q,price:money(q.list_units),upgradeCredit:money(q.credit_units),required:money(q.amount)})}
 if(path==='/api/membership/orders'&&method==='POST'){
 const body=await input(request);if(body.priceVersion!==PRICE_VERSION)fail('price_changed',409);if(typeof body.idempotency!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotency))fail('invalid_request');
 recovery={accountId:p.accountId,key:body.idempotency,plan:body.plan};
 const old=await env.DB.prepare('SELECT * FROM membership_purchases WHERE account_id=? AND idempotency=?').bind(p.accountId,body.idempotency).first();if(old){if(old.plan!==body.plan)fail('idempotency_conflict',409);if(body.useBalance===true&&!old.settled_at&&!old.cancelled_at)await applyBalance(env,p.accountId,{explicit:true,orderId:old.id});return reply(await purchaseView(env,await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=?').bind(old.id).first()))}
 const plan=plans.find(v=>v.id===body.plan),chain=configuration(env).find(c=>c.chainId===body.chainId&&(body.useBalance===true||c.acceptOrders!==false));if(!plan||!chain)fail('network_unavailable',503);
 const pending=await env.DB.prepare('SELECT * FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL').bind(p.accountId).first();
 if(pending){if(pending.plan!==plan.id)fail('pending_order_exists',409,await purchaseView(env,pending));await env.DB.prepare('UPDATE membership_purchases SET chain_id=?,token=? WHERE id=? AND settled_at IS NULL AND cancelled_at IS NULL').bind(chain.chainId,chain.token.toLowerCase(),pending.id).run();await applyBalance(env,p.accountId,{explicit:body.useBalance===true,orderId:pending.id});return reply(await purchaseView(env,await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=?').bind(pending.id).first()))}
 if(body.useBalance!==true){await warmScanner(env,chain.chainId);const cursor=await env.DB.prepare('SELECT updated_at FROM membership_cursors WHERE chain_id=?').bind(chain.chainId).first();if(!cursor||cursor.updated_at<Date.now()-300000)fail('scanner_unavailable',503);}
 const now=Date.now(),count=await env.DB.prepare('SELECT COUNT(*) n FROM membership_purchases WHERE account_id=? AND created_at>?').bind(p.accountId,now-3600000).first();if(count.n>=10)fail('rate_limited',429);
 const q=await quotePurchase(env,p.accountId,plan),id=crypto.randomUUID(),assertion=crypto.randomUUID();
 if(body.useBalance===true){const b=await env.DB.prepare('SELECT units FROM membership_balances WHERE account_id=?').bind(p.accountId).first();if(!b||BigInt(b.units)<BigInt(q.amount))fail('insufficient_balance',409)}
 const statements=[env.DB.prepare('INSERT INTO membership_assertions SELECT ?,EXISTS(SELECT 1 FROM membership_account_state WHERE account_id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM account_memberships WHERE account_id=? AND permanent=1) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL)').bind(assertion,p.accountId,q.state_version,p.accountId,p.accountId)];
 if(body.acknowledgeLatePayment===true)statements.push(env.DB.prepare('UPDATE membership_account_state SET ack_version=cancel_version,needs_ack=0 WHERE account_id=? AND needs_ack=1').bind(p.accountId));
 statements.push(env.DB.prepare('INSERT INTO membership_purchases(id,account_id,plan,months,chain_id,token,amount,address,idempotency,created_at,expires_at,kind,list_units,credit_units,state_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,p.accountId,plan.id,plan.months,chain.chainId,chain.token.toLowerCase(),q.amount,wallet.address,body.idempotency,now,now+1800000,q.kind,q.list_units,q.credit_units,q.state_version),env.DB.prepare('DELETE FROM membership_assertions WHERE id=?').bind(assertion));
 await env.DB.batch(statements);await applyBalance(env,p.accountId,{explicit:body.useBalance===true,orderId:id});return reply(await purchaseView(env,await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=?').bind(id).first()),201);
 }
 if(path==='/api/membership/orders'&&method==='GET'){const rows=(await env.DB.prepare('SELECT * FROM membership_purchases WHERE account_id=? ORDER BY created_at DESC LIMIT 100').bind(p.accountId).all()).results;return reply({orders:await Promise.all(rows.map(o=>purchaseView(env,o)))})}
 const match=path.match(/^\/api\/membership\/orders\/([a-f0-9-]{36})(?:\/(cancel|pay))?$/);if(match){if(match[2]==='pay'&&method==='POST'){const current=await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=? AND account_id=?').bind(match[1],p.accountId).first();if(!current)fail('not_found',404);if(!current.settled_at){if(current.cancelled_at)fail('order_unavailable',409);await applyBalance(env,p.accountId,{explicit:true,orderId:current.id})}return reply(await purchaseView(env,await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=?').bind(current.id).first()))}if(match[2]==='cancel'&&method==='POST')return reply(await purchaseView(env,await cancelPurchase(env,p.accountId,match[1])));if(!match[2]&&method==='GET'){const order=await env.DB.prepare('SELECT * FROM membership_purchases WHERE id=? AND account_id=?').bind(match[1],p.accountId).first();if(!order)fail('not_found',404);return reply(await purchaseView(env,order))}}
 return reply({error:'not_found'},404);
 }catch(e){if(recovery&&!e.status){try{const old=await env.DB.prepare('SELECT * FROM membership_purchases WHERE account_id=? AND idempotency=?').bind(recovery.accountId,recovery.key).first();if(old&&old.plan===recovery.plan)return reply(await purchaseView(env,old));const pending=await env.DB.prepare('SELECT * FROM membership_purchases WHERE account_id=? AND settled_at IS NULL AND cancelled_at IS NULL').bind(recovery.accountId).first();if(pending)return reply({error:'pending_order_exists',order:await purchaseView(env,pending)},409)}catch{}}return reply({error:e.status?e.message:'membership_unavailable',...(e.order?{order:e.order}:{})},e.status||503)}
}
export async function membershipPrincipal(request,env,{mutation=false}={}){
 const token=readCookie(request,'__Host-easybook-membership');
 if(token&&!request.headers.has('Authorization')){const s=await env.DB.prepare('SELECT s.* FROM membership_web_sessions m JOIN account_sessions s ON s.id=m.session_id JOIN accounts a ON a.id=s.account_id WHERE m.token_hash=? AND m.expires_at>? AND s.expires_at>? AND s.revoked_at IS NULL AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL)').bind(await hash(token),Date.now(),Date.now()).first();if(!s||!await sessionAllowed(env,s))fail('session_expired',401);if(mutation&&(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Easybook-CSRF')!==await hash(token)))fail('invalid_csrf',403);return {kind:'account',accountId:s.account_id,sessionId:s.id}}
 return workspacePrincipal(request,env,{mutation});
}
