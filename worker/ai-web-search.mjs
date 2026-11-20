import puppeteer from '@cloudflare/puppeteer';
import {hash,schema,str,validate} from './mcp-common.mjs';

export const WEB_SEARCH='web_search';
const parameters=schema({query:str(400,1)},['query']);
export const webSearchTool={type:'function',function:{
 name:WEB_SEARCH,
 description:'Search publicly available websites for current information. Use only when the user asks to search or needs current public information. Provide a short public query without private notes, attachments, personal data or secrets. Easybook confirms the query with the user before sending it.',
 parameters
}};

export function webSearchQuery(args){
 validate(parameters,args);
 const query=args.query.trim();
 if(!query||/[\u0000-\u001f\u007f]/.test(query))throw Object.assign(Error('请输入简短的公开搜索关键词。'),{code:'invalid_search_query'});
 return query;
}

const searchOrigin='https://duckduckgo.com';
const resultSelector='[data-testid="result"], .result';
const challengeSelector='#anomaly-modal, .anomaly-modal, #challenge-form';
const finishedSelector=resultSelector+', [data-testid="no-results"], .no-results, '+challengeSelector;
function isSearchHost(url){
 return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
  (url.hostname==='duckduckgo.com'||url.hostname.endsWith('.duckduckgo.com'));
}

function resultUrl(href){
 if(!href||href.length>8000)return '';
 try{
  let url=new URL(href,searchOrigin);
  if(isSearchHost(url)){
   if(url.pathname!=='/l/')return '';
   url=new URL(url.searchParams.get('uddg'));
  }
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2000)return '';
  return url.href;
 }catch{return ''}
}

export async function readRenderedSearch(page){
 const entries=await page.evaluate(({selector,challenge})=>{
  if(document.querySelector(challenge))return [];
  const text=(root,selector,limit)=>root.querySelector(selector)?.textContent?.replace(/\s+/g,' ').trim().slice(0,limit)||'';
  return [...document.querySelectorAll(selector)].slice(0,25).flatMap(card=>{
   if(card.matches('.result--ad, [data-testid="ad"]')||card.closest('[data-testid="ad"]'))return [];
   const link=card.querySelector('a[data-testid="result-title-a"], a.result__a');
   return link?[{url:link.getAttribute('href')?.slice(0,8001),
    title:link.textContent.trim().replace(/\s+/g,' ').slice(0,300),
    description:text(card,'[data-result="snippet"], [data-testid="result-snippet"], .result__snippet',700)}]:[];
  });
 },{selector:resultSelector,challenge:challengeSelector});
 const results=[],seen=new Set();
 for(const item of entries){
  const url=resultUrl(item.url);
  if(!url||!item.title||seen.has(url))continue;
  seen.add(url);results.push({...item,url});
  if(results.length===5)break;
 }
 return results;
}

async function crawlSearchPage(binding,query,signal,launchBrowser){
 const browser=await launchBrowser(binding);
 let closing;
 const close=()=>{closing??=browser.close().catch(()=>{})};
 signal?.addEventListener('abort',close,{once:true});
 try{
  signal?.throwIfAborted();
  const page=await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',request=>{
   const allowed=isSearchHost(new URL(request.url()))&&!['image','media','font'].includes(request.resourceType());
   void (allowed?request.continue():request.abort()).catch(()=>{});
  });
  const url=new URL('/',searchOrigin);
  url.searchParams.set('q',query);
  const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:10000});
  if(!response?.ok()||!isSearchHost(new URL(page.url())))return [];
  await page.waitForSelector(finishedSelector,{timeout:6000});
  signal?.throwIfAborted();
  return await readRenderedSearch(page);
 }finally{
  signal?.removeEventListener('abort',close);
  close();await closing;
 }
}

export const webSearchAvailable=env=>!!env.WEB_SEARCH_BROWSER;
export async function runWebSearch(env,account,args,signal,launchBrowser=binding=>puppeteer.launch(binding)){
 const query=webSearchQuery(args);
 signal?.throwIfAborted();
 if(!webSearchAvailable(env))return {results:[],browserSearch:true};
 const now=Date.now(),day=86400000,period=Math.floor(now/day);
 const bucket='ai-web-search:'+await hash(account+':'+period);
 await env.DB.prepare('DELETE FROM account_rate_limits WHERE bucket IN (SELECT bucket FROM account_rate_limits WHERE expires_at<? LIMIT 100)').bind(now).run();
 const credit=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<20 RETURNING count').bind(bucket,(period+1)*day).first();
 if(!credit)return {error:{code:'web_search_limit',message:'今日自动搜索次数已达上限，请在浏览器中继续。'},browserSearch:true};
 try{
  const results=await crawlSearchPage(env.WEB_SEARCH_BROWSER,query,signal,launchBrowser);
  if(results.length)return {results};
 }catch(error){if(signal?.aborted)throw signal.reason||error}
 return {results:[],browserSearch:true};
}
