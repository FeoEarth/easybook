import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('app/src/main/res/raw/predictive_back.js','utf8');
function setup(){
 const messages=[],listeners={},nodes={findbar:{hidden:true},search:{value:''}};
 let observe;
 const c=vm.createContext({console,JSON,queueMicrotask,clearTimeout,MutationObserver:class{constructor(fn){observe=fn}observe(){}},
  window:{NativeStore:{call:async(method,args)=>{messages.push({method,args});return {}}},addEventListener:(type,fn)=>listeners[type]=fn},
  document:{body:{},querySelectorAll:()=>c.dialogs,querySelector:()=>c.dialogs[0]},$:(id)=>nodes[id],
  dialogs:[],native:{},key:'workspace-a',current:null,tab:'folders',listTab:'all',listMenuOpen:false,selecting:false,
  workspacePending:false,moveBusy:false,securityBusy:false,saveTimer:0,flushes:0,saves:0,backs:0,toasts:0,
  rich:{flushInput(){c.flushes++}},flushLocal:async()=>{c.saves++},toast:()=>c.toasts++,
  handleBack(){c.backs++;c.current=null;c.tab='folders'},folderParent:()=> 'parent',activeFolders:()=>[{id:'parent'}],switchTab:tab=>c.tab=tab});
 vm.runInContext(source,c);
 const state=()=>messages.filter(m=>m.method==='navigation.state').at(-1).args;
 return {c,messages,nodes,state,changed:()=>observe(),listeners};
}
{
 const {c,state,changed,messages}=setup();assert.equal(state().canGoBack,false);
 c.current='note';changed();const revision=state().revision;
 // Publishing/start/cancellation is read-only: no save or navigation.
 c.window.easybookPublishBackState();assert.equal(c.saves,0);assert.equal(c.backs,0);
 await c.window.easybookCommitBack(revision,1);assert.equal(c.backs,1);assert.equal(c.saves,1);assert.equal(c.flushes,1);
 assert(messages.some(m=>m.method==='navigation.finish'&&m.args.token===1));
}
{
 const {c,state,changed}=setup();c.current='rich-note';changed();c.flushLocal=async()=>{throw Error('disk full')};
 await c.window.easybookCommitBack(state().revision,2);assert.equal(c.backs,0);assert.equal(c.current,'rich-note');assert.equal(c.toasts,1);
}
{
 const {c,state,changed}=setup();c.current='old';changed();let resolve;c.flushLocal=()=>new Promise(r=>resolve=r);
 const pending=c.window.easybookCommitBack(state().revision,3);await c.window.easybookCommitBack(state().revision,4);assert.equal(c.backs,0);
 c.key='workspace-b';c.current='new';resolve();await pending;assert.equal(c.backs,0);assert.equal(c.current,'new');
}
{
 const {c,state,changed}=setup();c.tab='folder:child';changed();await c.window.easybookCommitBack(state().revision,5);assert.equal(c.tab,'folder:parent');
 c.workspacePending=true;changed();await c.window.easybookCommitBack(state().revision,6);assert.equal(c.backs,0);
 c.workspacePending=false;c.securityBusy=true;changed();await c.window.easybookCommitBack(state().revision,7);assert.equal(c.backs,0);
}
{
 const {c,state,changed,nodes}=setup();nodes.search.value='query';changed();assert(state().canGoBack);
 const stale=state().revision;c.dialogs=[{id:'approval'}];changed();await c.window.easybookCommitBack(stale,8);assert.equal(c.backs,0);
 await c.window.easybookCommitBack(state().revision,9);assert.equal(c.backs,1);
 assert(!JSON.stringify(state()).includes('workspace'));
}
const html=readFileSync('app/src/main/assets/index.html','utf8'),marker="if(native){$('pairKey').remove();";
assert.equal(html.split(marker).length,2,'Android injection anchor unique');
const injected=html.replace(marker,source+'\n'+marker);
for(const m of injected.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi))if(!/\bsrc\s*=/.test(m[1]))new vm.Script(m[2]);
const activity=readFileSync('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8');
assert(!activity.includes('evaluateJavascript("window.handleBack()"'));
assert(!activity.includes('addJavascriptInterface'));
assert(readFileSync('app/src/main/AndroidManifest.xml','utf8').includes('enableOnBackInvokedCallback="true"'));
console.log('PASS predictive back: root, cancellation side effects, rich save failure, rapid back, stale revision, workspace isolation, folder parent, pending approval, search, bridge and injected syntax');
