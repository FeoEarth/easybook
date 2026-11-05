/** Incremental completion reader for OpenAI-compatible and Anthropic SSE. */
export async function readAIProviderStream(response,protocol,onDelta=()=>{}){
 const reader=response.body?.getReader();
 if(!reader)throw Error('AI provider did not return a stream');
 const decoder=new TextDecoder();let pending='',total=0,seen=false,content='';
 const calls=new Map(),blocks=new Map();
 const processEvent=event=>{
  const lines=event.split(/\r?\n/),payload=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!payload||payload==='[DONE]')return;
  let data;try{data=JSON.parse(payload)}catch{throw Error('Invalid AI provider stream event')}
  if(data.type==='error'||data.error)throw Error(data.error?.message||'AI provider stream error');
  seen=true;
  if(protocol==='anthropic'){
   if(data.type==='content_block_start'&&data.content_block?.type==='tool_use')blocks.set(data.index,{id:data.content_block.id,name:data.content_block.name,args:''});
   if(data.type==='content_block_delta'){
    if(data.delta?.type==='text_delta'&&typeof data.delta.text==='string'){content+=data.delta.text;onDelta(data.delta.text)}
    if(data.delta?.type==='input_json_delta'&&blocks.has(data.index))blocks.get(data.index).args+=data.delta.partial_json||'';
   }
  }else{
   const delta=data.choices?.[0]?.delta;
   if(typeof delta?.content==='string'){content+=delta.content;onDelta(delta.content)}
   for(const part of delta?.tool_calls||[]){
    const index=part.index||0,current=calls.get(index)||{id:'',name:'',args:''};
    if(part.id)current.id=part.id;
    if(part.function?.name)current.name+=part.function.name;
    if(part.function?.arguments)current.args+=part.function.arguments;
    calls.set(index,current);
   }
  }
 };
 try{
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   total+=value.byteLength;if(total>2*1024*1024)throw Error('AI provider stream too large');
   pending+=decoder.decode(value,{stream:true});
   let boundary;
   while((boundary=pending.search(/\r?\n\r?\n/))!==-1){
    const event=pending.slice(0,boundary),separator=pending.slice(boundary).match(/^\r?\n\r?\n/)[0];
    pending=pending.slice(boundary+separator.length);processEvent(event);
   }
   if(pending.length>131072)throw Error('AI provider stream event too large');
  }
  pending+=decoder.decode();if(pending.trim())processEvent(pending);
 }finally{reader.releaseLock()}
 if(!seen)throw Error('Empty AI provider stream');
 const toolCalls=(protocol==='anthropic'?[...blocks.values()]:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call)).map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:call.args||'{}'}}));
 return {role:'assistant',content,...(toolCalls.length?{tool_calls:toolCalls}:{})};
}
