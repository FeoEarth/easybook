import {withServer} from './ai-external-mcp.mjs';
import {WEB_SEARCH_DEFAULT_RESULTS,WEB_SEARCH_MAX_RESULTS} from './ai-web-search.mjs';

// This is Parallel's anonymous Streamable HTTP endpoint, not the OAuth/login
// endpoint. Do not send Easybook session tokens or users' BYOK credentials.
export const PARALLEL_MCP_URL='https://mcp.parallel.ai/mcp';

const safeUrl=value=>{
 try{
  const url=new URL(value);
  return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&url.href.length<=2000?url.href:'';
 }catch{return ''}
};

export function parallelSearchResults(payload,maxResults=WEB_SEARCH_DEFAULT_RESULTS){
 const data=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{};
 const rows=Array.isArray(data.results)?data.results:Array.isArray(data.data?.results)?data.data.results:[];
 const seen=new Set(),results=[];
 for(const item of rows){
  const url=safeUrl(item?.url),title=typeof item?.title==='string'?item.title.trim().slice(0,300):'';
  if(!url||!title||seen.has(url))continue;
  seen.add(url);
  const excerpts=Array.isArray(item.excerpts)?item.excerpts.filter(v=>typeof v==='string'):[];
  const description=(excerpts.join(' ')||String(item.description||'')).slice(0,1000);
  const publishedAt=typeof item.publish_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(item.publish_date)?item.publish_date:undefined;
  results.push({url,title,description,source:'parallel',...(publishedAt?{publishedAt}:{})});
  if(results.length>=Math.max(3,Math.min(WEB_SEARCH_MAX_RESULTS,maxResults)))break;
 }
 return results;
}

export async function runParallelMcpSearch(query,signal,fetcher=fetch,maxResults=WEB_SEARCH_DEFAULT_RESULTS,{token='',mode='anonymous'}={}){
 const authenticated=mode==='account'&&!!token;
 // Parallel only honors max_results overrides with OAuth or an API key.
 // Anonymous calls stay header-free and keep Parallel's own default result count.
 const output=await withServer(PARALLEL_MCP_URL,authenticated?token:'',fetcher,signal,send=>send('tools/call',{
  name:'web_search',arguments:{objective:query,search_queries:[query]}
 }),authenticated?maxResults:undefined);
 if(output?.isError)return {results:[],error:{code:'parallel_search_failed',message:'Parallel MCP 返回搜索错误或匿名限流。'}};
 let parsed=output?.structuredContent;
 if(!parsed||!Array.isArray(parsed.results)){
  const text=Array.isArray(output?.content)?output.content.filter(v=>v?.type==='text'&&typeof v.text==='string').map(v=>v.text).join('\n'):'';
  try{parsed=JSON.parse(text)}catch{parsed=null}
 }
 const raw=Array.isArray(parsed?.results)?parsed.results:Array.isArray(parsed?.data?.results)?parsed.data.results:[];
 const results=parallelSearchResults(parsed,maxResults);
 const diagnostics={requested:maxResults,received:raw.length,returned:results.length,mode:authenticated?'account':'anonymous'};
 return results.length?{source:'parallel',results,diagnostics}:{results:[],diagnostics,error:{code:'parallel_no_results',message:'Parallel MCP 暂未返回可用搜索结果。'}};
}
