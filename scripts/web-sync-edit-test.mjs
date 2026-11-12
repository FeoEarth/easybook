import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {WebStore} from '../shared/web-store.mjs';

const html=readFileSync('app/src/main/assets/index.html','utf8'),editor=readFileSync('app/src/main/assets/editor.js','utf8');
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),document=(a,b)=>({schemaVersion:1,doc:{type:'doc',content:[paragraph(a),paragraph(b)]}});
async function waitFor(condition,message){const deadline=Date.now()+5000;while(!await condition()){assert.ok(Date.now()<deadline,message);await new Promise(resolve=>setTimeout(resolve,10))}}

async function scenario(purged=false){
 const indexedDB=new IDBFactory(),store=new WebStore(indexedDB);await store.open();
 const key='a'.repeat(64),base={id:crypto.randomUUID(),title:'原始标题',document:document('A','B'),icon:'📄',pinned:0,favorite:0,deleted:0,purged:0,folder_id:'',version:4,mutation:crypto.randomUUID(),updated:1};
 const local={...base,title:'发出请求时的标题',mutation:crypto.randomUUID(),dirty:true};
 const remote={...base,title:purged?'':base.title,document:purged?{schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}}:document('A','云端新正文'),version:5,mutation:crypto.randomUUID(),updated:2,...(purged?{deleted:1,purged:1}:{})};
 await store.load(key);await store.save(key,{notes:[local],folders:[],inflight:{},cursor:0,bases:{[base.id]:base},conflicts:[]});await store.setActiveCredential(key);
 const page=new JSDOM(html,{url:'https://easybook.test',runScripts:'outside-only',pretendToBeVisual:true}),get=id=>page.window.document.getElementById(id);
 try{
  page.window.TextEncoder=TextEncoder;page.window.Headers=Headers;page.window.indexedDB=indexedDB;page.window.scrollTo=()=>{};
  page.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};page.window.HTMLDialogElement.prototype.close=function(){this.open=false};
  Object.defineProperty(page.window,'crypto',{value:crypto});let online=false;Object.defineProperty(page.window.navigator,'onLine',{get:()=>online});
  page.window.localStorage.setItem('easybook-sync-policy:'+await store.namespace(key),JSON.stringify({autoChange:false,interval:0}));
  let sent,release;
  page.window.fetch=async(input,options={})=>{
   const path=new URL(String(input)).pathname;
   if(path==='/api/folders')return Response.json({folders:[],next:null});
   if(path==='/api/management')return Response.json({management:{version:0,items:{}}});
   if(path==='/api/notes/'+base.id){assert.equal(options.method,'PUT');sent=JSON.parse(options.body);return new Promise(resolve=>{release=()=>resolve(Response.json({note:remote},{status:409}))})}
   if(path==='/api/notes')return Response.json({notes:[],cursor:0,hasMore:false});
   throw Error('Unexpected local test request: '+path);
  };
  page.window.eval(editor);page.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  await waitFor(()=>page.window.easybookRich&&page.window.document.querySelector('.note[data-id]'),'Web editor boots');
  page.window.document.querySelector('.note[data-id]').click();online=true;get('syncNow').click();
  await waitFor(()=>release,'note upload is in flight');assert.equal(sent.title,local.title);
  get('title').value='请求期间继续修改的标题';get('title').dispatchEvent(new page.window.Event('input',{bubbles:true}));
  release();await waitFor(()=>page.window.easybookActivity.lastSuccess>0,'conflicting upload finishes');
  let saved=await store.load(key),note=saved.notes.find(note=>note.id===base.id);
  if(purged){
   assert.equal(note.purged,1,'remote permanent deletion remains terminal despite an in-flight edit');
   assert.equal(note.dirty,false);assert.equal(note.title,'');assert.equal(saved.notes.length,1,'terminal deletion does not recreate an edited conflict copy');
   assert.equal(saved.bases[base.id],undefined);
  }else{
   assert.equal(note.title,'请求期间继续修改的标题','automatic conflict merge preserves edits made after the upload snapshot');
   assert.deepEqual(note.document,remote.document,'automatic conflict merge retains the independent remote edit');
   assert.equal(note.dirty,true);assert.equal(note.version,remote.version);
   assert.equal(page.window.easybookRich.plain(),'A\n云端新正文','the open editor refreshes to the merged body');
   get('title').value='合并后继续编辑';get('title').dispatchEvent(new page.window.Event('input',{bubbles:true}));
   await waitFor(async()=>(await store.load(key)).notes[0].title==='合并后继续编辑','later edit is persisted');
   assert.deepEqual((await store.load(key)).notes[0].document,remote.document,'later edits cannot restore the stale pre-merge body');
  }
 }finally{page.window.close();store.db.close()}
}
await scenario();await scenario(true);
console.log('PASS Web in-flight edits: conflict merge preserves the latest local edit and remote body, refreshes the editor, and keeps permanent deletion terminal.');
