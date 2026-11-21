import {boundedJSON} from './mcp-common.mjs';

export const publicHostname=host=>/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/.test(host)&&
 !/\.(localhost|local|lan|home|internal|test|invalid|onion|arpa|example)$/.test(host);

function publicAddress(value){
 if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)){
  const [a,b,c,...rest]=value.split('.').map(Number);
  return Math.max(a,b,c,...rest)<=255&&a>0&&a<224&&a!==10&&a!==127&&
   !(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&
   !(a===192&&(b===168||b===0||b===88||b===2))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
 }
 return /^[23][0-9a-f]{3}:[0-9a-f:]+$/i.test(value)&&!/^200[12]:/i.test(value)&&!/^3fff:/i.test(value);
}

export async function assertPublicHost(url,fetcher,signal){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const query=new URL('https://cloudflare-dns.com/dns-query');
  query.searchParams.set('name',url.hostname);query.searchParams.set('type',type);
  // Workers supports manual redirects. The status check rejects all 3xx responses.
  const res=await fetcher(query,{headers:{Accept:'application/dns-json'},redirect:'manual',signal});
  if(!res.ok)throw Object.assign(Error('Public DNS lookup failed'),{code:'public_dns_unreachable'});
  const data=await boundedJSON(res,22000);
  if(data.Status!==0)throw Object.assign(Error('Public DNS lookup failed'),{code:'public_dns_unreachable'});
  return (data.Answer||[]).filter(row=>row.type===1||row.type===28).map(row=>row.data);
 }));
 const ips=answers.flat();
 if(!ips.length)throw Object.assign(Error('Public DNS lookup failed'),{code:'public_dns_unreachable'});
 if(ips.some(ip=>!publicAddress(ip)))throw Object.assign(Error('Non-public address'),{code:'non_public_address'});
}
