// Browser-free fallback for publicly searchable information. The only request
// contains the explicit public query; no Easybook token or private notes.
const decodeXml=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
 .replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos|nbsp);/gi,(match,number,entity)=>{
  if(number){const code=number[0]?.toLowerCase()==='x'?parseInt(number.slice(1),16):Number(number);
   return Number.isInteger(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):''}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()]||match;
 });
const field=(xml,name)=>decodeXml(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i').exec(xml)?.[1]||'')
 .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

export function parsePublicSearchRss(xml,maxResults=12){
 const results=[],seen=new Set();
 for(const match of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const item=match[1],title=field(item,'title').slice(0,300),link=field(item,'link');
  let url;try{url=new URL(link)}catch{continue}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>2000||!title||seen.has(url.href))continue;
  seen.add(url.href);
  results.push({title,url:url.href,description:field(item,'description').slice(0,900),source:'bing-rss'});
  if(results.length>=maxResults)break;
 }
 return results;
}

export async function searchPublicRss(query,maxResults=12,signal,fetcher=fetch){
 const url=new URL('https://www.bing.com/search');
 url.searchParams.set('format','rss');url.searchParams.set('q',query);
 const response=await fetcher(url.href,{method:'GET',redirect:'error',signal,headers:{Accept:'application/rss+xml, application/xml;q=0.9'}});
 if(!response.ok)return {results:[],error:{code:'rss_http_'+response.status}};
 const contentType=response.headers.get('content-type')||'';
 if(!/xml|rss|text\/plain/i.test(contentType))return {results:[],error:{code:'rss_invalid_response'}};
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>600000)return {results:[],error:{code:'rss_too_large'}};
 const xml=(await response.text()).slice(0,600000),results=parsePublicSearchRss(xml,maxResults);
 return {results,source:'bing-rss',diagnostics:{requested:maxResults,returned:results.length,fallback:true},
  ...(!results.length?{error:{code:'rss_no_results'}}:{})};
}
