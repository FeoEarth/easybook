import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {HDKey} from '@scure/bip32';
import {addMonths,deriveAddress,plans} from '../worker/membership.mjs';
import {settle} from '../worker/membership-scanner.mjs';
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

try{
 sql("CREATE TABLE accounts(id TEXT PRIMARY KEY,deleted_at INTEGER); INSERT INTO accounts VALUES('a',NULL);",[],true);
 sql(readFileSync('worker/migrations/0023-membership.sql','utf8'),[],true);
 const root=HDKey.fromMasterSeed(new Uint8Array(32).fill(1));
 assert.equal(deriveAddress(root.publicExtendedKey,1),deriveAddress(root.publicExtendedKey,1));
 assert.notEqual(deriveAddress(root.publicExtendedKey,1),deriveAddress(root.publicExtendedKey,2));
 assert.throws(()=>deriveAddress(root.privateExtendedKey,1));
 assert.equal(new Date(addMonths(Date.UTC(2024,0,31),1)).toISOString(),'2024-02-29T00:00:00.000Z');
 assert.equal(plans.length,4);
 const address=deriveAddress(root.publicExtendedKey,1),c={chainId:137,token:'0x'+'a'.repeat(40)};
 function order(id,months=1){sql('INSERT INTO membership_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',[id,'a','month',months,137,c.token,'10000',id==='one'?address:'0x'+'b'.repeat(40),id,Date.now(),Date.now()+1800000]);}
 order('one');
 const log={address:c.token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'0'.repeat(64),'0x'+address.slice(2).padStart(64,'0')],data:'0x'+(10000n).toString(16).padStart(64,'0'),transactionHash:'0x'+'1'.repeat(64),logIndex:'0x0',blockNumber:'0x10'};
 await settle({DB},c,log);const first=sql('SELECT * FROM account_memberships').results[0];assert.ok(first.expires_at>Date.now());
 await settle({DB},c,log);assert.equal(sql('SELECT COUNT(*) n FROM membership_changes').results[0].n,1);
 await settle({DB},c,{...log,transactionHash:'0x'+'2'.repeat(64)});assert.equal(sql("SELECT status FROM membership_receipts WHERE tx=?",['0x'+'2'.repeat(64)]).results[0].status,'duplicate_payment');
 order('two',0);const permanentLog={...log,transactionHash:'0x'+'3'.repeat(64),topics:[...log.topics.slice(0,2),'0x'+'b'.repeat(40).padStart(64,'0')]};
 await settle({DB},c,permanentLog);assert.equal(sql('SELECT permanent FROM account_memberships').results[0].permanent,1);
 assert.equal(sql('SELECT COUNT(*) n FROM membership_changes').results[0].n,2);
 const mismatch={...log,transactionHash:'0x'+'4'.repeat(64),data:'0x'+(9999n).toString(16).padStart(64,'0')};await settle({DB},c,mismatch);assert.equal(sql('SELECT status FROM membership_receipts WHERE tx=?',[mismatch.transactionHash]).results[0].status,'amount_mismatch');
 const count=sql('SELECT COUNT(*) n FROM membership_receipts').results[0].n;await settle({DB},c,{...log,address:'0x'+'f'.repeat(40)});assert.equal(sql('SELECT COUNT(*) n FROM membership_receipts').results[0].n,count);
 sql("UPDATE account_memberships SET permanent=0,expires_at=?",[Date.UTC(2030,0,31)]);sql("UPDATE membership_orders SET settled_at=NULL WHERE id='one'");sql("DELETE FROM membership_changes WHERE order_id='one'");await settle({DB},c,{...log,transactionHash:'0x'+'5'.repeat(64)});assert.equal(sql('SELECT expires_at FROM account_memberships').results[0].expires_at,Date.UTC(2030,1,28));
 for(const [id,suffix] of [['three','c'],['four','d']])sql('INSERT INTO membership_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',[id,'a','month',1,137,c.token,'10000','0x'+suffix.repeat(40),id,Date.now(),Date.now()+1800000]);
 await Promise.all(['c','d'].map((suffix,i)=>settle({DB},c,{...log,transactionHash:'0x'+String(i+6).repeat(64),topics:[...log.topics.slice(0,2),'0x'+suffix.repeat(40).padStart(64,'0')]})));
 assert.equal(sql('SELECT expires_at FROM account_memberships').results[0].expires_at,Date.UTC(2030,3,28));
 console.log('membership transaction tests passed');
}finally{rmSync(dir,{recursive:true,force:true})}
