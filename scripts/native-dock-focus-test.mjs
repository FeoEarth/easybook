import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('app/src/main/assets/native-glass/dock-surface.js','utf8');
const activity=readFileSync('app/src/main/java/com/feoearth/easybook/MainActivity.java','utf8');
const frame=readFileSync('app/src/main/java/com/feoearth/easybook/glass/FormatGlassFrame.java','utf8');
const calls=[],frames=[],listeners={},bodyClasses=new Set();
const classes=()=>{const values=new Set();return {toggle(name,on){if(on)values.add(name);else values.delete(name)},remove:name=>values.delete(name),contains:name=>values.has(name)}};
const control=()=>({hidden:false,disabled:false,classList:classes(),getBoundingClientRect:()=>({left:24,top:500,width:300,height:54})});
const searchbar=control(),folder=control(),compose=control();
const search={value:'',focus(){document.activeElement=this;listeners.focus?.()},blur(){document.activeElement=null;listeners.blur?.()},addEventListener(type,fn){listeners[type]=fn}};
const nav={hidden:false,querySelector:()=>searchbar,cloneNode:()=>({outerHTML:'<div id="navigation"></div>',querySelectorAll:()=>[],querySelector:()=>({dataset:{},setAttribute(){}})})};
const rootStyle=Object.assign([], {getPropertyValue:()=>''});
const document={
 activeElement:null,body:{className:'',dataset:{page:'folders'},classList:{toggle(name,on){if(on)bodyClasses.add(name);else bodyClasses.delete(name)}}},
 documentElement:{dataset:{glass:'normal',theme:'light'}},head:{append(){}},createElement:()=>({textContent:''}),
 getElementById:id=>({navigation:nav,search,createFolder:folder,newTop:compose})[id],
 querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}
};
const getComputedStyle=el=>el===document.documentElement?rootStyle:{display:bodyClasses.has('native-dock-searching')&&(el===folder||el===compose)?'none':'flex',opacity:'1',borderTopLeftRadius:'27px'};
const window={visualViewport:{width:390,offsetLeft:0,offsetTop:0,scale:1,addEventListener(){}},NativeStore:{call(method,args){calls.push({method,args});return Promise.resolve({accepted:true})}},addEventListener(){}};
const matchMedia=()=>({matches:false,addEventListener(){}});
vm.runInNewContext(source,{window,document,getComputedStyle,matchMedia,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},console});
function flush(){for(let i=0;frames.length&&i<20;i++)frames.shift()();assert.equal(frames.length,0,'dock scheduling must settle')}
const updates=()=>calls.filter(c=>c.method==='ui.glass.dock');
const mounted=()=>[searchbar,folder,compose].map(control=>control.classList.contains('native-dock-mounted'));
const ready=(slot,name)=>window['easybook'+name+'SurfaceReady'](updates().findLast(c=>c.args.slot===slot&&c.args.visible).args.revision);
flush();
assert.deepEqual(updates(),[],'no bridge requests while Android bootstrap is pending');
assert.match(activity,/ready=true;\s*if\(nativeGlass!=null\)web\.evaluateJavascript\("window\.EasybookNativeUiReady=true;window\.easybookSyncDockSearchSurface/);
window.EasybookNativeUiReady=true;
window.easybookSyncDockSearchSurface();
flush();assert.deepEqual(updates().filter(c=>c.args.visible).map(c=>c.args.slot),[0,1,2]);
ready(0,'DockSearch');ready(2,'DockCompose');flush();
assert.deepEqual(mounted(),[false,false,false],'the dock keeps CSS while one native projection is pending');
ready(1,'DockFolder');flush();
assert.deepEqual(mounted(),[true,true,true]);
const beforeFocus=updates().length;window.easybookDockSearchFocus();flush();
assert(bodyClasses.has('native-dock-searching'));
assert(!searchbar.classList.contains('native-dock-mounted'));
assert.deepEqual([...new Set(updates().slice(beforeFocus).filter(c=>!c.args.visible).map(c=>c.args.slot))].sort(),[0,1,2]);
const beforeBlur=updates().length;search.blur();flush();
assert(!bodyClasses.has('native-dock-searching'));
assert.deepEqual(updates().slice(beforeBlur).filter(c=>c.args.visible).map(c=>c.args.slot),[0,1,2]);
const oldRevision=updates().findLast(c=>c.args.slot===0&&c.args.visible).args.revision;
const beforeNavigation=updates().length;
nav.hidden=true;
document.body.dataset.page='settings';
window.easybookHideDockSurfaces();
assert.deepEqual(updates().slice(beforeNavigation).map(c=>[c.args.slot,c.args.visible]),[[0,false],[1,false],[2,false]],'all dock surfaces close before the next animation frame');
window.easybookDockSearchSurfaceReady(oldRevision);
assert.equal(window.easybookDockSearchFocus(),false,'late native touch cannot focus a hidden search field');
assert(!searchbar.classList.contains('native-dock-mounted'),'late native ready does not remount the search surface');
nav.hidden=false;
document.body.dataset.page='folders';
window.easybookSyncDockSearchSurface();
flush();
const newRevision=updates().findLast(c=>c.args.slot===0&&c.args.visible).args.revision;
assert.ok(newRevision>oldRevision,'reopened dock uses a new projection revision');
window.easybookDockSearchSurfaceReady(oldRevision);
flush();
assert(!searchbar.classList.contains('native-dock-mounted'));
window.easybookDockSearchSurfaceReady(newRevision);
ready(1,'DockFolder');ready(2,'DockCompose');flush();
assert.deepEqual(mounted(),[true,true,true]);
const beforeFailure=updates().length;
window.easybookDockFolderSurfaceFallback();
assert.deepEqual(mounted(),[false,false,false],'a single failure restores CSS for the whole dock');
assert.deepEqual(updates().slice(beforeFailure).map(c=>[c.args.slot,c.args.visible]),[[0,false],[1,false],[2,false]]);
ready(0,'DockSearch');ready(1,'DockFolder');ready(2,'DockCompose');flush();
assert.deepEqual(mounted(),[false,false,false]);
assert(frame.includes('args.optBoolean("focused")){clear();state=null;return;}'),'native search lens must disappear on focus');
console.log('PASS native dock switches material as a group, keeps search focus in the main WebView, and rejects stale callbacks');
