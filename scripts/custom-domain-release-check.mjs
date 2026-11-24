// Preserve the zone's bot protection. A pre-existing Cloudflare challenge is
// recorded as blocked, never reported as a successful browser/app check.
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const origin='https://easybook.loonxy.com';
// A transient runner-to-Cloudflare connection timeout must not roll back an
// otherwise healthy release. Retry transport failures only: an HTTP response
// (including a WAF challenge, 404, or 5xx) remains authoritative.
function retryable(error){
 if(!error||typeof error!=='object')return false;
 if(error.name==='TimeoutError')return true;
 if(['ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','ECONNRESET','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.code))return true;
 return retryable(error.cause)||(Array.isArray(error.errors)&&error.errors.some(retryable))||false;
}
async function probe(path){
 for(let attempt=0;attempt<4;attempt++){
  try{
   const r=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(12000)});
   const result={path,status:r.status,challenge:r.headers.get('cf-mitigated')==='challenge'};
   await r.body?.cancel().catch(()=>{});
   return result;
  }catch(error){
   if(!retryable(error)||attempt===3)throw error;
   console.warn('Custom-domain transport error for '+path+'; retrying ('+(attempt+1)+'/3)');
   await new Promise(resolve=>setTimeout(resolve,400*2**attempt));
  }
 }
}
async function observe(){const out=[];for(const path of ['/','/health'])out.push(await probe(path));return out}
const result=await observe();
const challenged=rows=>rows.length===2&&rows.every(r=>r.status===403&&r.challenge);
const healthy=rows=>rows.every(r=>r.status===200&&!r.challenge);
if(process.argv[2]==='record'){
 if(!challenged(result)&&!healthy(result))throw Error('Custom-domain baseline is neither healthy nor a confirmed Cloudflare challenge: '+JSON.stringify(result));
 writeFileSync('custom-domain-baseline.json',JSON.stringify({origin,result},null,2));
 console.log(challenged(result)?'BASELINE BLOCKED: Cloudflare challenge, protection unchanged':'Custom-domain HTTP baseline healthy');
}else{
 const baseline=JSON.parse(readFileSync('custom-domain-baseline.json','utf8'));if(baseline.origin!==origin)throw Error('Invalid custom-domain baseline');
 if(challenged(result)&&challenged(baseline.result)){
  const message='BLOCKED: custom-domain CI browser/API verification unavailable due to the same pre-existing Cloudflare challenge. Canonical Worker runtime checks remain mandatory; custom-domain mapping verified through Cloudflare API.';
  console.log(message);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,message+'\n');
 }else{
  if(!healthy(result))throw Error('Custom-domain behavior regressed: '+JSON.stringify(result));
  execFileSync(process.execPath,['scripts/web-release-smoke.mjs',origin],{stdio:'inherit'});
  const identity=JSON.parse(readFileSync('release-state.json','utf8')).identityV2;execFileSync(process.execPath,[identity?'scripts/live-core-workspace-probe.mjs':'scripts/live-pairing-probe.mjs',origin],{stdio:'inherit'});if(identity)execFileSync(process.execPath,['scripts/live-ai-execution-probe.mjs',origin],{stdio:'inherit'});
 }
}

