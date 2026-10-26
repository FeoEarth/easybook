export class McpError extends Error { constructor(code,message,data){super(message);this.code=code;this.data=data;} }
export const fail=(code,message,data)=>{throw new McpError(code,message,data)};
export const UUID='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$', ASSET='^[a-f0-9]{64}$';
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const str=(max=200,min=0)=>({type:'string',minLength:min,maxLength:max});
export const int=(max=Number.MAX_SAFE_INTEGER,min=0)=>({type:'integer',minimum:min,maximum:max});
export const uuid={type:'string',pattern:UUID},asset={type:'string',pattern:ASSET},bool={type:'boolean'};
export const arr=(items,max=20,min=1)=>({type:'array',items,minItems:min,maxItems:max});
export const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
export const path=arr(int(9999),32,0);
// Closed JSON Schema subset used by the registry. Documents are separately validated by the shared contract.
export function validate(s,v,p='arguments'){
 if(s.enum&&!s.enum.includes(v))fail('INVALID_ARGUMENT',p+' has invalid value');
 if(s.type==='object'){if(!object(v))fail('INVALID_ARGUMENT',p+' must be an object');for(const k of s.required||[])if(!Object.hasOwn(v,k))fail('INVALID_ARGUMENT',p+'.'+k+' required');for(const k of Object.keys(v)){if(!Object.hasOwn(s.properties,k)){if(s.additionalProperties===false)fail('INVALID_ARGUMENT',p+'.'+k+' unknown');}else validate(s.properties[k],v[k],p+'.'+k);}}
 else if(s.type==='array'){if(!Array.isArray(v)||v.length<(s.minItems??0)||v.length>(s.maxItems??Infinity))fail('INVALID_ARGUMENT',p+' invalid array');v.forEach((x,i)=>validate(s.items,x,p+'.'+i));}
 else if(s.type==='string'){if(typeof v!=='string'||v.length<(s.minLength??0)||v.length>(s.maxLength??Infinity)||s.pattern&&!new RegExp(s.pattern).test(v))fail('INVALID_ARGUMENT',p+' invalid string');}
 else if(s.type==='integer'){if(!Number.isSafeInteger(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity))fail('INVALID_ARGUMENT',p+' invalid integer');}
 else if(s.type==='number'){if(typeof v!=='number'||!Number.isFinite(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity))fail('INVALID_ARGUMENT',p+' invalid number');}
 else if(s.type==='boolean'&&typeof v!=='boolean')fail('INVALID_ARGUMENT',p+' invalid boolean');
}
export async function boundedJSON(request,max=230000){const r=request.body?.getReader();if(!r)fail('INVALID_ARGUMENT','Missing body');let n=0;const chunks=[];for(;;){const {value,done}=await r.read();if(done)break;n+=value.byteLength;if(n>max){await r.cancel();fail('PAYLOAD_TOO_LARGE','Request exceeds limit')}chunks.push(value)}const bytes=new Uint8Array(n);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length}try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail('PARSE_ERROR','Invalid JSON')}}
export const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(object(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x)}
export const READ=['notes.read','folders.read','tasks.read','attachments.read','workspace.read'];
export const WRITE=['notes.write','notes.delete','folders.manage','tasks.manage','attachments.write'];
export const need=(ctx,scope)=>{if(!ctx.scopes.includes(scope))fail('PERMISSION_DENIED','Required scope: '+scope)};
export const nodeText=n=>n.type==='text'?n.text:n.type==='hardBreak'?'\n':(n.content||[]).map(nodeText).join(['doc','taskList','taskItem','bulletList','orderedList','listItem','table','tableRow','blockquote'].includes(n.type)?'\n':'');
export function walk(n,fn,p=[]){fn(n,p);(n.content||[]).forEach((c,i)=>walk(c,fn,[...p,i]));}
export function at(doc,p){let n=doc;for(const i of p){n=n.content?.[i];if(!n)fail('CONFLICT','Node path no longer exists')}return n;}
export function splice(doc,p,nodes){if(!p.length)fail('INVALID_ARGUMENT','Cannot replace document root');const parent=at(doc,p.slice(0,-1));parent.content.splice(p.at(-1),1,...nodes);}
