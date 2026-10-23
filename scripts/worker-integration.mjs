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
const token='a'.repeat(64),other='b'.repeat(64),fid=crypto.randomUUID(),id=crypto.randomUUID();
async function request(path,data,key=token){const res=await worker.fetch(new Request('https://test.local'+path,{method:data?'PUT':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),{DB});return {status:res.status,...await res.json()}}
try{
 sql(readFileSync('worker/schema.sql','utf8'),[],true);
 const {fixture}=await import('./document-test.mjs');
 assert.equal((await request('/api/folders/'+fid,{name:'工作'})).status,200);
 let n={title:'采购',document:fixture,icon:'📄',folder_id:fid,favorite:0,pinned:0,deleted:0,version:0,mutation:crypto.randomUUID()};
 let r=await request('/api/notes/'+id,n);assert.equal(r.status,200);assert.deepEqual(r.note.document,fixture);assert.equal(r.note.version,1);
 const first=n,firstReply=r.note;
 const retry=await request('/api/notes/'+id,n);assert.equal(retry.status,200);assert.equal(retry.note.version,1);
 n={...r.note,title:'下一版',favorite:1,pinned:1,mutation:crypto.randomUUID()};r=await request('/api/notes/'+id,n);assert.equal(r.status,200);assert.equal(r.note.version,2);
 // A delayed retry must return its immutable receipt even after later successful edits.
 const delayed=await request('/api/notes/'+id,first);assert.equal(delayed.status,200);assert.deepEqual(delayed.note,firstReply);
 assert.equal((await request('/api/notes/'+id,{...first,title:'payload tampered'})).status,409);
 assert.equal((await request('/api/notes/'+id,{...n,version:1,mutation:crypto.randomUUID()})).status,409);
 assert.equal((await request('/api/notes/'+id,{...r.note,body:'<p>bad</p>',mutation:crypto.randomUUID()})).status,400);
 assert.equal((await request('/api/notes/'+id,{...r.note,document:{schemaVersion:2,doc:fixture.doc},mutation:crypto.randomUUID()})).status,400);
 assert.equal((await request('/api/notes/'+id,{...r.note,folder_id:crypto.randomUUID(),mutation:crypto.randomUUID()})).status,400);
 const pull=await request('/api/notes?cursor=0');assert.equal(pull.notes.length,2);assert.equal(pull.notes.at(-1).title,'下一版');assert.equal((await request('/api/notes?cursor='+pull.cursor)).notes.length,0);
 n={...r.note,deleted:1,mutation:crypto.randomUUID()};r=await request('/api/notes/'+id,n);assert.equal(r.note.version,3);assert.equal((await request('/api/notes?cursor='+pull.cursor)).notes[0].deleted,1);
 assert.equal((await request('/api/notes',undefined,other)).notes.length,0);assert.equal((await request('/api/folders',undefined,other)).folders.length,0);
 assert.equal((await request('/api/notes?cursor=invalid')).status,400);assert.equal((await request('/api/notes',undefined,'invalid')).status,401);
 // Failed batch must roll back both note and change feed.
 const before=sql('SELECT count(*) AS n FROM note_changes').results[0].n;
 await assert.rejects(()=>DB.batch([DB.prepare('UPDATE notes_json SET title=? WHERE id=?').bind('rolled back',id),DB.prepare('INSERT INTO missing_table VALUES(1)')]));assert.equal(sql('SELECT count(*) AS n FROM note_changes').results[0].n,before);assert.notEqual(sql('SELECT title FROM notes_json WHERE id=?',[id]).results[0].title,'rolled back');
 console.log('PASS Worker: JSON create/read, CAS conflict, durable replay receipt after later writes, payload mismatch, cursor/tombstone, workspace isolation, transactional rollback');
}finally{rmSync(dir,{recursive:true,force:true})}
