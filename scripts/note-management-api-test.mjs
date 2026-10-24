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
 const doc={schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'保密正文'}]}]}};
 const initial={id,title:'笔记',document:doc,icon:'📄',pinned:0,favorite:0,deleted:0,folder_id:'',version:0,mutation:crypto.randomUUID()};
 let first=await request('/api/notes/'+id,initial);assert.equal(first.status,200);
 let pin=await request('/api/notes/'+id,{...first.note,pinned:1,mutation:crypto.randomUUID()});assert.equal(pin.note.pinned,1);
 let trash=await request('/api/notes/'+id,{...pin.note,deleted:1,mutation:crypto.randomUUID()});assert.equal(trash.note.deleted,1);
 const softStale=await request('/api/notes/'+id,{...pin.note,title:'stale',mutation:crypto.randomUUID()});assert.equal(softStale.status,409);assert.equal(softStale.note.deleted,1);
 let restore=await request('/api/notes/'+id,{...trash.note,deleted:0,mutation:crypto.randomUUID()});assert.equal(restore.note.deleted,0);
 const old=restore.note;
 trash=await request('/api/notes/'+id,{...old,deleted:1,mutation:crypto.randomUUID()});
 const purgeRequest={...trash.note,purged:1,mutation:crypto.randomUUID()};
 const purge=await request('/api/notes/'+id,purgeRequest);assert.equal(purge.status,200);assert.equal(purge.note.purged,1);assert.equal(purge.note.title,'');assert.equal(purge.note.document.doc.content[0].content,undefined);
 const stale=await request('/api/notes/'+id,{...old,title:'旧设备尝试复活',mutation:crypto.randomUUID()});assert.equal(stale.note.purged,1);assert.equal(stale.note.title,'');
 const replay=await request('/api/notes/'+id,initial);assert.equal(replay.note.purged,1);assert.equal(replay.note.title,'');
 const again=await request('/api/notes/'+id,purgeRequest);assert.equal(again.note.version,purge.note.version);
 const feed=await request('/api/notes?cursor=0');assert(feed.notes.every(n=>n.id!==id||n.purged===1));assert(!JSON.stringify(sql('SELECT response FROM note_receipts').results).includes('保密正文'));
 const ts=Date.now();let folder=await request('/api/folders/'+fid,{name:'收件箱',updated:ts,deleted:0});assert.equal(folder.folder.name,'收件箱');
 folder=await request('/api/folders/'+fid,{name:'项目',updated:ts+1,deleted:0});assert.equal(folder.folder.name,'项目');
 folder=await request('/api/folders/'+fid,{name:'旧名称',updated:ts,deleted:0});assert.equal(folder.folder.name,'项目');
 folder=await request('/api/folders/'+fid,{name:'项目',updated:ts+2,deleted:1});assert.equal(folder.folder.deleted,1);
 folder=await request('/api/folders/'+fid,{name:'旧设备恢复',updated:ts+3,deleted:0});assert.equal(folder.folder.deleted,1);assert.equal(folder.folder.name,'项目');
 const folderFeed=await request('/api/folders');assert.equal(folderFeed.folders.find(f=>f.id===fid).deleted,1);
 assert.equal((await request('/api/notes?cursor=0',undefined,other)).notes.length,0);
 console.log('PASS management API: pin, soft delete/restore, terminal purge, stale writes/replay, change feed, receipt erasure, folder rename/delete/stale writes, workspace isolation');
}finally{rmSync(dir,{recursive:true,force:true})}
