import {assertPublicHost,publicHostname} from './public-http.mjs';

const maxPageBytes=768*1024;
const maxExcerpt=2200;

function sourceUrl(value,base){
 const url=new URL(value,base);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!publicHostname(url.hostname)||url.href.length>2000)throw Error('Unsupported source URL');
 url.hash='';
 return url;
}

const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function normalizeText(text){
 return text.replace(/&#(x[\da-f]+|\d+);|&([a-z]+);/gi,(match,number,name)=>{
  if(name)return Object.hasOwn(entities,name)?entities[name]:match;
  const code=number[0].toLowerCase()==='x'?parseInt(number.slice(1),16):Number(number);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):match;
 }).replace(/\s+/g,' ').trim();
}
function pageBlocks(){
 const entries=[];
 let current;
 return {entries,handler:{
  element(element){
   current=null;
   if(entries.length>=180)return;
   const block={text:''};entries.push(block);current=block;
   element.onEndTag(()=>{if(current===block)current=null});
  },
  text(chunk){if(current&&current.text.length<1000)current.text+=chunk.text.slice(0,1000-current.text.length)}
 }};
}
function excerpt(entries,query){
 const blocks=[...new Set(entries.map(block=>normalizeText(block.text)).filter(text=>text.length>=35))];
 const available=blocks.join('\n\n');
 if(available.length<=maxExcerpt||!query)return available.slice(0,maxExcerpt);
 const han=[...query.matchAll(/\p{Script=Han}{2,}/gu)].flatMap(([part])=>{const letters=Array.from(part);return letters.slice(1).map((letter,i)=>letters[i]+letter)});
 const words=[...new Set([...(query.toLowerCase().match(/[a-z\d]{4,}/g)||[]),...han])].slice(0,24);
 const ordered=blocks.map((text,index)=>{
  const normalized=text.toLowerCase();
  return {text,index,score:words.filter(word=>normalized.includes(word)).length};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const chosen=[];
 let remaining=maxExcerpt;
 for(const block of ordered){
  if(remaining<=0)break;
  const text=block.text.slice(0,remaining);
  chosen.push({...block,text});
  remaining-=text.length+2;
 }
 return chosen.sort((a,b)=>a.index-b.index).map(item=>item.text).join('\n\n');
}

export async function readSourcePage(response,query=''){
 const general=pageBlocks(),main=pageBlocks();
 let publishedAt='';
 const html=new HTMLRewriter()
  .on('p, h1, h2, h3',general.handler)
  .on('main p, main h1, main h2, main h3, article p, article h1, article h2, article h3, [role="main"] p',main.handler)
  .on('meta[property="article:published_time"], meta[name="date"], meta[itemprop="datePublished"]',{element(element){
   const value=element.getAttribute('content')?.trim();
   if(!publishedAt&&value&&/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value)&&value.length<=35)publishedAt=value;
  }});
 let bytes=0;
 for await(const chunk of html.transform(response).body){
  bytes+=chunk.byteLength;
  if(bytes>=maxPageBytes)break;
 }
 const primary=excerpt(main.entries,query);
 const pageText=primary.length>=120?primary:excerpt(general.entries,query);
 return pageText.length>=120?{pageText,...(publishedAt?{publishedAt}:{})}:null;
}

async function readSource(result,query,fetcher,signal){
 let url=sourceUrl(result.url);
 for(let hop=0;hop<=2;hop++){
  await assertPublicHost(url,fetcher,signal);
  const response=await fetcher(url,{redirect:'manual',headers:{Accept:'text/html, text/plain;q=0.9'},signal});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('Location');
   void response.body?.cancel().catch(()=>{});
   if(!location||hop===2)return result;
   url=sourceUrl(location,url);
   continue;
  }
  const type=response.headers.get('Content-Type')?.toLowerCase()||'';
  if(!response.ok||!response.body||(!type.includes('text/html')&&!type.includes('text/plain'))){
   void response.body?.cancel().catch(()=>{});
   return result;
  }
  let page;
  if(type.includes('text/html'))page=await readSourcePage(response,query);
  else{
   const decoder=new TextDecoder();let text='';
   for await(const chunk of response.body){
    text+=decoder.decode(chunk.subarray(0,maxExcerpt*4),{stream:true});
    if(text.length>=maxExcerpt)break;
   }
   const pageText=(text+decoder.decode()).trim().slice(0,maxExcerpt);
   if(pageText.length>=120)page={pageText};
  }
  return page?{...result,...page,pageUrl:url.href,retrievedAtUtc:new Date().toISOString()}:result;
 }
 return result;
}

export async function enrichWebSearchResults(results,query,signal,fetcher=fetch){
 const deadline=AbortSignal.timeout(3500);
 const sourceSignal=signal?AbortSignal.any([signal,deadline]):deadline;
 const seen=new Set(),selected=[];
 for(let index=0;index<results.length&&selected.length<3;index++){
  let host;try{host=sourceUrl(results[index].url).hostname}catch{continue}
  if(!seen.has(host)){seen.add(host);selected.push(index)}
 }
 const enriched=results.slice();
 await Promise.all(selected.map(async index=>{
  try{enriched[index]=await readSource(results[index],query,fetcher,sourceSignal)}catch{}
 }));
 signal?.throwIfAborted();
 return enriched;
}
