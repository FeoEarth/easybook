import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {digest} from './backup-core.mjs';

const directory=mkdtempSync(join(tmpdir(),'easybook-backup-runner-'));
try {
 const bytes=Buffer.from('Synthetic legacy attachment'),id=digest(bytes),base='a'.repeat(64)+'/'+id;
 const sql=`CREATE TABLE notes_json(workspace TEXT,document TEXT,purged INTEGER); CREATE TABLE security_restore_state(id INTEGER,epoch TEXT); INSERT INTO security_restore_state VALUES(1,'fixture');`;
 const fixture={sql,base,bytes:bytes.toString('base64')};
 const preload=join(directory,'mock.mjs'),report=join(directory,'report.json');
 writeFileSync(preload,`
import {writeFileSync} from 'node:fs';
const fixture=${JSON.stringify(fixture)},stored=new Map(),writes=[];let signedAuthorization=false;
const json=value=>Response.json({success:true,...value});
globalThis.fetch=async (input,options={})=>{
 const url=new URL(input),p=url.pathname,method=options.method||'GET';
 if(url.hostname==='backup.invalid') {signedAuthorization=!!options.headers?.Authorization;return new Response(fixture.sql);}
 if(p.endsWith('/domains/managed'))return json({result:{enabled:false}});
 if(p.endsWith('/domains/custom'))return json({result:{domains:[]}});
 if(p.endsWith('/lifecycle'))return json({result:{rules:[{enabled:true,conditions:{prefix:'backups/'},deleteObjectsTransition:{condition:{type:'Age',maxAge:2592000}}}]}});
 if(p.endsWith('/query'))return json({result:[{results:[{mode:'open',epoch:process.env.BACKUP_SCENARIO==='epoch'?'different':'fixture'}]}]});
 if(p.endsWith('/export'))return json({result:{status:'complete',result:{signed_url:'https://backup.invalid/export.sql'}}});
 if(p.endsWith('/easybook-attachments/objects'))return json({result:[{key:fixture.base,http_metadata:{contentType:'text/plain'},custom_metadata:{name:'Fixture'}}],result_info:{is_truncated:false}});
 if(p.includes('/easybook-attachments/objects/'))return process.env.BACKUP_SCENARIO==='missing'?new Response('',{status:404}):new Response(Buffer.from(fixture.bytes,'base64'));
 if(p.includes('/easybook-backups/objects/')) {
  if(method==='PUT'){stored.set(p,Buffer.from(options.body));writes.push(p);return json({result:{}});}
  return stored.has(p)?new Response(stored.get(p)):new Response('',{status:404});
 }
 throw Error('unexpected_fixture_request');
};
process.on('exit',()=>writeFileSync(process.env.BACKUP_REPORT,JSON.stringify({writes,signedAuthorization,manifests:[...stored].filter(([key])=>key.endsWith('/manifest.json')).map(([,value])=>JSON.parse(value))})));
`);
 for(const scenario of ['success','missing','epoch']) {
  const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,resolve('scripts/cloudflare-backup.mjs')],{env:{...process.env,CLOUDFLARE_API_TOKEN:'synthetic-token',CLOUDFLARE_ACCOUNT_ID:'synthetic-account',BACKUP_REPORT:report,BACKUP_SCENARIO:scenario},encoding:'utf8',timeout:10000});
  assert.equal(result.status,scenario==='success'?0:1,result.stderr);
  const record=JSON.parse(readFileSync(report,'utf8'));
  assert.equal(record.signedAuthorization,false,'signed export URL must not receive API token');
  assert.equal(record.manifests.length,scenario==='success'?1:0,'failed backups cannot publish completion manifests');
  assert.equal(record.writes.some(p=>p.endsWith('/status/latest-success.json')),scenario==='success');
  if(scenario==='success')assert.equal(record.manifests[0].objects[0].customMetadata.name,'Fixture','legacy metadata survives in manifest');
 }
 console.log('PASS backup runner with isolated Cloudflare fixture: export polling response, destination read-back, private lifecycle checks, success receipt, missing-object failure, checkpoint mismatch and token separation.');
} finally {rmSync(directory,{recursive:true,force:true});}
