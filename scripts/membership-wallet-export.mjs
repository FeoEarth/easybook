// Reads a mnemonic from stdin only. Never prints or persists secret key material.
import {validateMnemonic,mnemonicToSeedSync} from '@scure/bip39';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {HDKey} from '@scure/bip32';
import {deriveAddress} from '../worker/membership.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const expected=process.argv[2],index=Number(process.argv[3]||0);
if(!Number.isSafeInteger(index)||index<0||index>100)throw Error('Invalid account index');
if(!/^0x[0-9a-fA-F]{40}$/.test(expected||''))throw Error('Expected public address required');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(!input.includes('\n'))return;
 try{
 const mnemonic=input.trim().normalize('NFKD');input='';
 if(!validateMnemonic(mnemonic,wordlist))throw Error('Mnemonic checksum invalid');
 const seed=mnemonicToSeedSync(mnemonic);const root=HDKey.fromMasterSeed(seed);seed.fill(0);
 const branch=root.derive("m/44'/60'/0'/0");root.wipePrivateData();
 const xpub=branch.publicExtendedKey;branch.wipePrivateData();
 if(deriveAddress(xpub,index).toLowerCase()!==expected.toLowerCase())throw Error('Wallet address mismatch; nothing exported');
 mkdirSync('.local-membership',{recursive:true,mode:0o700});
 writeFileSync('.local-membership/wallet.json',JSON.stringify({testOnly:true,path:"m/44'/60'/0'/0",address:expected,verifiedAccountIndex:index,minOrderIndex:index+1,xpub},null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log('Wallet address verified; public-only test configuration saved locally.');process.exit(0);
 }catch(error){const allowed=['Mnemonic checksum invalid','Wallet address mismatch; nothing exported'];console.error(allowed.includes(error.message)?error.message:'Wallet validation failed; no configuration exported.');process.exit(1)}
});
