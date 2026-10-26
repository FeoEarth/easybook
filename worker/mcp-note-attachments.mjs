import {get} from './mcp-notes.mjs';
import {walk,need,fail} from './mcp-common.mjs';
import {manifest} from './mcp-attachments.mjs';
export async function noteAttachments(ctx,a){
 need(ctx,'attachments.read');const n=await get(ctx,a.id),refs=[];walk(n.document.doc,(node,path)=>{if(['image','attachment'].includes(node.type))refs.push({attachment_id:node.attrs.assetId.slice(7),node_type:node.type,path})});
 let start=0;if(a.cursor){let c;try{c=JSON.parse(atob(a.cursor))}catch{fail('INVALID_ARGUMENT','Invalid attachment cursor')}if(c.id!==n.id||c.version!==n.version||!Number.isSafeInteger(c.offset)||c.offset<0)fail('CONFLICT','Note attachments changed; restart listing');start=c.offset;}
 const limit=a.limit||20,out=[];for(const ref of refs.slice(start,start+limit)){try{const m=await manifest(ctx,ref.attachment_id);out.push({...ref,name:m.name,mime:m.mime,size:m.size,...(m.provenance?{provenance:m.provenance}:{})})}catch(e){if(e.code!=='NOT_FOUND')throw e;out.push({...ref,available:false})}}
 return {note_id:n.id,version:n.version,attachments:out,next_cursor:start+limit<refs.length?btoa(JSON.stringify({id:n.id,version:n.version,offset:start+limit})):null};
}
