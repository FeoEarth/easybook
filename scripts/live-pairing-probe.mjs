import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
const origin=process.argv[2];if(!origin)throw Error('Pass candidate origin');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const endpoint=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/af430aed-01b5-41ca-9653-31212bed3f9f/query`;
async function sql(query,params){const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql:query,params})});const d=await r.json();if(!r.ok||!d.success||d.result.some(x=>!x.success))throw Error('Synthetic D1 probe failed');return d.result[0].results}
const challenge=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(challenge).digest('hex');
const key=randomBytes(32).toString('hex'),workspace=createHash('sha256').update(key).digest('hex');
const client='release-probe-'+randomBytes(12).toString('hex'),user='synthetic-release-probe';
const oauth='https://easybook-mcp-oauth.1902521952.workers.dev';
const headers={Origin:'https://easybook.loonxy.com','Content-Type':'application/json'};
try{
 await sql('INSERT INTO mcp_pairing_challenges(challenge_hash,github_user_id,oauth_client_id,expires_at) VALUES(?,?,?,?)',[hash,user,client,String(Math.floor(Date.now()/1000)+300)]);
 const preflight=await fetch(origin+'/api/mcp/attest',{method:'OPTIONS',headers:{Origin:headers.Origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});assert.equal(preflight.status,204);
 const proof=await fetch(origin+'/api/mcp/attest',{method:'POST',headers:{...headers,Authorization:'Bearer '+key},body:JSON.stringify({challenge})});assert.equal(proof.status,200,'Attestation failed');const {assertion}=await proof.json();assert.equal(typeof assertion,'string');
 const complete=()=>fetch(oauth+'/pairing/complete',{method:'POST',headers,body:JSON.stringify({challenge,assertion})});
 const paired=await complete();assert.equal(paired.status,200,'Live signing keys or challenge verification failed');assert.equal((await paired.json()).paired,true);
 const grants=await sql('SELECT scope,workspace_id FROM mcp_workspace_grants WHERE github_user_id=? AND oauth_client_id=?',[user,client]);assert.equal(grants.length,1);assert.equal(grants[0].workspace_id,workspace);assert.equal(grants[0].scope,'mcp:read');
 assert.equal((await complete()).status,409,'Challenge replay accepted');
 console.log('PASS: live preflight, synthetic attestation, cross-Worker HMAC, one-time challenge, read-only grant; no user notes accessed');
}finally{
 await sql('DELETE FROM mcp_workspace_grants WHERE github_user_id=? AND oauth_client_id=?',[user,client]);
 await sql('DELETE FROM mcp_active_workspaces WHERE github_user_id=? AND oauth_client_id=?',[user,client]);
 await sql('DELETE FROM mcp_pairing_challenges WHERE challenge_hash=? AND github_user_id=?',[hash,user]);
}
