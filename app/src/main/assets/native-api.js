// Only Android injects this script. The origin-scoped main-frame message listener
// is the sole native entry point. No reflection, URL loading, SQL or fetch proxy.
(()=>{
 const pending=new Map();let serial=0;
 window.NativeStore={call(method,args={}){return new Promise((resolve,reject)=>{const id='rpc-'+(++serial);const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native operation timed out'))},method==='sync'||method.startsWith('attachment.')?1800000:120000);pending.set(id,{resolve,reject,timer});window.EasybookNative.postMessage(JSON.stringify({id,method,args}))})}};
 window.EasybookNative.onmessage=e=>{try{const m=JSON.parse(e.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.ok?p.resolve(m.result):p.reject(Object.assign(Error(m.error),{code:m.code}))}catch{}};
 const send=(name,args)=>window.NativeStore.call('device.'+name,args).catch(()=>{});
 window.EasybookDevice={theme:value=>send('theme',{value}),haptic:()=>send('haptic',{}),copy:value=>send('copy',{value}),share:(title,text)=>send('share',{title,text}),exportNotes:value=>window.EasybookRollbackMode?send('exportLegacy',{value}):send('exportNotes',{}),importNotes:()=>send('importNotes',{})};
})();

