import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mcp} from '../worker/mcp.mjs';
import {registry} from '../worker/mcp-registry.mjs';
import {promptDefinitions} from '../worker/mcp-prompts.mjs';
import {READ,WRITE} from '../worker/mcp-common.mjs';
import {approvalAPI,permissions} from '../worker/mcp-access.mjs';
import {get} from '../worker/mcp-notes.mjs';
import {download} from '../worker/mcp-attachments.mjs';
import {validateDocument} from '../shared/document.mjs';
const sqlite=new DatabaseSync(':memory:');
for(const p of ['worker/schema.sql','mcp-oauth/migrations/0001_workspace_grants.sql','worker/migrations/0008-mcp-capabilities.sql'])sqlite.exec(readFileSync(p,'utf8'));
const DB={prepare(sql){const statement=sqlite.prepare(sql);let params=[];return {bind(...p){params=p;return this},async first(){return statement.get(...params)||null},async all(){return {results:statement.all(...params)}},async run(){const r=statement.run(...params);return {meta:{changes:Number(r.changes)}}}}},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements){const results=await s.all();out.push({...results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}})}sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const storage=new Map(),bucket={async get(key){const x=storage.get(key);return x?{size:Buffer.byteLength(x),json:async()=>JSON.parse(x),body:new Blob([x]).stream()}:null},async head(key){const x=storage.get(key);return x?{size:Buffer.byteLength(x),customMetadata:{name:'a.txt',mime:'text/plain'}}:null},async list({prefix,cursor,limit}){const all=[...new Set([...storage.keys()].filter(k=>k.startsWith(prefix)).map(k=>k.slice(0,prefix.length+64)+'/'))].sort();const start=Number(cursor||0),page=all.slice(start,start+limit);return {delimitedPrefixes:page,objects:[],truncated:start+limit<all.length,cursor:String(start+limit)}}};
const workspace='a'.repeat(64),client='synthetic-client',token='synthetic-only';
const env={DB,ATTACHMENTS:bucket,MCP_ACCESS_TOKEN:token};
const ctx={env,workspace,client,scopes:[...READ,...WRITE]};
sqlite.prepare("INSERT INTO mcp_workspace_grants(id,github_user_id,oauth_client_id,workspace_id,created_at) VALUES('g','236202359',?,?,0)").run(client,workspace);
const exercised=new Set();
async function protocol(method,params={},access=ctx){const r=await mcp(new Request('https://test/mcp',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env,access.workspace,{client:access.client,scopes:access.scopes});return r.json()}
async function call(name,a={},access=ctx){const r=await protocol('tools/call',{name,arguments:a},access);assert.ok(r.result,JSON.stringify(r));const data=JSON.parse(r.result.content[0].text);if(r.result.isError)throw Object.assign(Error(data.error.message),data.error);exercised.add(name);return data}
async function rejects(name,args,code,access=ctx){await assert.rejects(()=>call(name,args,access),e=>e.code===code)}
assert.equal((await protocol('initialize')).result.capabilities.resources.subscribe,false);
assert.equal((await protocol('tools/list')).result.tools.length,registry.length+3);
assert.equal((await protocol('resources/list')).result.resources.length,7);
assert.equal((await protocol('resources/templates/list')).result.resourceTemplates.length,7);
assert.equal((await protocol('prompts/list')).result.prompts.length,26);
const n0=await call('notes_create',{title:'Synthetic MCP only',text:'Alpha'});const id=n0.id;
await rejects('notes_update',{id,version:1,title:'Forbidden'},'PERMISSION_DENIED',{...ctx,scopes:READ});
await rejects('notes_get',{id},'NOT_FOUND',{...ctx,workspace:'b'.repeat(64)});
await rejects('notes_get',{id,confirmed:true},'INVALID_ARGUMENT');
await call('notes_get',{id});await call('notes_list');await call('notes_search',{query:'Alpha'});await call('notes_batch_get',{ids:[id]});
let n=await call('notes_update',{id,version:1,title:'Updated'});await rejects('notes_update',{id,version:1,title:'Stale'},'CONFLICT');
n=await call('notes_append',{id,version:n.version,text:'Beta'});
n=await call('notes_insert_section',{id,version:n.version,index:1,level:2,title:'Section',text:'Body'});
await call('notes_get_outline',{id});const found=await call('notes_find_in_note',{id,query:'Alpha'});
n=await call('notes_replace_text',{id,version:n.version,path:found.matches[0].path,find:'Alpha',replace:'Replaced'});
let duplicate=await call('notes_duplicate',{id,version:n.version,title:'Copy'});
let state=(await call('folders_list')).management_version;
const f=await call('folders_create',{name:'Folder',management_version:state});state=f.management_version;
const f2=await call('folders_create',{name:'Child',parent_id:f.id,management_version:state});state=f2.management_version;
await rejects('folders_move',{id:f.id,parent_id:f2.id,management_version:state},'CONFLICT');
let moved=await call('folders_move',{id:f2.id,parent_id:'',management_version:state});state=moved.management_version;
const renamed=await call('folders_rename',{id:f.id,name:'Renamed',updated:f.updated});
await call('folders_get',{id:f.id});await call('folders_get_contents',{id:f.id});
n=await call('notes_move',{id,version:n.version,folder_id:f.id});n=await call('notes_pin',{id,version:n.version,pinned:true});
n=await call('tasks_create',{id,version:n.version,text:'Task'});
let ts=await call('tasks_list',{note_id:id});let p=ts.tasks[0].path;
await call('tasks_get',{id,version:n.version,path:p});n=await call('tasks_update',{id,version:n.version,path:p,text:'Revised task'});
n=await call('tasks_complete',{id,version:n.version,path:p});n=await call('tasks_reopen',{id,version:n.version,path:p});
n=await call('tasks_batch_complete',{id,version:n.version,tasks:[{path:p}]});
await rejects('tasks_complete',{id,version:n.version-1,path:p},'CONFLICT');
n=await call('tasks_delete',{id,version:n.version,path:p});
for(const name of ['workspace_get_info','workspace_get_summary','workspace_get_recent_activity','workspace_get_capabilities','workspace_get_sync_status'])await call(name);
await call('workspace_search_all',{query:'Updated'});
const grant=await call('access_request_permissions',{scopes:['notes.write']});
assert.deepEqual(await permissions(env,workspace,client),READ);
await approvalAPI(new Request('https://test',{method:'POST',body:JSON.stringify({id:grant.approval_id,approve:true})}),env,workspace);
assert.ok((await permissions(env,workspace,client)).includes('notes.write'));
async function approve(tool,args){const r=await call('operations_request_confirmation',{tool,arguments:args});assert.equal((await approvalAPI(new Request('https://test',{method:'POST',body:JSON.stringify({id:r.approval_id,approve:true})}),env,workspace)).status,200);return {...args,confirmation_id:r.approval_id}}
await rejects('notes_batch_delete',{items:[{id:duplicate.id,version:duplicate.version}],confirmation_id:crypto.randomUUID()},'CONFIRMATION_REQUIRED');
let batch=await call('notes_batch_move',await approve('notes_batch_move',{items:[{id:duplicate.id,version:duplicate.version}],folder_id:f2.id}));assert.equal(batch.results[0].ok,true);duplicate=batch.results[0].note;
batch=await call('notes_batch_update',await approve('notes_batch_update',{items:[{id:duplicate.id,version:duplicate.version}],metadata:{favorite:true}}));duplicate=batch.results[0].note;
const confirm=await approve('notes_batch_delete',{items:[{id:duplicate.id,version:duplicate.version}]});batch=await call('notes_batch_delete',confirm);assert.equal(batch.results[0].ok,true);await rejects('notes_batch_delete',confirm,'CONFIRMATION_REQUIRED');duplicate=batch.results[0].note;
duplicate=await call('notes_restore',{id:duplicate.id,version:duplicate.version});duplicate=await call('notes_delete',{id:duplicate.id,version:duplicate.version});
// Media nodes and table survive unrelated local edits.
const media='c'.repeat(64),base=workspace+'/'+media;
storage.set(base+'/manifest-v2',JSON.stringify({id:media,v:2,name:'Synthetic.txt',mime:'text/plain',size:3,wireId:media,encoding:'identity',parts:[{hash:media,size:3}],localOnly:false}));storage.set(base+'/'+media+'/0','abc');
await call('attachments_list');await call('attachments_search',{query:'Synthetic',mime:'text/'});await call('attachments_get_metadata',{attachment_id:media});
await rejects('attachments_get_metadata',{attachment_id:media},'NOT_FOUND',{...ctx,workspace:'b'.repeat(64)});
const url=await call('attachments_get_download_url',{attachment_id:media});assert.equal(await (await download(new Request(url.url),env)).text(),'abc');
n=await call('attachments_attach_to_note',{id,version:n.version,attachment_id:media});
await rejects('attachments_delete',await approve('attachments_delete',{attachment_id:media}),'ATTACHMENT_IN_USE');
const stored=await get(ctx,id);const ap=stored.document.doc.content.findIndex(n=>n.type==='attachment');
n=await call('attachments_detach_from_note',{id,version:n.version,path:[ap],attachment_id:media});
assert.equal((await call('attachments_delete',await approve('attachments_delete',{attachment_id:media}))).bytes_preserved,true);assert.ok(storage.has(base+'/'+media+'/0'));
// Delete empty folder only. Never cascade to notes or children.
const empty=await call('folders_create',{name:'Empty',management_version:state});state=empty.management_version;
await call('folders_delete',await approve('folders_delete',{id:empty.id,updated:empty.updated,management_version:state}));state++;
await rejects('folders_delete',await approve('folders_delete',{id:f.id,updated:renamed.updated,management_version:state}),'CONFLICT');
for(const resource of ['workspace/info','workspace/summary','workspace/capabilities','folders','notes/recent','tasks/open','tasks/completed','notes/'+id,'notes/'+id+'/text','notes/'+id+'/document','notes/'+id+'/outline','folders/'+f.id,'folders/'+f.id+'/notes','attachments/'+media+'/metadata']){const r=await protocol('resources/read',{uri:'easybook://'+resource});assert.ok(r.result,JSON.stringify(r));if(r.result.contents[0].mimeType==='application/json')JSON.parse(r.result.contents[0].text)}
assert.equal((await protocol('resources/read',{uri:'easybook://notes/'+id},{...ctx,workspace:'b'.repeat(64)})).error.code,-32002);
for(const p of promptDefinitions){const args=Object.fromEntries(p.arguments.filter(x=>x.required).map(x=>[x.name,x.name==='note_id'||x.name==='folder_id'?id:x.name==='note_ids'?id:'测试']));const r=await protocol('prompts/get',{name:p.name,arguments:args});assert.ok(r.result?.messages?.length,p.name)}
// Exact confirmation parameters and client identity cannot be substituted.
const exact=await approve('notes_batch_move',{items:[{id,version:n.version}],folder_id:''});
await rejects('notes_batch_move',{...exact,folder_id:f2.id},'CONFIRMATION_REQUIRED');
await rejects('notes_batch_move',exact,'CONFIRMATION_REQUIRED',{...ctx,client:'other-client'});
// Invalid rich text causes no changes. Nested task paths preserve nesting and unrelated media/table nodes.
const rich={schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Keep bold',marks:[{type:'bold'}]}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'Cell'}]}]}]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Parent'}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:false},content:[{type:'paragraph',content:[{type:'text',text:'Child'}]}]}]}]}]}]}};
let rn=await call('notes_create',{title:'Rich fixture',document:rich});
const oldVersion=rn.version;
await rejects('notes_update',{id:rn.id,version:rn.version,document:{schemaVersion:1,doc:{type:'doc',content:[{type:'unknown'}]}}},'INVALID_DOCUMENT');
assert.equal((await get(ctx,rn.id)).version,oldVersion);
rn=await call('tasks_complete',{id:rn.id,version:rn.version,path:[2,0,1,0]});
const afterRich=await get(ctx,rn.id);assert.deepEqual(afterRich.document.doc.content[1],rich.doc.content[1]);assert.deepEqual(afterRich.document.doc.content[0],rich.doc.content[0]);assert.equal(afterRich.document.doc.content[2].content[0].attrs.checked,false);assert.equal(afterRich.document.doc.content[2].content[0].content[1].content[0].attrs.checked,true);
const largeDoc={schemaVersion:1,doc:{type:'doc',content:Array.from({length:90},(_,i)=>({type:'paragraph',content:[{type:'text',text:'段落'+i+' '+('x'.repeat(1000))}]}))}};
const large=await call('notes_create',{title:'Large fixture',document:largeDoc});
const segment=await call('notes_get',{id:large.id});assert.ok(segment.next_offset>0);const segment2=await call('notes_get',{id:large.id,offset:segment.next_offset});assert.notDeepEqual(segment.document,segment2.document);
const bodyPage=await call('notes_list',{limit:1,format:'text'});assert.equal(typeof bodyPage.notes[0].text,'string');
const activity=await call('workspace_get_recent_activity',{limit:2});assert.ok(activity.changes[0].cursor>activity.changes[1].cursor);
const firstPage=await call('notes_list',{limit:1});assert.ok(firstPage.next_cursor);const nextPage=await call('notes_list',{limit:1,cursor:firstPage.next_cursor});assert.notEqual(firstPage.notes[0].id,nextPage.notes[0].id);
const badResource=await protocol('resources/read',{uri:'easybook://notes/'+id+'?offset=-1'});assert.ok(badResource.error);

const before=sqlite.prepare('SELECT COUNT(*) n FROM note_changes').get().n;await protocol('prompts/get',{name:'organize_workspace',arguments:{}});assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM note_changes').get().n,before);
await call('list_folders');await call('search_notes',{query:'Updated'});await call('get_note',{id});
// Signed ticket stops working as soon as paired grant is revoked.
sqlite.prepare('UPDATE mcp_workspace_grants SET revoked_at=1').run();assert.equal((await download(new Request(url.url),env)).status,403);
for(const row of sqlite.prepare('SELECT document FROM notes_json').all())validateDocument(JSON.parse(row.document));
assert.ok(sqlite.prepare('SELECT COUNT(*) n FROM note_changes').get().n>20);
const missing=registry.map(t=>t.name).filter(n=>!exercised.has(n));assert.deepEqual(missing,[],'Every registered tool must have a successful invocation');
console.log(`PASS ${registry.length} tools + 3 aliases, 14 resources, 26 prompts; real SQLite CAS/feed, permissions, confirmations/replay, isolation, revocable download, JSON contract`);
