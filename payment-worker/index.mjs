import {scanMembership} from '../worker/membership-scanner.mjs';
import {timingSafeEqual} from 'node:crypto';
import {requireRestoreAccess} from '../worker/security-checkpoint.mjs';
async function run(env){
 await requireRestoreAccess(env);const owner=crypto.randomUUID(),now=Date.now();
 const lease=await env.DB.prepare('INSERT INTO membership_job_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<? RETURNING id').bind(owner,now+120000,now).first();
 if(!lease)return {running:true};
 try{const result=await scanMembership(env);if(Array.isArray(result)&&result.some(x=>x===false))throw Error('membership_scan_incomplete');return {completed:true}}finally{await env.DB.prepare('UPDATE membership_job_lease SET expires_at=? WHERE id=1 AND owner=?').bind(Date.now()+30000,owner).run()}
}
export async function paymentDue(env,now=Date.now()){
 if(env.MEMBERSHIP_ENABLED!=='true')return false;
 if(Math.floor(now/60000)%5===0)return true;
 const row=await env.DB.prepare('SELECT EXISTS(SELECT 1 FROM membership_purchases WHERE settled_at IS NULL AND cancelled_at IS NULL AND expires_at>?) OR EXISTS(SELECT 1 FROM membership_gift_orders WHERE settled_at IS NULL AND cancelled_at IS NULL AND expires_at>?) OR EXISTS(SELECT 1 FROM membership_scan_windows) OR EXISTS(SELECT 1 FROM membership_cursors WHERE updated_at<?) AS due').bind(now,now,now-5*60000).first();
 return !!row?.due;
}
export async function financeTick(env,now=Date.now()){
 const jobs=[(async()=>{if(await paymentDue(env,now))return run(env);return {skipped:true}})()];
 // Retry at the next eligible tick; active signed/broadcast transactions retain priority.
 if(Math.floor(now/60000)%2===0||Math.floor(now/60000)%15===0)jobs.push((async()=>{if(!env.COLLECTION_SCHEDULER)throw Error('collection_scheduler_missing');return env.COLLECTION_SCHEDULER.tick()})());
 const result=await Promise.allSettled(jobs);if(result.some(r=>r.status==='rejected'))throw Error('financial_maintenance_incomplete');return result.map(r=>r.value);
}
export default {
 async scheduled(controller,env,ctx){ctx.waitUntil(financeTick(env,controller.scheduledTime||Date.now()))},
 async fetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/run')return new Response('Not found',{status:404});
 const expected=env.MEMBERSHIP_JOB_TOKEN,received=request.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!expected||!received||received.length>200)return new Response('Not found',{status:404});
 const encode=new TextEncoder(),a=encode.encode(expected),b=encode.encode(received);
 if(a.length!==b.length||!timingSafeEqual(a,b))return new Response('Not found',{status:404});
 try{return Response.json(await run(env),{headers:{'Cache-Control':'no-store'}})}catch{console.error(JSON.stringify({event:'membership_job_failed'}));return Response.json({error:'scanner_unavailable'},{status:503})}
 }
};
