import puppeteer from '@cloudflare/puppeteer';
import {hash,schema,str,int,validate} from './mcp-common.mjs';

export const WEB_SEARCH='web_search';
export const WEB_SEARCH_MAX_RESULTS=30;
export const WEB_SEARCH_DEFAULT_RESULTS=12;
const parameters=schema({query:str(400,1),maxResults:int(WEB_SEARCH_MAX_RESULTS,3)},['query']);
export const webSearchResultLimit=args=>args?.maxResults??WEB_SEARCH_DEFAULT_RESULTS;
export const webSearchTool={type:'function',function:{
 name:WEB_SEARCH,
 description:'Search public web sources for current information. Choose maxResults between 3 and 30 according to task complexity; refine the query or search again only when evidence is insufficient. Avoid repeating identical queries. Use brief public keywords, never personal notes, attachments or secrets. Each browser search counts against the user quota; Easybook checks approval before executing.',
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
  const entries=[...document.querySelectorAll(link)].slice(0,50).flatMap(anchor=>{
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
 return {status:status==='results'&&!results.length?'parse_failed':status,results,raw:entries.length,filtered:entries.length-results.length};
}

export async function readRenderedSearch(page){
 return (await inspectResults(page,duckduckgo)).results.slice(0,WEB_SEARCH_MAX_RESULTS);
}

const commonWords=new Set(['and','are','can','for','from','how','the','this','was','what','when','where','which','who','with','would']);
const searchWords=text=>text.toLowerCase().match(/[a-z0-9]+/g)||[];
function englishKeywords(query){
 if(!/^[\x20-\x7e]+$/.test(query)||!/[a-z]/i.test(query))return [];
 return [...new Set(searchWords(query).filter(word=>word.length>=2&&!commonWords.has(word)))];
}
function relevantResults(results,keywords){
 return results.filter(item=>{
  const words=new Set(searchWords(item.title+' '+(item.description||'')+' '+new URL(item.url).hostname));
  return keywords.filter(word=>words.has(word)).length>=Math.min(keywords.length,2);
 });
}

// A single Android Chromium profile keeps the viewport, input and UA fields aligned.
export async function configureMobileSearchPage(page,browserVersion,query){
 const version=/(?:HeadlessChrome|Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(browserVersion)?.[1];
 if(!version)throw Error('Chromium version unavailable');
 const language=/\p{Script=Han}/u.test(query)?'zh-CN':'en-US';
 const acceptLanguage=language==='zh-CN'?'zh-CN,zh;q=0.9,en;q=0.8':'en-US,en;q=0.9';
 const cdp=await page.createCDPSession();
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:412,height:839,screenWidth:412,screenHeight:915,deviceScaleFactor:2.625,mobile:true});
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await cdp.send('Emulation.setUserAgentOverride',{
  userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+version+' Mobile Safari/537.36',
  acceptLanguage,platform:'Linux armv8l',
  userAgentMetadata:{
   brands:[{brand:'Chromium',version:version.split('.')[0]}],fullVersionList:[{brand:'Chromium',version}],
   platform:'Android',platformVersion:'14.0.0',architecture:'arm',model:'Pixel 7',mobile:true,bitness:'64'
  }
 });
}

// DuckDuckGo initially renders only part of its results. Expand at most three
// more batches on the same search page; request interception still restricts
// navigation and assets to the search provider's public hosts.
export async function expandDuckDuckGoResults(page,initial,target,signal,deadline){
 let current=initial,loads=0;
 for(let attempt=0;attempt<3&&current.results.length<target&&deadline-Date.now()>900;attempt++){
  signal.throwIfAborted();
  const before=current.raw||current.results.length;
  const activated=await page.evaluate(()=>{
   const controls=[...document.querySelectorAll('button,a')];
   const more=controls.find(node=>node instanceof HTMLElement&&!node.hasAttribute('disabled')&&
    (node.matches('#more-results, .result--more__btn, [data-testid="more-results"], [data-testid="more-results-button"]')||
     /^(more results|show more|load more|更多结果|查看更多)$/i.test((node.textContent||'').trim())));
   if(more){more.click();return true}
   if(document.scrollingElement&&document.scrollingElement.scrollHeight>document.scrollingElement.clientHeight){
    document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight;return true;
   }
   return false;
  });
  if(activated!==true)break;
  const available=Math.min(1900,deadline-Date.now()-150);
  if(available<200)break;
  try{await page.waitForFunction((selector,count)=>document.querySelectorAll(selector).length>count,{timeout:available},duckduckgo.link,before)}
  catch(error){if(error?.name!=='TimeoutError')break}
  signal.throwIfAborted();
  const next=await inspectResults(page,duckduckgo);
  if(next.results.length<=current.results.length)break;
  current=next;loads++;
 }
 return {...current,loads};
}

async function crawlSearchPage(browser,site,query,signal,deadline,target=WEB_SEARCH_DEFAULT_RESULTS){
 const started=Date.now();
 let stage='page',status='unavailable',page;
 try{
  signal.throwIfAborted();
  page=await browser.newPage();
  if(site===duckduckgo){
   stage='browser_profile';
   await configureMobileSearchPage(page,await browser.version(),query);
  }
  await page.setRequestInterception(true);
  page.on('request',request=>{
   let allowed=false;
   try{allowed=isSearchHost(new URL(request.url()),site)}catch{}
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
  let outcome=await inspectResults(page,site);
  if(site===duckduckgo&&outcome.results.length&&outcome.results.length<target&&deadline-Date.now()>900)outcome=await expandDuckDuckGoResults(page,outcome,target,signal,deadline);
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
const searchFailure=(reason,code='web_search_'+reason,message=failureMessages[reason])=>({
 results:[],browserSearch:true,reason,source:'duckduckgo',error:{code,message}
});

export const webSearchAvailable=env=>!!env.WEB_SEARCH_BROWSER;
const FREE_DAILY_SEARCH_LIMIT=15;
const MEMBER_MONTHLY_SEARCH_LIMIT=1000;

// Search quotas reset at UTC midnight / the first day of the UTC calendar month.
// Membership is read from the authoritative subscription state on every search,
// so upgrades and expirations take effect without a client cache or migration.
export function webSearchQuota(now,membership){
 const active=Number(membership?.permanent)===1||Number(membership?.expires_at||0)>now;
 const date=new Date(now),day=86400000;
 const period=active?`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`:String(Math.floor(now/day));
 return {
  kind:active?'member':'free',
  limit:active?MEMBER_MONTHLY_SEARCH_LIMIT:FREE_DAILY_SEARCH_LIMIT,
  period,
  expiresAt:active?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1):(Math.floor(now/day)+1)*day
 };
}

// A read-only snapshot for the signed-in account; never increments its quota.
export async function webSearchUsage(env,account,now=Date.now()){
 const membership=await env.DB.prepare('SELECT permanent,expires_at FROM account_memberships WHERE account_id=?').bind(account).first();
 const quota=webSearchQuota(now,membership);
 const bucket='ai-web-search:'+(quota.kind==='member'?'month:':'')+await hash(account+':'+quota.period);
 const record=await env.DB.prepare('SELECT count FROM account_rate_limits WHERE bucket=? AND expires_at>?').bind(bucket,now).first();
 const used=Math.min(quota.limit,Math.max(0,Number(record?.count)||0));
 return {tier:quota.kind,period:quota.kind==='member'?'month':'day',used,limit:quota.limit,remaining:quota.limit-used,resetAt:quota.expiresAt};
}

export async function runWebSearch(env,account,args,signal,launchBrowser=binding=>puppeteer.launch(binding,{keep_alive:30000}),browserLease){
 const query=webSearchQuery(args),maxResults=webSearchResultLimit(args);
 signal?.throwIfAborted();
 if(!webSearchAvailable(env))return searchFailure('unavailable');
 const now=Date.now();
 const membership=await env.DB.prepare('SELECT permanent,expires_at FROM account_memberships WHERE account_id=?').bind(account).first();
 const quota=webSearchQuota(now,membership);
 const bucket='ai-web-search:'+(quota.kind==='member'?'month:':'')+await hash(account+':'+quota.period);
 await env.DB.prepare('DELETE FROM account_rate_limits WHERE bucket IN (SELECT bucket FROM account_rate_limits WHERE expires_at<? LIMIT 100)').bind(now).run();
 const credit=await env.DB.prepare('INSERT INTO account_rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(bucket,quota.expiresAt,quota.limit).first();
 if(!credit)return searchFailure('limit','web_search_limit',quota.kind==='member'?'会员本月自动搜索次数已达上限，请在浏览器中继续。':'今日自动搜索次数已达上限，请在浏览器中继续。');
 const started=Date.now(),budget=12000,deadline=started+budget;
 const timeout=AbortSignal.timeout(budget);
 const searchSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 let browser,closing,abort;
 const close=()=>{if(browser){if(browserLease?.browser===browser)browserLease.browser=null;closing??=browser.close().catch(()=>{})}};
 const interrupted=new Promise((_,reject)=>{
  abort=()=>{close();reject(searchSignal.reason)};
  searchSignal.addEventListener('abort',abort,{once:true});
 });
 const search=async()=>{
  try{
   searchSignal.throwIfAborted();
   browser=browserLease?.browser||await launchBrowser(env.WEB_SEARCH_BROWSER);
   if(browserLease)browserLease.browser=browser;
   searchSignal.throwIfAborted();
   const primary=await crawlSearchPage(browser,duckduckgo,query,searchSignal,deadline,maxResults);
   let secondary={results:[],raw:0,filtered:0},matched=[];
   const keywords=englishKeywords(query);
   // A partial DDG result page no longer prevents a useful Wiby fallback.
   // Wiby is constrained to English keywords and ranked conservatively.
   if(primary.results.length<maxResults&&keywords.length&&deadline-Date.now()>1800){
    secondary=await crawlSearchPage(browser,wiby,query,searchSignal,deadline,maxResults);
    matched=relevantResults(secondary.results,keywords);
   }
   const seen=new Set(),unique=[];
   for(const item of [...primary.results.map(r=>({...r,source:'duckduckgo'})),...matched.map(r=>({...r,source:'wiby'}))]){
    if(seen.has(item.url))continue;
    seen.add(item.url);unique.push(item);
   }
   const results=unique.slice(0,maxResults);
   const diagnostics={requested:maxResults,duckduckgo:{raw:primary.raw||0,accepted:primary.results.length,loads:primary.loads||0},
    wiby:{raw:secondary.raw||0,accepted:matched.length},duplicatesRemoved:primary.results.length+matched.length-unique.length,returned:results.length};
   if(results.length)return {results,source:primary.results.length?'duckduckgo':'wiby',diagnostics};
   return {...searchFailure(primary.status),diagnostics};
  }finally{if(!browserLease){close();await closing}}
 };
 try{
  return await Promise.race([search(),interrupted]);
 }catch(error){
  if(browserLease){close();await closing}
  if(signal?.aborted)throw signal.reason||error;
  const limited=error?.status===429||/429|rate.limit|too.many.requests/i.test(String(error?.message||''));
  const reason=timeout.aborted?'timeout':limited?'rate_limited':'unavailable';
  console.info(JSON.stringify({event:'ai_web_search',site:'duckduckgo',stage:browser?'session':'launch',status:reason,ms:Date.now()-started}));
  return reason==='rate_limited'?searchFailure(reason,'web_search_rate_limited','云端浏览器启动过于频繁，请稍后重试；已启用的 Parallel 搜索仍可继续。'):searchFailure(reason);
 }finally{
  searchSignal.removeEventListener('abort',abort);
 }
}
