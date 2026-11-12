import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';

const nativeAPI=readFileSync('app/src/main/assets/native-api.js','utf8');
const reply=(window,id,result)=>window.EasybookNative.onmessage({data:JSON.stringify({id,ok:true,result})});
const copy=value=>JSON.parse(JSON.stringify(value));
async function waitFor(condition,message){const deadline=Date.now()+5000;while(!condition()){assert.ok(Date.now()<deadline,message);await new Promise(resolve=>setTimeout(resolve,10))}}

// Exercise the real bridge while its first request is still awaiting Android.
const rpc=new JSDOM('<!doctype html><body></body>',{url:'https://appassets.androidplatform.net/',runScripts:'outside-only'});
try{
 const {window}=rpc,messages=[];window.EasybookNative={postMessage:raw=>messages.push(JSON.parse(raw))};
 window.eval(nativeAPI);const store=window.NativeStore,handler=window.EasybookNative.onmessage,device=window.EasybookDevice;
 let settlements=0;
 const first=store.call('bootstrap').then(result=>{settlements++;return result});
 window.eval(nativeAPI);
 assert.equal(window.NativeStore,store,'repeated bridge injection preserves pending requests');
 assert.equal(window.EasybookNative.onmessage,handler,'repeated injection preserves the native reply handler');
 assert.equal(window.EasybookDevice,device,'repeated injection preserves device helpers');
 const second=window.NativeStore.call('migration.status');
 assert.notEqual(messages[0].id,messages[1].id,'request serials never reset on repeated injection');
 reply(window,messages[1].id,{state:'ready'});reply(window,messages[0].id,{key:'first-workspace'});
 reply(window,messages[0].id,{key:'duplicate-must-not-win'});
 assert.deepEqual(JSON.parse(JSON.stringify(await first)),{key:'first-workspace'});
 assert.deepEqual(JSON.parse(JSON.stringify(await second)),{state:'ready'});
 assert.equal(settlements,1,'duplicate native replies settle a request only once');
}finally{rpc.window.close()}

// Run MainActivity's actual source statements with Java replacement semantics.
// The small stubs supply Android configuration only; the HTML edits are verbatim.
const activity=readFileSync('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8');
const preparation=activity.split('\n').find(line=>line.includes('String html=readWebAsset("index.html")'))?.trim();
const injection=activity.split('\n').find(line=>line.includes('readAsset("native-api.js")'))?.trim();
assert.ok(preparation&&injection,'MainActivity HTML preparation and native bridge injection are present');
const directory=mkdtempSync(join(tmpdir(),'easybook-native-bootstrap-'));let html;
try{
 const fixture=nativeAPI+'\n// Java replacement must preserve $1 and \\literal.\n';
 writeFileSync(join(directory,'native-api.js'),fixture);
 writeFileSync(join(directory,'NativeHtmlHarness.java'),`import java.nio.file.*;
class NativeHtmlHarness {
 static String input,bridge;
 static final int MODE_PRIVATE=0;
 static class BuildConfig { static final boolean NATIVE_GLASS_PROTOTYPE=true; }
 static class android { static class os { static class Build { static class VERSION { static final int SDK_INT=35; } } } }
 static class Preferences { boolean getBoolean(String name,boolean fallback){return fallback;} }
 static Preferences getPreferences(int mode){return new Preferences();}
 static String readWebAsset(String name){return input;}
 static String readAsset(String name){if(!name.equals("native-api.js"))throw new IllegalArgumentException(name);return bridge;}
 public static void main(String[] args)throws Exception {
  input=Files.readString(Path.of(args[0]));bridge=Files.readString(Path.of(args[1]));boolean legacy=false;
  ${preparation}
  ${injection}
  System.out.print(html);
 }
}`);
 const result=spawnSync('java',[join(directory,'NativeHtmlHarness.java'),resolve('app/src/main/assets/index.html'),join(directory,'native-api.js')],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:15000});
 assert.equal(result.status,0,result.stderr||result.error?.message);html=result.stdout;
 assert.equal(html.split(fixture).length-1,1,'MainActivity injects one intact bridge even when the page contains several inline scripts');
}finally{rmSync(directory,{recursive:true,force:true})}

const app=new JSDOM(html,{url:'https://appassets.androidplatform.net/',runScripts:'outside-only',pretendToBeVisual:true}),window=app.window;
const key='space:'+'a'.repeat(64),workspace={id:'a'.repeat(64),name:'Native workspace',mode:'personal',role:'manager'};
const state={key,notes:[],folders:[],management:{},syncPolicy:{autoChange:false,interval:0}},messages=[],errors=[];let bootstrap;
try{
 window.TextEncoder=TextEncoder;window.scrollTo=window.scrollBy=()=>{};
 Object.defineProperty(window,'crypto',{value:crypto});Object.defineProperty(window.navigator,'onLine',{value:false});
 window.localStorage.setItem('easybook-language','en');
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 window.HTMLDialogElement.prototype.close=function(){if(this.open){this.open=false;queueMicrotask(()=>this.dispatchEvent(new window.Event('close')))}};
 window.Range.prototype.getClientRects=()=>[];window.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0});
 window.addEventListener('error',event=>errors.push(event.message));
 window.EasybookNative={postMessage(raw){
  const message=JSON.parse(raw);messages.push(message);
  if(message.method==='bootstrap'){bootstrap=message;return}
  queueMicrotask(()=>{
   try{
    let result={};const {method,args}=message;
    if(method==='search')result={notes:copy(state.notes)};
    else if(method==='workspace.action')result={current:workspace.id,workspaces:[workspace]};
    else if(method==='account.status')result={signedIn:false};
    else if(method==='sync.activity')result={tasks:[]};
    else if(method==='commit'){
     const saved=[];
     for(const {note}of args.changes.notes){const value=copy(note),index=state.notes.findIndex(item=>item.id===value.id);if(index<0)state.notes.push(value);else state.notes[index]=value;saved.push(value)}
     result={notes:saved,folders:[],mappings:{}};
    }else if(!['migration.cleaned','ui.ready','device.theme','device.haptic'].includes(method))throw Error('Unexpected native request: '+method);
    reply(window,message.id,result);
   }catch(error){errors.push(error.message);window.EasybookNative.onmessage({data:JSON.stringify({id:message.id,ok:false,error:error.message})})}
  });
 }};
 for(const script of window.document.querySelectorAll('script')){
  if(script.src){const path=new URL(script.src).pathname;if(path==='/editor.js')window.eval(readFileSync('app/src/main/assets/editor.js','utf8'));else if(path.startsWith('/native-glass/'))window.eval(readFileSync('app/src/main/assets'+path,'utf8'));}
  else window.eval(script.textContent);
 }
 window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
 assert.ok(bootstrap,'the real app has issued bootstrap through the native bridge');
 assert.ok(window.EasybookI18n,'the later localization script ran before bootstrap returned');
 assert.equal(window.document.getElementById('newTop').onclick,null,'bootstrap gates installation of application handlers');
 // A second injection must also be harmless during real application bootstrap.
 window.eval(nativeAPI);reply(window,bootstrap.id,copy(state));
 await waitFor(()=>messages.some(message=>message.method==='ui.ready'),'native bootstrap reaches ui.ready after the delayed reply');
 const get=id=>window.document.getElementById(id);
 assert.equal(typeof get('newTop').onclick,'function','native bootstrap installs the New Note click handler');
 get('newTop').click();
 assert.equal(window.document.body.classList.contains('editing'),true,'New Note enters the native editor');
 get('title').value='原生点击已恢复';get('title').dispatchEvent(new window.Event('input'));
 window.easybookRich.editor.commands.insertContent('保存');await get('done').onclick();await window.flushNative();
 assert.equal(state.notes.length,1,'New Note is committed through the real bridge');
 assert.equal(state.notes[0].title,'原生点击已恢复');
 assert.equal(window.RichNotes.plain(state.notes[0].document),'保存','localization preserves the saved user text');
 assert.equal(new Set(messages.map(message=>message.id)).size,messages.length,'all real app request IDs remain unique');
 assert.deepEqual(errors,[]);
}finally{window.easybookRich?.editor.destroy();window.close()}
console.log('PASS native bootstrap: actual Java HTML injection, idempotent bridge, continuous request IDs, duplicate replies, delayed bootstrap across i18n, and native New Note/input/save.');
