import {fail,validate,schema,int,str,UUID,ASSET} from './mcp-common.mjs';
export const staticResources=[
 ['workspace/info','工作区信息','workspace_get_info'],['workspace/summary','工作区摘要','workspace_get_summary'],['workspace/capabilities','工作区权限和能力','workspace_get_capabilities'],['folders','文件夹目录','folders_list'],['notes/recent','最近更新笔记','notes_list'],['tasks/open','未完成待办','tasks_list'],['tasks/completed','已完成待办','tasks_list']
].map(([route,name,tool])=>({uri:'easybook://'+route,name,mimeType:'application/json',tool}));
export const resourceTemplates=[['notes/{note_id}','笔记','application/json'],['notes/{note_id}/text','笔记纯文本','text/plain'],['notes/{note_id}/document','笔记文档 JSON 分段','application/json'],['notes/{note_id}/outline','笔记大纲','application/json'],['folders/{folder_id}','文件夹详情','application/json'],['folders/{folder_id}/notes','文件夹笔记','application/json'],['attachments/{attachment_id}/metadata','附件元数据','application/json']].map(([route,name,mimeType])=>({uriTemplate:'easybook://'+route,name,mimeType}));
export const listResources=()=>staticResources.map(({tool,...r})=>r);
export async function readResource(ctx,uri,call){
 if(typeof uri!=='string'||uri.length>4096)fail('INVALID_ARGUMENT','Invalid resource URI');let u;try{u=new URL(uri)}catch{fail('INVALID_ARGUMENT','Invalid resource URI')}
 if(u.protocol!=='easybook:'||u.username||u.password||u.port||u.hash)fail('INVALID_ARGUMENT','Invalid resource URI');
 const route=u.hostname+u.pathname;const params={};for(const [key,value]of u.searchParams){if(Object.hasOwn(params,key))fail('INVALID_ARGUMENT','Duplicate resource parameter');params[key]=['offset','length','limit'].includes(key)?Number(value):value}
 validate(schema({offset:int(200000),length:int(40000,1),limit:int(30,1),cursor:str(2048)}),params);
 let data,mimeType='application/json';const s=staticResources.find(r=>r.uri==='easybook://'+route);
 if(s){let a={};if(['notes_list','folders_list','tasks_list','workspace_get_summary'].includes(s.tool))a={limit:params.limit,cursor:params.cursor};a=Object.fromEntries(Object.entries(a).filter(([,v])=>v!==undefined));if(route.startsWith('tasks/'))a.completed=route.endsWith('completed');data=await call(ctx,s.tool,a);}
 else {
  const parts=route.split('/'),id=parts[1];
  if(parts[0]==='notes'&&new RegExp(UUID).test(id||'')&&parts.length<=3){const tail=parts[2];if(!tail||tail==='document'||tail==='text'){data=await call(ctx,'notes_get',{id,...(tail==='text'?{format:'text'}:{}),...(params.offset!==undefined?{offset:params.offset}:{}),...(params.length!==undefined?{length:params.length}:{})});if(tail==='text'){mimeType='text/plain';data='笔记 '+id+'，版本 '+data.version+'，offset '+(params.offset||0)+'，next_offset '+data.next_offset+'\n\n'+data.text;}}else if(tail==='outline')data=await call(ctx,'notes_get_outline',{id});else fail('NOT_FOUND','Resource not found');}
  else if(parts[0]==='folders'&&new RegExp(UUID).test(id||'')&&(parts.length===2||parts.length===3&&parts[2]==='notes')){data=await call(ctx,parts.length===2?'folders_get':'folders_get_contents',{id,...(parts.length===3?Object.fromEntries(Object.entries(params).filter(([k])=>['limit','cursor'].includes(k))):{})});}
  else if(parts[0]==='attachments'&&new RegExp(ASSET).test(id||'')&&parts.length===3&&parts[2]==='metadata')data=await call(ctx,'attachments_get_metadata',{attachment_id:id});
  else fail('NOT_FOUND','Resource not found');
 }
 return {contents:[{uri,mimeType,text:mimeType==='text/plain'?data:JSON.stringify(data)}]};
}
