import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {list,textDocument} from '../worker/mcp-notes.mjs';

const db=new DatabaseSync(':memory:');db.exec(readFileSync('worker/schema.sql','utf8'));
const workspace='a'.repeat(64),ids=[];
const DB={prepare(query){const statement=db.prepare(query);let params=[];return {bind(...p){params=p;return this},async all(){return {results:statement.all(...params)}}}}};
const ctx={env:{DB},workspace};
try{
 for(let i=0;i<3;i++){
  const id=crypto.randomUUID();ids.push(id);
  db.prepare('INSERT INTO notes_json(workspace,id,title,document,icon,pinned,favorite,deleted,purged,version,mutation,updated,folder_id) VALUES(?,?,?,?,?,0,0,0,0,1,?,?,?)').run(workspace,id,'Search 中文 🚀 café '+i,JSON.stringify(textDocument('正文')),'📄',crypto.randomUUID(),i+1,'');
 }
 for(const query of ['中文','🚀','café','Search']){
  const found=[];let cursor;
  do{
   const page=await list(ctx,{query,limit:1,...(cursor?{cursor}:{})},true);
   found.push(...page.notes.map(n=>n.id));cursor=page.next_cursor;
  }while(cursor);
  assert.deepEqual(found,[...ids].reverse(),query+' pages preserve all matches and ordering');
 }
 const first=await list(ctx,{query:'中文',limit:1},true);
 await assert.rejects(()=>list(ctx,{query:'🚀',limit:1,cursor:first.next_cursor},true),e=>e.code==='INVALID_ARGUMENT');
 for(const cursor of ['not base64! ',btoa('not json'),btoa(JSON.stringify([1,ids[0],'wrong query']))])await assert.rejects(()=>list(ctx,{query:'中文',limit:1,cursor},true),e=>e.code==='INVALID_ARGUMENT');
 // Previously issued Latin1 and ASCII cursors must still decode unchanged.
 for(const query of ['café','Search']){
  const cursor=btoa(JSON.stringify([3,ids[2],JSON.stringify([null,false,query,false])]));
  const next=await list(ctx,{query,limit:1,cursor},true);assert.equal(next.notes[0].id,ids[1]);
 }
 console.log('PASS MCP note search pagination: Chinese/emoji/Latin1/ASCII queries, legacy cursors, query binding, and malformed cursor rejection.');
}finally{db.close();}
