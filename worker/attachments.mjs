import {Buffer} from 'node:buffer';
const MAX=5*1024*1024,WIRE=7*1024*1024;
export async function attachments(request,env,workspace,id,headers){
 if(!env.ATTACHMENTS)return Response.json({error:'Attachment storage unavailable'},{status:503,headers});
 const objectKey=workspace+'/'+id;
 if(request.method==='GET'){
  const object=await env.ATTACHMENTS.get(objectKey);if(!object)return Response.json({error:'Attachment not found'},{status:404,headers});
  if(object.size>MAX)return Response.json({error:'Attachment too large'},{status:413,headers});
  return Response.json({id,name:decodeURIComponent(object.customMetadata?.name||'%E9%99%84%E4%BB%B6'),mime:object.customMetadata?.mime||'application/octet-stream',size:object.size,data:Buffer.from(await object.arrayBuffer()).toString('base64')},{headers});
 }
 if(request.method!=='PUT')return Response.json({error:'Method not allowed'},{status:405,headers});
 const reader=request.body?.getReader();if(!reader)return Response.json({error:'Missing body'},{status:400,headers});let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>WIRE){await reader.cancel();return Response.json({error:'Attachment exceeds 5 MB'},{status:413,headers});}chunks.push(value);}
 let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'Invalid JSON'},{status:400,headers});}
 if(!value||typeof value.name!=='string'||value.name.length>180||typeof value.mime!=='string'||!value.mime.match(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/)||typeof value.data!=='string'||!Number.isInteger(value.size)||value.size<0||value.size>MAX||value.data.length>Math.ceil(MAX/3)*4||!value.data.match(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))return Response.json({error:'Invalid attachment'},{status:400,headers});
 const bytes=Buffer.from(value.data,'base64');if(bytes.length!==value.size)return Response.json({error:'Invalid attachment size'},{status:400,headers});
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');if(digest!==id)return Response.json({error:'Attachment hash mismatch'},{status:400,headers});
 await env.ATTACHMENTS.put(objectKey,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{name:encodeURIComponent(value.name),mime:value.mime},httpMetadata:{contentType:'application/octet-stream'}});
 return Response.json({id,size:bytes.length},{headers});
}
