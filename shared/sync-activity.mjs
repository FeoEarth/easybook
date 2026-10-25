import {cleanHistory,terminal} from './sync-policy.mjs';
// Observations of the existing queue, never a second transport or outbox.
const legacyCheck=t=>t.kind==='note'&&t.direction==='down'&&!t.operation&&/^(检查笔记更新|笔记更新|检查远端更新)$/.test(t.name);
const operation=t=>t.operation||(legacyCheck(t)?'check':t.direction==='up'?'upload':'download');
const entity=id=>/^(note|folder):/.test(id)?id.split(':').slice(0,2).join(':'):id;
export class SyncActivity {
 constructor(storage,scope,onChange=()=>{},retention=()=>30){this.retention=retention;this.storage=storage;this.scope=scope;this.onChange=onChange;this.tasks=[];this.lastSuccess=0;this.load()}
 load(){try{const data=JSON.parse(this.storage.getItem('easybook-activity:'+this.scope())||'{}');this.tasks=(data.tasks||[]).filter(t=>t&&typeof t.id==='string').map(t=>({...t,state:t.state==='running'?'waiting':t.state}));this.lastSuccess=data.lastSuccess||0}catch{this.tasks=[];this.lastSuccess=0}this.foldChecks();this.onChange(this)}
 foldChecks(){for(const t of this.tasks)if(legacyCheck(t)){t.operation='check';t.name='检查远端更新';t.legacyUncertain=true}}
 save(){this.foldChecks();this.tasks=cleanHistory(this.tasks,this.retention());try{this.storage.setItem('easybook-activity:'+this.scope(),JSON.stringify({tasks:this.tasks,lastSuccess:this.lastSuccess}))}catch{}this.onChange(this)}
 replaceNative(tasks){const ids=new Set(tasks.map(t=>t.id));this.tasks=[...tasks,...this.tasks.filter(t=>!ids.has(t.id)&&t.direction==='up'&&['queued','waiting'].includes(t.state))];this.save()}
 deleteHistory(ids=[],clear=false){const set=new Set(ids);this.tasks=this.tasks.filter(t=>!terminal(t)||!clear&&!set.has(t.id));this.save()}

 set(id,name,kind,direction,state,extra={}){let task=this.tasks.find(t=>t.id===id);if(!task){task={id,created:Date.now()};this.tasks.push(task)}if(task.state==='failed'&&state!=='failed'){task.previousError=task.error;task.failedAt=task.updated}Object.assign(task,extra,{name:String(name).slice(0,180),kind,direction,state,updated:Date.now()});if(state==='running'){task.error='';delete task.resolvedAt;if(!('loaded'in extra)){delete task.loaded;delete task.total}}this.save();return task}
 progress(id,loaded,total){const t=this.tasks.find(t=>t.id===id);if(!t||t.state!=='running')return;Object.assign(t,{loaded,total,updated:Date.now()});this.save()}
 fail(id,offline=false,error='连接失败，请重试'){const t=this.tasks.find(t=>t.id===id);if(t)this.set(id,t.name,t.kind,t.direction,offline?'waiting':'failed',{error})}
 finish(id,state='done'){const t=this.tasks.find(t=>t.id===id);if(t){this.set(id,t.name,t.kind,t.direction,state,{error:''});if(state==='done'){for(const other of this.tasks)if(other.state==='failed'&&entity(other.id)===entity(id))other.resolvedAt=Date.now();this.save()}}}
 finishCheck(id,downloaded){const t=this.tasks.find(t=>t.id===id);if(!t)return;if(downloaded>0){this.set(id,'下载 '+downloaded+' 篇笔记','note','down','done',{operation:'download',downloadCount:downloaded,error:''})}else{this.set(id,'检查远端更新','note','down','done',{operation:'check',downloadCount:0,error:'',legacyUncertain:false})}}
 pause(){for(const t of this.tasks)if(t.state==='running'||t.state==='queued'){t.state='waiting';t.error='等待网络'}this.save()}
 success(){this.lastSuccess=Date.now();this.save()}
 import(tasks){for(const t of tasks){const old=this.tasks.find(x=>x.id===t.id);if(!old||t.updated>=old.updated){if(old){if(t.updated>old.updated&&['running','failed'].includes(t.state))delete old.resolvedAt;if(old.state==='failed'&&t.state!=='failed'){old.previousError=old.error;old.failedAt=old.updated}Object.assign(old,t)}else this.tasks.push({...t})}}this.save()}
 view(online,busy){const sorted=[...this.tasks].sort((a,b)=>b.updated-a.updated),running=sorted.filter(t=>t.state==='running'),waiting=sorted.filter(t=>['queued','waiting'].includes(t.state)),attention=sorted.filter(t=>t.state==='conflict'||t.state==='failed'&&!t.resolvedAt),recent=sorted.filter(t=>t.state==='done'||t.state==='failed'&&t.resolvedAt);const state=busy||running.length?'running':attention.some(t=>t.state==='conflict')?'conflict':attention.some(t=>t.state==='failed')?'failed':!online?'offline':waiting.length?'waiting':this.lastSuccess?'done':'ready';return {state,groups:[['正在进行',running],['等待同步',waiting],['需要处理',attention],['最近活动',recent]].filter(([,list])=>list.length),failures:attention.filter(t=>t.state==='failed').length}}
 operation(task){return operation(task)}
}
