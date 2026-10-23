// A journal of the existing queue, never a second transport/outbox.
export class SyncActivity {
 constructor(storage,scope,onChange=()=>{}){this.storage=storage;this.scope=scope;this.onChange=onChange;this.tasks=[];this.lastSuccess=0;this.load()}
 load(){try{const data=JSON.parse(this.storage.getItem('easybook-activity:'+this.scope())||'{}');this.tasks=(data.tasks||[]).filter(t=>t&&typeof t.id==='string').map(t=>({...t,state:t.state==='running'?'waiting':t.state}));this.lastSuccess=data.lastSuccess||0}catch{this.tasks=[]}this.onChange(this)}
 save(){const done=this.tasks.filter(t=>['done','conflict'].includes(t.state)).sort((a,b)=>b.updated-a.updated).slice(0,60),pending=this.tasks.filter(t=>!['done','conflict'].includes(t.state));this.tasks=[...pending,...done];try{this.storage.setItem('easybook-activity:'+this.scope(),JSON.stringify({tasks:this.tasks,lastSuccess:this.lastSuccess}))}catch{}this.onChange(this)}
 set(id,name,kind,direction,state,extra={}){let task=this.tasks.find(t=>t.id===id);if(!task){task={id,name:String(name).slice(0,180),kind,direction,created:Date.now()};this.tasks.push(task)}Object.assign(task,extra,{state,updated:Date.now()});if(state==='running'){task.error='';if(!('loaded'in extra)){delete task.loaded;delete task.total}}this.save();return task}
 progress(id,loaded,total){const t=this.tasks.find(t=>t.id===id);if(!t||t.state!=='running')return;Object.assign(t,{loaded,total,updated:Date.now()});this.save()}
 fail(id,offline=false,error='连接失败，请重试'){const t=this.tasks.find(t=>t.id===id);if(t)this.set(id,t.name,t.kind,t.direction,offline?'waiting':'failed',{error})}
 finish(id,state='done'){const t=this.tasks.find(t=>t.id===id);if(t)this.set(id,t.name,t.kind,t.direction,state,{error:''})}
 pause(){for(const t of this.tasks)if(t.state==='running'||t.state==='queued'){t.state='waiting';t.error='等待网络'}this.save()}
 success(){this.lastSuccess=Date.now();this.save()}
 import(tasks){for(const t of tasks){const old=this.tasks.find(x=>x.id===t.id);if(!old||t.updated>=old.updated){if(old)Object.assign(old,t);else this.tasks.push(t)}}this.save()}
}
