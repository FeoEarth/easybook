import {hash} from './mcp-common.mjs';
import {sessionAllowed} from './security-checkpoint.mjs';
import {readCookie} from '../mcp-oauth/src/accounts.mjs';
import {HDKey} from '@scure/bip32';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {keccak_256} from '@noble/hashes/sha3.js';
import {workspacePrincipal} from './workspace-api.mjs';
import {boundedJSON} from './mcp-common.mjs';
export const plans=[{id:'month',name:'月度',months:1},{id:'half-year',name:'半年',months:6},{id:'year',name:'年度',months:12},{id:'permanent',name:'永久',months:0}].map(p=>({...p,price:'0.01',currency:'USDT'}));
const networks={43114:'Avalanche C-Chain',9745:'Plasma',137:'Polygon PoS',42161:'Arbitrum One'};
const reply=(v,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status})};
export function configuration(env){
 if(env.MEMBERSHIP_ENABLED!=='true')return [];
 const values=JSON.parse(env.MEMBERSHIP_NETWORKS||'[]');
 return values.filter(c=>networks[c.chainId]&&c.verified===true&&/^0x[a-fA-F0-9]{40}$/.test(c.token)&&Number.isInteger(c.decimals)&&c.decimals>=2&&c.decimals<=18&&Number.isSafeInteger(c.startBlock)&&c.startBlock>=0&&c.finality==='finalized'&&new URL(c.rpc).protocol==='https:').map(c=>({...c,fallbackRPCs:c.fallbackRPCs||(c.chainId===42161?['https://arb1.arbitrum.io/rpc','https://arbitrum-one-rpc.publicnode.com','https://1rpc.io/arb','https://arbitrum.drpc.org']:[]),name:networks[c.chainId],amount:(10n**BigInt(c.decimals-2)).toString()}));
}
export function addMonths(time,months){const d=new Date(time),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.getTime()}
export function deriveAddress(xpub,index){const key=HDKey.fromExtendedKey(xpub);if(key.privateKey)throw Error('Public key required');const child=key.deriveChild(index);const bytes=secp256k1.Point.fromBytes(child.publicKey).toBytes(false);return '0x'+Array.from(keccak_256(bytes.slice(1)).slice(-20),b=>b.toString(16).padStart(2,'0')).join('')}
export async function membershipAPI(request,env){let recovery;try{
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(env.MEMBERSHIP_SIMULATION==='true'&&!['localhost','127.0.0.1','membership.test'].includes(url.hostname))return reply({error:'simulation_local_only'},403);
 if(path==='/api/membership/plans'&&method==='GET')return reply({simulation:env.MEMBERSHIP_SIMULATION==='true',plans,networks:configuration(env).filter(c=>c.acceptOrders!==false).map(c=>({chainId:c.chainId,name:c.name,symbol:c.symbol||'USDT',token:c.token}))});
 const p=await membershipPrincipal(request,env,method!=='GET');if(p.kind!=='account')fail('account_required',403);
 const alive=await env.DB.prepare('SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL').bind(p.accountId).first();if(!alive)fail('account_required',401);
 if(path==='/api/membership'&&method==='GET'){
 if(env.MEMBERSHIP_SCANNER&&env.MEMBERSHIP_JOB_TOKEN){const rows=(await env.DB.prepare('SELECT chain_id,updated_at FROM membership_cursors').all()).results;if(configuration(env).some(c=>!rows.some(r=>r.chain_id===c.chainId&&r.updated_at>Date.now()-300000))){try{await env.MEMBERSHIP_SCANNER.fetch('https://payments.internal/run',{method:'POST',headers:{Authorization:'Bearer '+env.MEMBERSHIP_JOB_TOKEN}})}catch{}}}
 const m=await env.DB.prepare('SELECT * FROM account_memberships WHERE account_id=?').bind(p.accountId).first();return reply({permanent:!!m?.permanent,expiresAt:m?.expires_at||null,active:!!m?.permanent||m?.expires_at>Date.now()})}
 if(path==='/api/membership/orders'&&method==='POST'){
 let body;try{body=await boundedJSON(request,2048)}catch{fail('invalid_request',400)};if(!body||typeof body.idempotency!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotency))fail('invalid_request');
 recovery={accountId:p.accountId,key:body.idempotency,plan:body.plan,chainId:body.chainId};
 const old=await env.DB.prepare('SELECT * FROM membership_orders WHERE account_id=? AND idempotency=?').bind(p.accountId,body.idempotency).first();if(old){if(old.plan!==body.plan||old.chain_id!==body.chainId)fail('idempotency_conflict',409);return reply(old);}
 const plan=plans.find(v=>v.id===body.plan),chain=configuration(env).find(c=>c.chainId===body.chainId&&c.acceptOrders!==false);if(!plan||!chain||!env.MEMBERSHIP_XPUB)fail('network_unavailable',503);
 let cursor=await env.DB.prepare('SELECT updated_at FROM membership_cursors WHERE chain_id=?').bind(chain.chainId).first();
 if((!cursor||cursor.updated_at<Date.now()-300000)&&env.MEMBERSHIP_SCANNER&&env.MEMBERSHIP_JOB_TOKEN){try{await env.MEMBERSHIP_SCANNER.fetch('https://payments.internal/run',{method:'POST',headers:{Authorization:'Bearer '+env.MEMBERSHIP_JOB_TOKEN}})}catch{}cursor=await env.DB.prepare('SELECT updated_at FROM membership_cursors WHERE chain_id=?').bind(chain.chainId).first()}
 if(!cursor||cursor.updated_at<Date.now()-300000)fail('scanner_unavailable',503);
 const member=await env.DB.prepare('SELECT permanent FROM account_memberships WHERE account_id=?').bind(p.accountId).first();if(member?.permanent)fail('already_permanent',409);
 const now=Date.now();const pending=await env.DB.prepare('SELECT * FROM membership_orders WHERE account_id=? AND plan=? AND chain_id=? AND expires_at>? AND settled_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(p.accountId,plan.id,chain.chainId,now).first();if(pending)return reply(pending);
 const count=await env.DB.prepare('SELECT COUNT(*) n FROM membership_orders WHERE account_id=? AND created_at>?').bind(p.accountId,now-3600000).first();if(count.n>=10)fail('rate_limited',429);
 const offset=Number(env.MEMBERSHIP_ADDRESS_OFFSET||0);if(!Number.isSafeInteger(offset)||offset<0||offset>=2147483647)fail('invalid_wallet_configuration',503);
 const walletHash=await hash(env.MEMBERSHIP_XPUB);await env.DB.prepare('INSERT OR IGNORE INTO membership_wallet_config VALUES(1,?,?)').bind(walletHash,offset).run();
 const saved=await env.DB.prepare('SELECT * FROM membership_wallet_config WHERE id=1').first();if(saved.wallet_hash!==walletHash||saved.address_offset!==offset)fail('wallet_configuration_changed',409);
 const id=crypto.randomUUID(),row=await env.DB.prepare('INSERT INTO membership_addresses(order_id) VALUES(?) RETURNING id').bind(id).first(),address=deriveAddress(env.MEMBERSHIP_XPUB,row.id+offset);
 const inserted=await env.DB.prepare('INSERT INTO membership_orders SELECT ?,?,?,?,?,?,?,?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM account_memberships WHERE account_id=? AND permanent=1) AND (SELECT COUNT(*) FROM membership_orders WHERE account_id=? AND created_at>?)<10 RETURNING id').bind(id,p.accountId,plan.id,plan.months,chain.chainId,chain.token.toLowerCase(),chain.amount,address,body.idempotency,now,now+1800000,p.accountId,p.accountId,p.accountId,now-3600000).first();if(!inserted)fail('order_not_available',409);
 return reply(await env.DB.prepare('SELECT * FROM membership_orders WHERE id=?').bind(id).first(),201);
 }
 if(path==='/api/membership/orders'&&method==='GET')return reply({orders:(await env.DB.prepare('SELECT o.*, (SELECT status FROM membership_receipts r WHERE r.order_id=o.id ORDER BY created_at DESC LIMIT 1) receipt_status FROM membership_orders o WHERE account_id=? ORDER BY created_at DESC LIMIT 100').bind(p.accountId).all()).results});
 const match=path.match(/^\/api\/membership\/orders\/([a-f0-9-]{36})$/);if(match&&method==='GET'){const order=await env.DB.prepare('SELECT * FROM membership_orders WHERE id=? AND account_id=?').bind(match[1],p.accountId).first();if(!order)fail('not_found',404);const receipts=await env.DB.prepare('SELECT tx,amount,status FROM membership_receipts WHERE order_id=?').bind(order.id).all();return reply({...order,receipts:receipts.results})}return reply({error:'not_found'},404);
 }catch(e){if(recovery&&!e.status){try{const old=await env.DB.prepare('SELECT * FROM membership_orders WHERE account_id=? AND idempotency=?').bind(recovery.accountId,recovery.key).first();if(old&&old.plan===recovery.plan&&old.chain_id===recovery.chainId)return reply(old)}catch{}}return reply({error:e.status?e.message:'membership_unavailable'},e.status||503)}}

export async function membershipPrincipal(request,env,mutation=false){
 const token=readCookie(request,'__Host-easybook-membership');
 if(token&&!request.headers.has('Authorization')){
 const s=await env.DB.prepare('SELECT s.* FROM membership_web_sessions m JOIN account_sessions s ON s.id=m.session_id JOIN accounts a ON a.id=s.account_id WHERE m.token_hash=? AND m.expires_at>? AND s.expires_at>? AND s.revoked_at IS NULL AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_session_passkeys sp JOIN account_passkeys pk ON pk.id=sp.credential_id WHERE sp.session_id=s.id AND pk.revoked_at IS NOT NULL)').bind(await hash(token),Date.now(),Date.now()).first();
 if(!s||!await sessionAllowed(env,s))fail('session_expired',401);
 if(mutation&&(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Easybook-CSRF')!==await hash(token)))fail('invalid_csrf',403);
 return {kind:'account',accountId:s.account_id,sessionId:s.id};
 }
 return workspacePrincipal(request,env,{mutation});
}
