import assert from 'node:assert/strict';
import {parsePublicSearchRss,searchPublicRss} from '../worker/ai-search-fallback.mjs';

const sample='<?xml version="1.0"?><rss><channel>'+
 '<item><title>SpaceX &amp; Falcon 9</title><link>https://example.org/one?a=1&amp;b=2</link><description><![CDATA[<p>First &amp; second</p>]]></description></item>'+
 '<item><title>Duplicate</title><link>https://example.org/one?a=1&amp;b=2</link></item>'+
 '<item><title>Unsafe</title><link>javascript:alert(1)</link></item>'+
 '<item><title>Elon Musk biography</title><link>https://example.org/two</link><description>History</description></item>'+
 '</channel></rss>';
const rows=parsePublicSearchRss(sample,10);
assert.equal(rows.length,2);
assert.equal(rows[0].title,'SpaceX & Falcon 9');
assert.equal(rows[0].url,'https://example.org/one?a=1&b=2');
assert.match(rows[0].description,/First & second/);
const fetcher=async(url,options)=>{
 const parsed=new URL(url);
 assert.equal(parsed.hostname,'www.bing.com');
 assert.equal(parsed.searchParams.get('q'),'Elon Musk SpaceX');
 assert.equal(parsed.searchParams.get('format'),'rss');
 assert.equal(options.redirect,'error');
 return new Response(sample,{headers:{'content-type':'application/rss+xml'}});
};
const response=await searchPublicRss('Elon Musk SpaceX',3,undefined,fetcher);
assert.equal(response.source,'bing-rss');
assert.equal(response.results.length,2);
assert.deepEqual(parsePublicSearchRss('<item><title>bad</title><link>file:///etc/passwd</link></item>'),[]);
console.log('PASS browser-free RSS search fallback, XML decoding and URL validation');
