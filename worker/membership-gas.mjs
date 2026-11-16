// Reference cost of a standard ERC-20 transfer, not a sender-specific transaction simulation.
// The payer signs in an external wallet; its final estimate takes precedence.
import {keccak_256} from '@noble/hashes/sha3.js';
const nativeSymbols={43114:'AVAX',9745:'XPL',137:'POL',42161:'ETH'};
const samples=new Map(),pending=new Map();
const gasInfoSelector='0x'+Array.from(keccak_256(new TextEncoder().encode('getPricesInWei()')).slice(0,4),b=>b.toString(16).padStart(2,'0')).join('');
const uint=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]{1,64}$/i.test(value))throw Error('Invalid RPC quantity');return BigInt(value)};
function nativeAmount(wei){const rounded=(wei+999999n)/1000000n,scale=1000000000000n;return (rounded/scale)+'.'+(rounded%scale).toString().padStart(12,'0').replace(/0+$/,'').padEnd(2,'0')}
export async function estimateMembershipGas(c){
 const key=JSON.stringify([c.chainId,c.token,c.rpc,c.fallbackRPCs]);const cached=samples.get(key);if(cached&&Date.now()-cached.sampledAt<30000)return cached;if(pending.has(key))return pending.get(key);
 const task=sample(c).then(value=>{samples.set(key,value);return value}).finally(()=>pending.delete(key));pending.set(key,task);return task;
}
async function sample(c){
 for(const endpoint of [...new Set([c.rpc,...(c.fallbackRPCs||[])])].slice(0,3)){
 try{
 const signal=AbortSignal.timeout(3200);
 const rpc=async(method,params=[])=>{const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal});if(!r.ok)throw Error('RPC unavailable');const v=await r.json();if(v.error||v.result===undefined)throw Error('RPC unavailable');return v.result};
 if(Number(uint(await rpc('eth_chainId')))!==c.chainId)throw Error('Wrong chain');
 const [price,arb]=await Promise.all([rpc('eth_gasPrice'),c.chainId===42161?rpc('eth_call',[{to:'0x000000000000000000000000000000000000006c',data:gasInfoSelector},'latest']).catch(()=>null):null]);
 const gasPrice=uint(price),lowGas=65000n,highGas=100000n;let l1Low=0n,l1High=0n,includesL1=c.chainId!==42161;
 // ArbGasInfo.getPricesInWei(): the second word is wei per compressed L1 calldata byte.
 // Use a 200–400 byte reference envelope; actual compression and wallet transaction vary.
 if(c.chainId===42161&&typeof arb==='string'&&/^0x[0-9a-f]{384}$/i.test(arb)){const perByte=uint('0x'+arb.slice(66,130));l1Low=perByte*200n;l1High=perByte*400n;includesL1=true}
 return {chainId:c.chainId,nativeSymbol:nativeSymbols[c.chainId],low:nativeAmount(gasPrice*lowGas+l1Low),high:nativeAmount(gasPrice*highGas+l1High),gasPriceWei:String(gasPrice),gasUnitsLow:String(lowGas),gasUnitsHigh:String(highGas),includesL1,sampledAt:Date.now(),basis:'reference_erc20_transfer'};
 }catch{/* Try the next configured public RPC without exposing URLs or credentials. */}
 }
 throw Error('gas_estimate_unavailable');
}
