import {scanMembership} from '../worker/membership-scanner.mjs';
import {timingSafeEqual} from 'node:crypto';
import {requireRestoreAccess} from '../worker/security-checkpoint.mjs';
async function run(env){
 await requireRestoreAccess(env);const owner=crypto.randomUUID(),now=Date.now();
 const lease=await env.DB.prepare('INSERT INTO membership_job_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<? RETURNING id').bind(owner,now+120000,now).first();
 if(!lease)return {running:true};
 try{await scanMembership(env);return {completed:true}}finally{await env.DB.prepare('UPDATE membership_job_lease SET expires_at=? WHERE id=1 AND owner=?').bind(Date.now()+30000,owner).run()}
}
export default {
 async scheduled(controller,env,ctx){ctx.waitUntil(run(env))},
 async fetch(request,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/run')return new Response('Not found',{status:404});
 const expected=env.MEMBERSHIP_JOB_TOKEN,received=request.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!expected||!received||received.length>200)return new Response('Not found',{status:404});
 const encode=new TextEncoder(),a=encode.encode(expected),b=encode.encode(received);
 if(a.length!==b.length||!timingSafeEqual(a,b))return new Response('Not found',{status:404});
 try{return Response.json(await run(env),{headers:{'Cache-Control':'no-store'}})}catch{console.error(JSON.stringify({event:'membership_job_failed'}));return Response.json({error:'scanner_unavailable'},{status:503})}
 }
};
