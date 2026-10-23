import contract from './document-contract.json' with {type:'json'};
export {contract};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=()=>{throw new Error('Invalid document schema v1')};
function keys(o,allowed){if(!object(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail()}
function attrs(value,rules,required=[]){if(value===undefined){if(required.length)fail();return}keys(value,Object.keys(rules));for(const k of required)if(!(k in value))fail();for(const [k,v]of Object.entries(value)){const [t,a,b]=rules[k];if(v===null&&!required.includes(k))continue;
 if(t==='string'&&(typeof v!=='string'||v.length>a)||t==='integer'&&(!Number.isSafeInteger(v)||v<a||v>b)||t==='boolean'&&typeof v!=='boolean'||t==='asset'&&(typeof v!=='string'||!/^sha256:[a-f0-9]{64}$/.test(v))||t==='color'&&(typeof v!=='string'||!/^#[a-fA-F0-9]{6}$/.test(v))||t==='url'&&(typeof v!=='string'||v.length>2048||! /^(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)$/i.test(v))||t==='target'&&v!=='_blank'&&v!==null||t==='rel'&&v!==null&&v!=='noopener noreferrer nofollow'||t==='null'&&v!==null)fail();}}
export function validateDocument(value){keys(value,['schemaVersion','doc']);if(value.schemaVersion!==1)fail();let count=0;
 function visit(n,depth,parent){keys(n,['type','attrs','content','text','marks']);if(++count>contract.maxNodes||depth>contract.maxDepth)fail();const rule=Object.hasOwn(contract.nodes,n.type)?contract.nodes[n.type]:null;if(!rule||parent&&!contract.nodes[parent].children.includes(n.type))fail();if(!parent&&n.type!=='doc')fail();
 const required={heading:['level'],taskItem:['checked'],image:['assetId'],attachment:['assetId','name','mime','size']}[n.type]||[];attrs(n.attrs,rule.attrs,required);
 if(n.type==='text'){if(typeof n.text!=='string'||!n.text.length||n.content!==undefined)fail()}else if(n.text!==undefined)fail();
 if(n.marks!==undefined){if(n.type!=='text'||parent==='codeBlock'||!Array.isArray(n.marks))fail();const seen=new Set();for(const m of n.marks){keys(m,['type','attrs']);if(!Object.hasOwn(contract.marks,m.type)||seen.has(m.type))fail();seen.add(m.type);attrs(m.attrs,contract.marks[m.type],['link','highlight','textColor'].includes(m.type)?[m.type==='link'?'href':'color']:[]);}}
 if(n.content!==undefined&&!Array.isArray(n.content))fail();const children=n.content||[];if(children.length<rule.min||!rule.children.length&&n.content!==undefined)fail();if(['listItem','taskItem'].includes(n.type)&&children[0]?.type!=='paragraph')fail();for(const c of children)visit(c,depth+1,n.type);
 }visit(value.doc,0);if(new TextEncoder().encode(JSON.stringify(value)).length>contract.maxBytes)fail();return value;}
export const emptyDocument=()=>({schemaVersion:1,doc:{type:'doc',content:[{type:'paragraph'}]}});
export function serializeDocument(value){return JSON.stringify(validateDocument(value))}
export function deserializeDocument(value){if(typeof value!=='string')fail();return validateDocument(JSON.parse(value))}
export function plainText(value){validateDocument(value);function text(n){if(n.type==='text')return n.text;if(n.type==='hardBreak')return '\n';if(n.type==='attachment')return n.attrs.name;return (n.content||[]).map(text).join(['doc','blockquote','bulletList','orderedList','taskList','listItem','taskItem'].includes(n.type)?'\n':'')}return text(value.doc)}
export function assetRefs(value){validateDocument(value);const refs=new Map();function visit(n){if(['image','attachment'].includes(n.type))refs.set(n.attrs.assetId.slice(7),n.attrs.name||n.attrs.alt||'图片');for(const c of n.content||[])visit(c)}visit(value.doc);return refs}
