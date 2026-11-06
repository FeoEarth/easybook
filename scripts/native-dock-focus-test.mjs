import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('app/src/main/assets/native-glass/dock-surface.js','utf8');
const frame=readFileSync('app/src/main/java/com/feoearth/easybook/glass/FormatGlassFrame.java','utf8');
const calls=[],frames=[],listeners={},bodyClasses=new Set();
const classes=()=>{const values=new Set();return {add:name=>values.add(name),remove:name=>values.delete(name),contains:name=>values.has(name)}};
const control=()=>({hidden:false,disabled:false,classList:classes(),getBoundingClientRect:()=>({left:24,top:500,width:300,height:54}),getClientRects:()=>[{}]});
const searchbar=control(),folder=control(),compose=control();
const search={value:'',focus(){document.activeElement=this;listeners.focus?.()},blur(){document.activeElement=null;listeners.blur?.()},addEventListener(type,fn){listeners[type]=fn}};
const nav={hidden:false,querySelector:()=>searchbar,cloneNode:()=>({outerHTML:'<div id="navigation"></div>',querySelectorAll:()=>[],querySelector:()=>({dataset:{},setAttribute(){}})})};
const rootStyle=Object.assign([], {getPropertyValue:()=>''});
const document={
 activeElement:null,body:{className:'',dataset:{page:'folders'},classList:{toggle(name,on){if(on)bodyClasses.add(name);else bodyClasses.delete(name)}}},
 documentElement:{dataset:{glass:'normal',theme:'light'}},head:{append(){}},createElement:()=>({textContent:''}),
 getElementById:id=>({navigation:nav,search,createFolder:folder,newTop:compose})[id],
 querySelector:()=>null,querySelectorAll:()=>[]
};
const getComputedStyle=el=>el===document.documentElement?rootStyle:{display:bodyClasses.has('native-dock-searching')&&(el===folder||el===compose)?'none':'flex',opacity:'1',borderTopLeftRadius:'27px'};
const window={visualViewport:{width:390,offsetLeft:0,offsetTop:0,scale:1,addEventListener(){}},NativeStore:{call(method,args){calls.push({method,args});return Promise.resolve({accepted:true})}},addEventListener(){}};
const matchMedia=()=>({matches:false,addEventListener(){}});
vm.runInNewContext(source,{window,document,getComputedStyle,matchMedia,requestAnimationFrame:fn=>frames.push(fn),MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},console});
function flush(){for(let i=0;frames.length&&i<20;i++)frames.shift()();assert.equal(frames.length,0,'dock scheduling must settle')}
const updates=()=>calls.filter(c=>c.method==='ui.glass.dock');
flush();assert.deepEqual(updates().filter(c=>c.args.visible).map(c=>c.args.slot),[0,1,2]);
for(const name of ['DockSearch','DockFolder','DockCompose'])window['easybook'+name+'SurfaceReady'](1);
flush();assert(searchbar.classList.contains('native-dock-mounted'));
const beforeFocus=updates().length;window.easybookDockSearchFocus();flush();
assert(bodyClasses.has('native-dock-searching'));
assert(!searchbar.classList.contains('native-dock-mounted'));
assert.deepEqual([...new Set(updates().slice(beforeFocus).filter(c=>!c.args.visible).map(c=>c.args.slot))].sort(),[0,1,2]);
const beforeBlur=updates().length;search.blur();flush();
assert(!bodyClasses.has('native-dock-searching'));
assert.deepEqual(updates().slice(beforeBlur).filter(c=>c.args.visible).map(c=>c.args.slot),[0,1,2]);
assert(frame.includes('args.optBoolean("focused")){clear();state=null;return;}'),'native search lens must disappear on focus');
console.log('PASS native dock focus: search lens and compose controls hide during input, all three recover on blur');
