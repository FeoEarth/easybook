import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const expected=JSON.parse(readFileSync('infra/resource-inventory.json','utf8'));
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AUDIT_TOKEN||process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('audit credentials missing');
const base='https://api.cloudflare.com/client/v4/accounts/'+account,issues=[],notes=[],failures=[];
const flag=(code,name)=>issues.push({code,name});
async function api(path,{raw=false}={}){
 const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 const j=await r.json();if(raw)return j;if(j.success===false)throw Error('API rejected');return j.result;
}
async function check(name,fn){try{return await fn()}catch(e){failures.push({check:name,reason:/^HTTP \d+$/.test(e.message)?e.message:'unavailable'});return null}}
const [ws,ds,ks,rs]=await Promise.all([check('workers',()=>api('/workers/scripts')),check('D1',()=>api('/d1/database?per_page=100')),check('KV',()=>api('/storage/kv/namespaces?per_page=100')),check('R2',()=>api('/r2/buckets'))]);
const buckets=rs?.buckets||rs,ids=new Map((ds||[]).map(d=>[d.uuid,d.name])),kvids=new Map((ks||[]).map(k=>[k.id,k.title]));
function compare(kind,actual,wanted){if(!actual)return;for(const n of wanted)if(!actual.includes(n))flag('missing_'+kind,n);const added=actual.filter(n=>!wanted.includes(n));if(added.length)notes.push({code:'unregistered_'+kind,count:added.length})}
compare('worker',ws?.map(w=>w.id),Object.keys(expected.workers));compare('d1',ds?.map(d=>d.name),expected.d1);compare('kv',ks?.map(k=>k.title),expected.kv);compare('r2',buckets?.map(b=>b.name),expected.r2);
const bound={d1:new Set(),kv:new Set(),r2:new Set()},releases={};
for(const name of Object.keys(expected.workers)){
 if(!ws?.some(w=>w.id===name))continue;
 const e=expected.workers[name],p='/workers/scripts/'+encodeURIComponent(name);
 const [s,u,t]=await Promise.all([check(name+' settings',()=>api(p+'/settings')),check(name+' public',()=>api(p+'/subdomain')),check(name+' tags',()=>api(p+'/script-settings'))]);
 if(u&&u.enabled!==e.public)flag('public_access_drift',name);
 if(u&&e.public===false&&u.previews_enabled)flag('preview_access_drift',name);
 if(!s)continue;
 if(t&&e.tags.some(tag=>!t.tags?.includes(tag)))flag('tag_drift',name);
 const release=s.bindings?.find(b=>b.name==='RELEASE_SHA'&&b.type==='plain_text')?.text;if(release)releases[name]=release;
 const actual={d1:[],kv:[],r2:[],services:[]};
 for(const b of s.bindings||[]){if(b.type==='d1'){const n=ids.get(b.id);if(n){actual.d1.push(n);bound.d1.add(n)}}if(b.type==='kv_namespace'){const n=kvids.get(b.namespace_id||b.id);if(n){actual.kv.push(n);bound.kv.add(n)}}if(b.type==='r2_bucket'){actual.r2.push(b.bucket_name);bound.r2.add(b.bucket_name)}if(b.type==='service')actual.services.push(b.service)}
 for(const k of Object.keys(actual)){if(k==='d1'&&!ds||k==='kv'&&!ks)continue;const a=actual[k].sort(),wanted=[...(e[k]||[])].sort();if(JSON.stringify(a)!==JSON.stringify(wanted))flag('binding_drift_'+k,name)}
 if(!!e.browser!==s.bindings.some(b=>b.type==='browser'))flag('browser_binding_drift',name);
}
if(!failures.some(f=>f.check.endsWith(' settings'))){for(const k of ['d1','kv','r2']){if(k==='d1'&&!ds||k==='kv'&&!ks||k==='r2'&&!buckets)continue;for(const n of expected[k])if(!bound[k].has(n)&&!expected.exceptions['unbound'+k.toUpperCase()]?.includes(n))flag('unbound_'+k,n)}}
for(const [a,b] of [['easybook-sync','easybook-mcp-oauth'],['easybook-payments','easybook-collections']])if(releases[a]&&releases[b]&&releases[a]!==releases[b])notes.push({code:'release_pair_drift',count:1,pair:[a,b]});
for(const n of expected.privateR2){
 const p='/r2/buckets/'+n;
 const [m,c]=await Promise.all([check(n+' managed domain',()=>api(p+'/domains/managed')),check(n+' custom domains',()=>api(p+'/domains/custom'))]);
 if(m?.enabled||c?.domains?.some(d=>d.enabled))flag('backup_bucket_public',n);
}
const receipt=await check('latest business backup',()=>api('/r2/buckets/easybook-backups/objects/status/latest-success.json',{raw:true}));
const security=await check('latest security checkpoint',()=>api('/r2/buckets/easybook-security-checkpoints/objects/status/latest.json',{raw:true}));
if(receipt&&(receipt.status!=='complete'||!Number.isFinite(Date.parse(receipt.completedAt))||Date.now()-Date.parse(receipt.completedAt)>36*3600000))flag('business_backup_stale','easybook-backups');
if(security&&(security.status!=='complete'||!Number.isFinite(Date.parse(security.capturedAt))||Date.now()-Date.parse(security.capturedAt)>3*3600000))flag('security_checkpoint_stale','easybook-security-checkpoints');
const lifecycle=await check('backup lifecycle',()=>api('/r2/buckets/easybook-backups/lifecycle'));
if(lifecycle?.rules?.some(r=>r.enabled&&r.deleteObjectsTransition))flag('unsafe_backup_expiration','easybook-backups');
const storage={};for(const n of expected.r2){if(!buckets?.some(b=>b.name===n))continue;const value=await check(n+' storage',async()=>{let cursor,count=0,bytes=0,pages=0;do{const q=new URLSearchParams({per_page:'1000',...(cursor?{cursor}:{})});const r=await api('/r2/buckets/'+n+'/objects?'+q,{raw:true});if(!Array.isArray(r.result))throw Error('invalid listing');for(const o of r.result){count++;bytes+=Number(o.size||0)}const next=r.result_info?.cursor;if(!r.result_info?.is_truncated)break;if(!next||next===cursor||++pages>=100)throw Error('listing limit');cursor=next;}while(true);return {objects:count,bytes}});if(value)storage[n]=value;}
const metrics=await check('Worker analytics',async()=>{const until=new Date().toISOString(),since=new Date(Date.now()-86400000).toISOString();const query='query { viewer { accounts(filter:{accountTag:'+JSON.stringify(account)+'}) { workersInvocationsAdaptive(limit:100,filter:{datetime_geq:'+JSON.stringify(since)+',datetime_lt:'+JSON.stringify(until)+'}) { sum { requests errors cpuTimeUs } dimensions { scriptName } } } } }';const r=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.errors?.length||!Array.isArray(j.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive))throw Error('analytics unavailable');return j.data.viewer.accounts[0].workersInvocationsAdaptive.filter(x=>Object.hasOwn(expected.workers,x.dimensions.scriptName)).map(x=>({name:x.dimensions.scriptName,requests:x.sum.requests,errors:x.sum.errors,cpuTimeUs:x.sum.cpuTimeUs}));});
for(const m of metrics||[]){if(m.errors>=10&&m.errors/Math.max(1,m.requests)>=0.1)flag('elevated_worker_error_rate',m.name);if(m.requests>100000)notes.push({code:'high_worker_volume',count:1,pair:[m.name]})}
const report={at:new Date().toISOString(),storage,metrics,counts:{workers:ws?.length??null,d1:ds?.length??null,kv:ks?.length??null,r2:buckets?.length??null},issues,notes,failures};
writeFileSync('resource-health-report.json',JSON.stringify(report,null,2)+'\n');
const summary=['## Cloudflare resource audit','Read-only; no resource values or credentials included.','',JSON.stringify(report.counts),'',...issues.map(x=>'- '+x.code+': '+x.name),...notes.map(x=>'- '+x.code+': '+(x.pair?.join(' / ')||x.count)),...failures.map(x=>'- '+x.check+': '+x.reason)].join('\n');
console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
if(issues.length||failures.length)process.exitCode=1;
