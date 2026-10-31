import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {env,sql,req,account,a,b,id} from './core-workspace-release-test.mjs';

sql.exec(readFileSync('worker/migrations/0019-workspace-invitations.sql','utf8'));
const c=await account('Carol');
const post=(path,headers,body)=>req(path,{method:'POST',headers,body});
const invites='/api/workspaces/'+id+'/invitations';
let r=await post('/api/workspaces/'+id+'/mode',a.headers,{mode:'shared',confirm:true,firstAccountId:b.id});
assert.equal(r.status,200,await r.text());
assert.equal(sql.prepare('SELECT COUNT(*) count FROM workspace_members WHERE workspace_id=?').get(id).count,0,'conversion cannot silently add the first member');
assert.equal((await req('/api/notes?cursor=0',{headers:{...b.headers,'X-Easybook-Workspace':id}})).status,403);
assert.equal((await post('/api/workspaces/'+id+'/members',a.headers,{accountId:b.id,role:'reader'})).status,409,'direct membership additions require acceptance');

r=await post(invites,a.headers,{kind:'account',accountId:b.id,role:'reader',expiresHours:24});
assert.equal(r.status,201,await r.clone().text());const first=(await r.json()).invitation;
assert.equal((await (await req('/api/workspaces/invitations',{headers:b.headers})).json()).invitations[0].id,first.id);
assert.equal((await req('/api/workspaces/invitations',{headers:c.headers}).then(r=>r.json())).invitations.length,0);
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:first.id,decision:'accept'})).status,403);
r=await post('/api/workspaces/invitations/respond',b.headers,{id:first.id,decision:'accept'});
assert.equal(r.status,200,await r.text());
assert.equal((await req('/api/notes?cursor=0',{headers:{...b.headers,'X-Easybook-Workspace':id}})).status,200);
assert.equal((await post('/api/workspaces/invitations/respond',b.headers,{id:first.id,decision:'accept'})).status,410);
assert.equal((await post('/api/workspaces/'+id+'/members',a.headers,{accountId:b.id,role:'editor'})).status,200,'accepted roles can be updated');

r=await post(invites,a.headers,{kind:'account',accountId:c.id,role:'reader'});assert.equal(r.status,201);const pending=(await r.json()).invitation;
assert.equal((await post(invites+'/revoke',a.headers,{id:pending.id})).status,200);
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:pending.id,decision:'accept'})).status,410);
r=await post(invites,a.headers,{kind:'account',accountId:c.id,role:'reader'});const rejected=(await r.json()).invitation;
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:rejected.id,decision:'reject'})).status,200);
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:rejected.id,decision:'accept'})).status,410);

r=await post(invites,a.headers,{kind:'link',role:'editor',expiresHours:1});
assert.equal(r.status,201,await r.clone().text());const link=await r.json(),token=new URL(link.url).searchParams.get('workspaceInvite');
assert.equal(link.qrRows.length>20,true);assert.equal(link.qrRows.length,link.qrRows[0].length);
assert.equal((await req('/api/workspaces/invitations/preview?token='+token,{headers:c.headers})).status,200);
assert.equal((await req('/api/workspaces/invitations/preview?token='+'0'.repeat(64),{headers:c.headers})).status,410);
assert.equal((await req('/api/workspaces/invitations/preview?token='+token)).status,401);
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:link.invitation.id,decision:'accept',token:'0'.repeat(64)})).status,403);
r=await post('/api/workspaces/invitations/respond',c.headers,{id:link.invitation.id,decision:'accept',token});
assert.equal(r.status,200,await r.text());
assert.equal((await post('/api/workspaces/invitations/respond',c.headers,{id:link.invitation.id,decision:'accept',token})).status,410);
assert.equal(sql.prepare('SELECT role FROM workspace_members WHERE workspace_id=? AND account_id=?').get(id,c.id).role,'editor');
assert.equal((await post(invites,a.headers,{kind:'link',role:'reader',expiresHours:73})).status,400);
console.log('PASS shared workspace invitations: consent, account inbox, single-use QR links, cross-account isolation, revocation, replay, role updates and keyless membership.');
