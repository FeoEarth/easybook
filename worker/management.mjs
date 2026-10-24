const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function applyPlacement(items,op){
 if(!op||!uuid.test(op.id)||!/^([fn]):[a-f0-9-]{36}$/.test(op.key)||!uuid.test(op.key.slice(2))||typeof op.parent!=='string'||op.parent!==''&&!uuid.test(op.parent)||!Number.isFinite(op.rank)||Math.abs(op.rank)>1e12)throw Error('Invalid placement');
 if(op.key.startsWith('n:')&&op.parent!=='')throw Error('Invalid note placement');
 const next={...items,[op.key]:{parent:op.parent,rank:op.rank}};
 for(const key of Object.keys(next).filter(k=>k.startsWith('f:'))){const seen=new Set();let id=key.slice(2);while(id){if(seen.has(id))throw Error('Folder cycle');seen.add(id);id=next['f:'+id]?.parent||'';}}
 if(Object.keys(next).length>10000)throw Error('Too many placements');return next;
}
export async function management(request,env,workspace,json){
 await env.DB.prepare('INSERT OR IGNORE INTO management_state(workspace,version,items) VALUES(?,0,?)').bind(workspace,'{}').run();
 const read=async()=>{const r=await env.DB.prepare('SELECT version,items FROM management_state WHERE workspace=?').bind(workspace).first();return {version:r.version,items:JSON.parse(r.items)}};
 if(request.method==='GET')return json({management:await read()});
 if(request.method!=='PUT')return json({error:'Method not allowed'},405);
 const reader=request.body?.getReader();if(!reader)return json({error:'Missing body'},400);let size=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return json({error:'Too large'},413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}const text=new TextDecoder().decode(bytes);
 let input;try{input=JSON.parse(text);if(!Number.isSafeInteger(input.version)||input.version<0)throw Error();applyPlacement({},input.op)}catch{return json({error:'Invalid placement'},400)}
 const receipt=await env.DB.prepare('SELECT payload FROM management_receipts WHERE workspace=? AND mutation=?').bind(workspace,input.op.id).first();
 const payload=JSON.stringify(input.op);
 if(receipt){if(receipt.payload!==payload)return json({error:'Mutation reused'},400);return json({management:await read(),accepted:true})}
 const state=await read();if(state.version!==input.version)return json({management:state},409);
 let items;try{items=applyPlacement(state.items,input.op)}catch{return json({management:state,rejected:true,error:'Folder cycle or placement limit'},409)}
 const results=await env.DB.batch([
 env.DB.prepare('UPDATE management_state SET items=?,version=version+1 WHERE workspace=? AND version=?').bind(JSON.stringify(items),workspace,input.version),
 env.DB.prepare('INSERT OR IGNORE INTO management_receipts(workspace,mutation,payload) SELECT ?,?,? WHERE changes()=1').bind(workspace,input.op.id,payload)
 ]);
 const accepted=results[0].meta.changes===1;
 return json({management:await read(),accepted},accepted?200:409);
}
