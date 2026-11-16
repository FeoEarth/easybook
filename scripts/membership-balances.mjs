import {spawnSync} from 'node:child_process';
if(!process.argv[2])throw Error('Usage: node scripts/membership-balances.mjs export.sqlite');
const result=spawnSync('python3',['-c',`import sqlite3,json,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute('SELECT a.id+COALESCE((SELECT address_offset FROM membership_wallet_config WHERE id=1),0) derivation_index,o.id order_id,o.address,o.chain_id,o.token FROM membership_addresses a JOIN membership_orders o ON o.id=a.order_id ORDER BY a.id')]))`,process.argv[2]],{encoding:'utf8'});
if(result.status!==0)throw Error('Cannot read exported database');
const networks=JSON.parse(process.env.MEMBERSHIP_NETWORKS||'[]');
for(const row of JSON.parse(result.stdout)){
 const c=networks.find(c=>c.chainId===row.chain_id);if(!c)throw Error('Missing network '+row.chain_id);
 const r=await fetch(c.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:row.token,data:'0x70a08231'+row.address.slice(2).padStart(64,'0')},'latest']}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||data.error)throw Error('Balance query failed');console.log(JSON.stringify({...row,balance:BigInt(data.result).toString()}));
}
