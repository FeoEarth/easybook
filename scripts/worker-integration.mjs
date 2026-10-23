import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
const dir=mkdtempSync(join(tmpdir(),'easybook-test-')),file=join(dir,'test.db');
const py=`import sqlite3,json,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row
if p.get('script'):c.executescript(p['sql']);rows=[];changes=0
else:
 q=c.execute(p['sql'],p.get('params',[]));rows=[dict(r) for r in q.fetchall()];changes=max(q.rowcount,0)
c.commit();print(json.dumps({'results':rows,'meta':{'changes':changes}}))`;
function sql(query,params=[],script=false){const r=spawnSync('python3',['-c',py],{input:JSON.stringify({file,sql:query,params,script}),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout)}
const DB={prepare(query){let params=[];return {bind(...p){params=p;return this},async all(){return sql(query,params)},async first(){return sql(query,params).results[0]||null},async run(){return sql(query,params)}}}};
const token='a'.repeat(64),other='b'.repeat(64),fid=crypto.randomUUID(),id=crypto.randomUUID();
async function request(path,data,key=token){const res=await worker.fetch(new Request('https://test.local'+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),{DB});return {status:res.status,...await res.json()}}
try{
 // Upgrade populated legacy schema: existing text remains intact.
 sql("CREATE TABLE notes(workspace TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,icon TEXT NOT NULL,favorite INTEGER NOT NULL,deleted INTEGER NOT NULL,version INTEGER NOT NULL,mutation TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(workspace,id)); INSERT INTO notes VALUES('legacy','id','旧笔记','保留内容','',0,0,1,'m',1);",[],true);
 sql(readFileSync('worker/migrations/0002-folders.sql','utf8'),[],true);assert.equal(sql("SELECT body,folder_id FROM notes WHERE workspace='legacy'").results[0].body,'保留内容');
 assert.equal((await request('/api/folders/'+fid,{name:'工作'})).status,200);assert.equal((await request('/api/folders')).folders[0].id,fid);
 let n={title:'采购',body:'牛奶',icon:'📄',folder_id:fid,favorite:0,deleted:0,version:0,mutation:crypto.randomUUID()};let r=await request('/api/notes/'+id,n);assert.equal(r.status,200);assert.equal(r.note.folder_id,fid);
 const retry=await request('/api/notes/'+id,n);assert.equal(retry.status,200);assert.equal(retry.note.version,1);
 n={...r.note,title:'旧版编辑',mutation:crypto.randomUUID()};delete n.folder_id;r=await request('/api/notes/'+id,n);assert.equal(r.status,200);assert.equal(r.note.folder_id,fid);
 n={...r.note,folder_id:'',mutation:crypto.randomUUID()};r=await request('/api/notes/'+id,n);assert.equal(r.note.folder_id,'');
 n={...r.note,folder_id:fid,mutation:crypto.randomUUID()};r=await request('/api/notes/'+id,n);assert.equal(r.note.folder_id,fid);assert.equal((await request('/api/notes')).notes[0].folder_id,fid);
 assert.equal((await request('/api/folders',undefined,other)).folders.length,0);assert.equal((await request('/api/notes',undefined,other)).notes.length,0);
 assert.equal((await request('/api/notes/'+id,{...r.note,folder_id:crypto.randomUUID(),mutation:crypto.randomUUID()})).status,400);
 assert.equal((await request('/api/notes/'+id,{...n,version:1,mutation:crypto.randomUUID()})).status,409);
 assert.equal((await request('/api/folders/'+crypto.randomUUID(),{name:' '})).status,400);
 console.log('PASS: SQLite migration, folder sync, note assignment, retry/conflict, legacy edit preservation, unfile/reassign, workspace isolation, invalid folder rejection');
}finally{rmSync(dir,{recursive:true,force:true})}
