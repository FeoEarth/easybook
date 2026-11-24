import assert from 'node:assert/strict';
import {pruneBusiness,pruneSecurity,securityKeep} from '../backup-worker/retention.mjs';
const now=Date.UTC(2026,10,24),DAY=86400000,hash='a'.repeat(64);
const id=(age)=>new Date(now-age*DAY).toISOString().replace(/[:.]/g,'-')+'-00000000-0000-0000-0000-000000000000';
function bucket(){const data=new Map();return {data,async put(key,v){data.set(key,v)},async get(key){return data.has(key)?{json:async()=>JSON.parse(data.get(key))}:null},async list({prefix}){return {objects:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key,uploaded:new Date(now-10*DAY)})),truncated:false}},async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])data.delete(k)}}}
const b=bucket();
async function run(age,cas=true){const i=id(age),prefix='backups/'+i+'/',receipt={id:i,status:'complete',format:1,storageLayout:cas?'cas-v2':undefined,manifestKey:prefix+'manifest.json',manifestSha256:hash};
 await b.put(receipt.manifestKey,JSON.stringify({...receipt,database:{storageKey:prefix+'database.sql'},objects:cas?[{storageKey:'blobs/sha256/'+hash,sha256:hash}]:[]}));
 await b.put(prefix+'database.sql','test');return receipt}
const latest=await run(0);await run(1);const old=await run(40,false);await b.put('status/latest-success.json',JSON.stringify(latest));
const failed='backups/'+id(8)+'/status.json';await b.put(failed,'{}');const live='blobs/sha256/'+hash,orphan='blobs/sha256/'+'b'.repeat(64);await b.put(live,'live');await b.put(orphan,'old');
const guard=async()=>true;await pruneBusiness(b,latest,{now,guard});assert.ok(b.data.has(old.manifestKey));assert.ok(!b.data.has(failed));assert.ok(b.data.has(orphan));
await run(2);await pruneBusiness(b,latest,{now,guard});assert.ok(!b.data.has(old.manifestKey));assert.ok(b.data.has(live));assert.ok(!b.data.has(orphan));
const s=bucket();const checkpoints=[];
for(const age of [0,1/24,2/24,8.25,8.5,30,100,101]){const i=id(age),p='checkpoints/'+i+'/',m={status:'complete',sqlKey:p+'security.sql'};await s.put(p+'manifest.json',JSON.stringify(m));await s.put(m.sqlKey,'x');checkpoints.push(m)}
await s.put('status/latest.json',JSON.stringify(checkpoints[0]));await pruneSecurity(s,checkpoints[0],{now});assert.ok(s.data.has(checkpoints[0].sqlKey));assert.ok(s.data.has(checkpoints[3].sqlKey));assert.ok(!s.data.has(checkpoints[4].sqlKey));assert.ok(s.data.has(checkpoints[6].sqlKey));assert.ok(!s.data.has(checkpoints[7].sqlKey));
console.log('PASS CAS protection, failed cleanup, minimum retained generations, conservative blob sweep and security tiers');
