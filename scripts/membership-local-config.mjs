import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
export const tokens=[
 {chainId:43114,symbol:'USD₮',token:'0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',candidateRPC:'https://api.avax.network/ext/bc/C/rpc'},
 {chainId:9745,symbol:'USDT0',token:'0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',candidateRPC:'https://rpc.plasma.to'},
 {chainId:137,symbol:'USDT0',token:'0xc2132D05D31c914a87C6611C10748AEb04B58e8F',candidateRPC:'https://polygon-bor-rpc.publicnode.com'},
 {chainId:42161,symbol:'USD₮0',token:'0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',candidateRPC:'https://arbitrum.gateway.tenderly.co'}
];
export function localConfig(wallet){return {
 MEMBERSHIP_ENABLED:'true',MEMBERSHIP_SIMULATION:'true',MEMBERSHIP_XPUB:wallet.xpub,
 MEMBERSHIP_ADDRESS_OFFSET:String((wallet.minOrderIndex||1)-1),
 MEMBERSHIP_NETWORKS:JSON.stringify(tokens.map(c=>({...c,decimals:6,rpc:'https://rpc.simulation.invalid/'+c.chainId,startBlock:100,finality:'finalized',verified:true}))),
 minOrderIndex:wallet.minOrderIndex||1
}}
if(process.argv[1]?.endsWith('membership-local-config.mjs')){
 const wallet=JSON.parse(readFileSync('.local-membership/wallet.json','utf8'));if(!wallet.testOnly)throw Error('Test wallet required');
 mkdirSync('.local-membership',{recursive:true,mode:0o700});
 writeFileSync('.local-membership/env.json',JSON.stringify(localConfig(wallet),null,2)+'\n',{mode:0o600});
 console.log('Public-only simulation configuration ready. No real RPC or production binding is used.');
}
