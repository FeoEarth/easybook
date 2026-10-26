import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const mode=process.argv[2],oauth=process.argv.includes('--oauth');
const worker=oauth?'easybook-mcp-oauth':'easybook-sync';
const config=oauth?'mcp-oauth/wrangler.jsonc':'worker/wrangler.jsonc';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Cloudflare credentials missing');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok||!data.success)throw Error('Cloudflare API failed: '+r.status+' '+JSON.stringify(data.errors));return data.result}
const current=async()=>{const d=await api('/deployments');if(!d.deployments?.length)throw Error('No baseline deployment');return d.deployments[0]};
const same=(a,b)=>JSON.stringify([...a].sort((x,y)=>x.version_id.localeCompare(y.version_id)))===JSON.stringify([...b].sort((x,y)=>x.version_id.localeCompare(y.version_id)));
function summary(text){console.log(text);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n')}
if(mode==='stage'){
 const baseline=await current();
 const state={worker,baseline,candidate:null,sha:process.env.GITHUB_SHA||'local'};
 writeFileSync('release-state.json',JSON.stringify(state,null,2));
 const output=execFileSync(oauth?'mcp-oauth/node_modules/.bin/wrangler':'node_modules/.bin/wrangler',['versions','upload','--config',config,'--keep-vars','--tag',state.sha.slice(0,40),'--message','Candidate '+state.sha,'--var','RELEASE_SHA:'+state.sha],{encoding:'utf8',maxBuffer:8*1024*1024});console.log(output);
 const id=output.match(/Version ID:\s*([a-f0-9-]{36})/i)?.[1];
 const url=output.match(/https:\/\/[\w.-]+\.workers\.dev/g)?.find(u=>!u.startsWith('https://'+worker+'.'));
 if(!id||!url)throw Error('Upload did not return an exact version ID and URL');
 state.candidate=id;state.url=url;
 const detail=await api('/versions/'+id);
 const required=oauth?['DB','OAUTH_KV','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','MCP_GRANTS_ENABLED','MCP_PAIRING_SIGNING_KEY']:['DB','ATTACHMENTS','PDF_ASSETS','MCP_PAIRING_SIGNING_KEY'];
 for(const name of required)if(!detail.resources.bindings.some(b=>b.name===name))throw Error('Candidate binding missing: '+name);
 writeFileSync('release-state.json',JSON.stringify(state,null,2));
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`url=${url}\nversion=${id}\n`);
 summary(`Candidate ${id}; baseline deployment ${baseline.id}; no production traffic changed.`);
}else if(mode==='promote'||mode==='rollback'){
 const state=JSON.parse(readFileSync('release-state.json','utf8'));if(state.worker!==worker||!state.candidate)throw Error('Invalid release state');
 const active=await current();
 if(mode==='promote'){
  if(!same(active.versions,state.baseline.versions))throw Error('Production changed since staging; refusing stale promotion');
  state.promotionStarted=true;writeFileSync('release-state.json',JSON.stringify(state,null,2));
  const deployment=await api('/deployments',{strategy:'percentage',versions:[{version_id:state.candidate,percentage:100}],annotations:{'workers/message':'Release '+state.sha}});
  state.deployment=deployment;writeFileSync('release-state.json',JSON.stringify(state,null,2));summary(`Promoted ${state.candidate}; deployment ${deployment.id}`);
 }else{
  if(!state.promotionStarted){summary('Production was never promoted; rollback unnecessary.');process.exit(0)}
  if(same(active.versions,state.baseline.versions)){summary('Baseline already active.');process.exit(0)}
  if(!same(active.versions,[{version_id:state.candidate,percentage:100}]))throw Error('Another deployment is active; refusing to overwrite it');
  const rollback=await api('/deployments',{strategy:'percentage',versions:state.baseline.versions,annotations:{'workers/message':'Automatic rollback after failed release '+state.sha}});
  if(!same((await current()).versions,state.baseline.versions))throw Error('Rollback verification failed');
  state.rollback=rollback;writeFileSync('release-state.json',JSON.stringify(state,null,2));summary(`Automatic rollback verified: ${rollback.id}. D1/R2 unchanged.`);
 }
}else throw Error('Use stage, promote, or rollback');
