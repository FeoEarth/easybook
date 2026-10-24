import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
const dir=mkdtempSync(join(tmpdir(),'easybook-test-')),file=join(dir,'test.db');
const py=`import sqlite3,json,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row
out=[]
try:
 if p.get('script'):c.executescript(p['sql']);out={'results':[],'meta':{'changes':0}}
 else:
  c.execute('BEGIN')
  for s in p['statements']:
   q=c.execute(s['query'],s.get('params',[]));out.append({'results':[dict(r) for r in q.fetchall()],'meta':{'changes':max(q.rowcount,0)}})
 c.commit();print(json.dumps(out))
except: c.rollback();raise
`;
function execute(input){const r=spawnSync('python3',['-c',py],{input:JSON.stringify({file,...input}),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout)}
function sql(query,params=[],script=false){return script?execute({sql:query,script}):execute({statements:[{query,params}]})[0]}
const DB={prepare(query){return {query,params:[],bind(...p){this.params=p;return this},async all(){return sql(query,this.params)},async first(){return sql(query,this.params).results[0]||null},async run(){return sql(query,this.params)}}},async batch(statements){return execute({statements})}};

const token='a'.repeat(64);
async function request(data,key=token){const res=await worker.fetch(new Request('https://test.local/api/management',{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),{DB});return {status:res.status,...await res.json()}}
sql(readFileSync('worker/schema.sql','utf8'),[],true);
const a=crypto.randomUUID(),b=crypto.randomUUID(),n=crypto.randomUUID();
const op=(key,parent='',rank=0)=>({id:crypto.randomUUID(),key,parent,rank});
try{
 assert.equal((await request()).management.version,0);
 const first=op('f:'+a,b),accepted=await request({version:0,op:first});assert.equal(accepted.accepted,true);
 assert.equal((await request({version:0,op:first})).accepted,true,'lost ack replay');
 const stale=await request({version:0,op:op('f:'+n,'',1024)});assert.equal(stale.status,409);assert.equal(stale.management.items['f:'+a].parent,b);
 const cycle=await request({version:1,op:op('f:'+b,a)});assert.equal(cycle.rejected,true);assert.equal(cycle.management.version,1);
 const second=op('f:'+n,'',1024);assert.equal((await request({version:1,op:second})).accepted,true);
 assert.equal((await request(null,'b'.repeat(64))).management.version,0,'workspace isolation');
 const saved=await request();assert.equal(saved.management.items['f:'+n].rank,1024);assert.equal(saved.management.items['f:'+a].parent,b);
 assert.equal((await request({version:2,op:op('f:'+a,a)})).status,400);
 const before=JSON.stringify(saved.management);sql("INSERT INTO folders(workspace,id,name,updated,deleted) VALUES('legacy',?,'old client',1,0)",[a]);assert.equal(JSON.stringify((await request()).management),before,'legacy folder writes do not clear metadata');
 const retired=await request({version:0,op:op('n:'+crypto.randomUUID())});assert.equal(retired.retired,true);assert.equal(retired.management.version,saved.management.version);
 const workspace=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');const oldItems={...saved.management.items,['n:'+n]:{rank:9}};sql('UPDATE management_state SET items=? WHERE workspace=?',[JSON.stringify(oldItems),workspace]);sql(readFileSync('worker/migrations/0007-retire-note-placement.sql','utf8'),[],true);const migrated=await request();assert.deepEqual(migrated.management.items,saved.management.items);assert.equal(migrated.management.version,saved.management.version+1);
 console.log('PASS management API: additive schema, CAS/rebase, idempotent lost ack, cycle rejection, workspace isolation, legacy writes preserve metadata');
}finally{rmSync(dir,{recursive:true,force:true})}
