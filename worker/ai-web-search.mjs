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

const duckduckgo={
 id:'duckduckgo',origin:'https://duckduckgo.com',link:'a[data-testid="result-title-a"], a.result__a',
 empty:'[data-testid="no-results"], .no-results, .no-results__message'
};
const wiby={id:'wiby',origin:'https://wiby.me',link:'a.tlink',empty:'.pin'};
const challenge='#anomaly-modal, .anomaly-modal, #challenge-form, iframe[src*="captcha"]';

function isSearchHost(url,site){
 return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
  (url.origin===site.origin||site===duckduckgo&&url.hostname.endsWith('.duckduckgo.com'));
}

function resultUrl(href,site){
 if(!href||href.length>8000)return '';
 try{
  let url=new URL(href,site.origin);
  if(isSearchHost(url,site)){
   if(site!==duckduckgo||url.pathname!=='/l/')return '';
   url=new URL(url.searchParams.get('uddg'));
  }
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2000)return '';
  return url.href;
 }catch{return ''}
}

async function inspectResults(page,site){
 const {status,entries}=await page.evaluate(({link,empty,challenge,wiby})=>{
  if(document.querySelector(challenge))return {status:'blocked',entries:[]};
  const text=(value,limit)=>value?.textContent?.replace(/\s+/g,' ').trim().slice(0,limit)||'';
  const entries=[...document.querySelectorAll(link)].slice(0,25).flatMap(anchor=>{
   if(anchor.closest('.result--ad, [data-testid="ad"]'))return [];
   const card=wiby?anchor.parentElement:anchor.closest('[data-testid="result"], .result');
   if(!card)return [];
   return [{url:anchor.getAttribute('href')?.slice(0,8001),title:text(anchor,300),
    description:text(card.querySelector(wiby?'p:not(.url)':'[data-result="snippet"], [data-testid="result-snippet"], .result__snippet'),700)}];
  });
  const noResults=[...document.querySelectorAll(empty)].some(node=>!wiby||/no (?:results|matches)|nothing found/i.test(node.textContent));
  return {status:entries.length?'results':noResults?'no_results':'parse_failed',entries};
 },{link:site.link,empty:site.empty,challenge,wiby:site===wiby});
 const results=[],seen=new Set();
 for(const item of entries){
  const url=resultUrl(item.url,site);
  if(!url||!item.title||seen.has(url))continue;
  seen.add(url);results.push({...item,url});
 }
 return {status:status==='results'&&!results.length?'parse_failed':status,results};
}

export async function readRenderedSearch(page){
 return (await inspectResults(page,duckduckgo)).results.slice(0,5);
}

const commonWords=new Set(['and','are','can','for','from','how','the','this','was','what','when','where','which','who','with','would']);
const searchWords=text=>text.toLowerCase().match(/[a-z0-9]+/g)||[];
function englishKeywords(query){
 if(!/^[\x20-\x7e]+$/.test(query)||!/[a-z]/i.test(query))return [];
 return [...new Set(searchWords(query).filter(word=>word.length>=2&&!commonWords.has(word)))];
}
function relevantResults(results,keywords){
 return results.filter(item=>{
  const words=new Set(searchWords(item.title+' '+new URL(item.url).hostname));
  return keywords.filter(word=>words.has(word)).length>=Math.min(keywords.length,2);
 });
}

async function crawlSearchPage(browser,site,query,signal,deadline){
 const started=Date.now();
 let stage='page',status='unavailable',page;
 try{
  signal.throwIfAborted();
  page=await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',request=>{
   let allowed=false;
   try{allowed=isSearchHost(new URL(request.url()),site)&&!['image','media','font'].includes(request.resourceType())}catch{}
   void (allowed?request.continue():request.abort()).catch(()=>{});
  });
  const url=new URL('/',site.origin);
  url.searchParams.set('q',query);
  stage='navigation';
  const remaining=limit=>Math.max(1,Math.min(limit,deadline-Date.now()));
  const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:remaining(site===duckduckgo?5000:3500)});
  if([202,401,403,429].includes(response?.status())||!isSearchHost(new URL(page.url()),site)){
   status='blocked';return {status,results:[]};
  }
  if(!response?.ok())return {status,results:[]};
  stage='results';
  try{await page.waitForSelector([site.link,site.empty,challenge].join(', '),{timeout:remaining(2200)})}
  catch(error){if(error.name!=='TimeoutError')throw error}
  signal.throwIfAborted();
  const outcome=await inspectResults(page,site);
  status=outcome.status;
  return outcome;
 }catch(error){
  if(signal.aborted)throw signal.reason;
  status=error.name==='TimeoutError'?'timeout':stage==='results'?'parse_failed':'unavailable';
  return {status,results:[]};
 }finally{
  console.info(JSON.stringify({event:'ai_web_search',site:site.id,stage,status,ms:Date.now()-started}));
  await page?.close?.().catch(()=>{});
 }
}

const failureMessages={
 blocked:'搜索站限制了自动访问，请在浏览器中继续。',
 timeout:'自动搜索超时，请在浏览器中继续。',
 no_results:'搜索站没有返回符合条件的结果。',
 parse_failed:'自动搜索未能读取结果页，可在浏览器中继续。',
 unavailable:'自动搜索暂不可用，请在浏览器中继续。',
 limit:'今日自动搜索次数已达上限，请在浏览器中继续。'
};
const searchFailure=(reason,code='web_search_'+reason)=>({
 results:[],browserSearch:true,reason,source:'duckduckgo',error:{code,message:failureMessages[reason]}
});

export const webSearchAvailable=env=>!!env.WEB_SEARCH_BROWSER;
export async function runWebSearch(env,account,args,signal,launchBrowser=binding=>puppeteer.launch(binding,{keep_alive:30000})){
 const query=webSearchQuery(args);
 signal?.throwIfAborted();
 if(!webSearchAvailable(env))return searchFailure('unavailable');
 const now=Date.now(),day=86400000,period=Math.floor(now/day);
 const bucket='ai-web-search:'+await hash(account+':'+period);
 await env.DB.prepare('DELETE FROM account_rate_limits WHERE bucket IN (SELECT bucket FROM account_rate_limits WHERE expires_at<? LIMIT 100)').bind(now).run();
 const credit=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<20 RETURNING count').bind(bucket,(period+1)*day).first();
 if(!credit)return searchFailure('limit');
 const started=Date.now(),budget=12000,deadline=started+budget;
 const timeout=AbortSignal.timeout(budget);
 const searchSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 let browser,closing,abort;
 const close=()=>{if(browser)closing??=browser.close().catch(()=>{})};
 const interrupted=new Promise((_,reject)=>{
  abort=()=>{close();reject(searchSignal.reason)};
  searchSignal.addEventListener('abort',abort,{once:true});
 });
 const search=async()=>{
  try{
   searchSignal.throwIfAborted();
   browser=await launchBrowser(env.WEB_SEARCH_BROWSER);
   searchSignal.throwIfAborted();
   const primary=await crawlSearchPage(browser,duckduckgo,query,searchSignal,deadline);
   if(primary.results.length)return {results:primary.results.slice(0,5),source:'duckduckgo'};
   const keywords=englishKeywords(query);
   if(keywords.length&&deadline-Date.now()>1500){
    const backup=await crawlSearchPage(browser,wiby,query,searchSignal,deadline);
    const results=relevantResults(backup.results,keywords).slice(0,5);
    if(results.length)return {results,source:'wiby'};
   }
   return searchFailure(primary.status);
  }finally{close();await closing}
 };
 try{
  return await Promise.race([search(),interrupted]);
 }catch(error){
  if(signal?.aborted)throw signal.reason||error;
  const reason=timeout.aborted?'timeout':'unavailable';
  console.info(JSON.stringify({event:'ai_web_search',site:'duckduckgo',stage:browser?'session':'launch',status:reason,ms:Date.now()-started}));
  return searchFailure(reason);
 }finally{
  searchSignal.removeEventListener('abort',abort);
 }
}
