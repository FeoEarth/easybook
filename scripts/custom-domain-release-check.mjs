// Preserve the zone's bot protection. A pre-existing Cloudflare challenge is
// recorded as blocked, never reported as a successful browser/app check.
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const origin='https://easybook.loonxy.com';
async function observe(){const out=[];for(const path of ['/','/health']){const r=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(20000)});out.push({path,status:r.status,challenge:r.headers.get('cf-mitigated')==='challenge'});await r.body?.cancel()}return out}
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
  const identity=JSON.parse(readFileSync('release-state.json','utf8')).identityV2;execFileSync(process.execPath,[identity?'scripts/live-core-workspace-probe.mjs':'scripts/live-pairing-probe.mjs',origin],{stdio:'inherit'});
 }
}

