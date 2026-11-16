// Read-only chain validation; never broadcasts a transaction.
import {readFileSync,writeFileSync} from 'node:fs';
import {tokens} from './membership-local-config.mjs';
const wallet=JSON.parse(readFileSync('.local-membership/wallet.json','utf8'));
const reports=await Promise.all(tokens.map(async c=>{
 const call=async(method,params)=>{const r=await fetch(c.candidateRPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const v=await r.json();if(v.error||v.result===undefined)throw Error('RPC rejected '+method);return v.result};
 try{
 if(Number(BigInt(await call('eth_chainId',[])))!==c.chainId)throw Error('Wrong chain');
 const decimals=Number(BigInt(await call('eth_call',[{to:c.token,data:'0x313ce567'},'latest'])));if(decimals!==6)throw Error('Unexpected decimals');
 const code=await call('eth_getCode',[c.token,'latest']);if(code==='0x')throw Error('No token contract');
 const finalized=await call('eth_getBlockByNumber',['finalized',false]);if(!finalized?.number)throw Error('No finalized height');
 const logs=await call('eth_getLogs',[{address:c.token,fromBlock:finalized.number,toBlock:finalized.number,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',null,['0x'+wallet.address.slice(2).toLowerCase().padStart(64,'0')]]}]);if(!Array.isArray(logs))throw Error('Invalid logs');
 return {...c,ok:true,decimals,startBlock:Number(BigInt(finalized.number)),rpc:c.candidateRPC,finality:'finalized',verified:true};
 }catch(e){return {...c,ok:false,error:e.message,verified:false,acceptOrders:false}}
}));
writeFileSync('.local-membership/rpc-report.json',JSON.stringify({checkedAt:new Date().toISOString(),networks:reports},null,2)+'\n',{mode:0o600});
writeFileSync('.local-membership/real-network-env.json',JSON.stringify({MEMBERSHIP_ENABLED:'false',MEMBERSHIP_TEST_WALLET:'true',MEMBERSHIP_XPUB:wallet.xpub,MEMBERSHIP_ADDRESS_OFFSET:String(wallet.minOrderIndex-1),MEMBERSHIP_NETWORKS:JSON.stringify(reports)},null,2)+'\n',{mode:0o600});
for(const c of reports)console.log(c.chainId+': '+(c.ok?'chain, token decimals, finalized and filtered logs verified':'unavailable: '+c.error));
