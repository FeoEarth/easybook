import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {membershipPage} from '../worker/membership-page.mjs';
async function wait(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}throw Error('UI did not reach expected state')}
for(const simulation of [true,false]){
 const f=await fixture();let dom;const errors=[];
 try{
 f.env.MEMBERSHIP_SIMULATION=String(simulation);
 const response=await membershipPage(new Request(f.origin+'/membership',{headers:{Cookie:f.cookie}}),f.env),html=await response.text();assert.ok(!html.includes(f.nativeToken));
 let copied='';
 dom=new JSDOM(html,{url:f.origin+'/membership',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole().on('jsdomError',e=>errors.push(e)),beforeParse(window){
 window.HTMLCanvasElement.prototype.getContext=()=>null; // JSDOM has no canvas renderer.
 window.AbortController=AbortController; // The injected fetch uses Node's Request and AbortSignal.
 Object.defineProperty(window.crypto,'randomUUID',{value:()=>crypto.randomUUID()});Object.defineProperty(window.navigator,'clipboard',{value:{async writeText(s){copied=s}}});
 window.fetch=async(path,options={})=>{
 const headers=new Headers(options.headers);headers.set('Cookie',f.cookie);headers.set('Origin',f.origin);
 if(path==='/__simulate'){const {orderId}=JSON.parse(options.body),order=f.sql.prepare('SELECT * FROM membership_purchases WHERE id=?').get(orderId);f.inject(order);await f.scan();return Response.json({simulated:true})}
 return membershipAPI(new Request(f.origin+path,{...options,headers}),f.env);
 };
 }});
 const doc=dom.window.document;
 await wait(()=>doc.querySelectorAll('#networkList [role=option]').length===4&&!doc.querySelector('#buy').disabled);
 doc.querySelector('#buy').click();await wait(()=>doc.querySelector('[data-method=chain]'));assert.equal(f.sql.prepare('SELECT payment_method FROM membership_purchases').get().payment_method,'unselected');doc.querySelector('[data-method=chain]').click();
 doc.querySelector('#network').click();assert.equal(doc.querySelector('#networkLayer').hidden,false);doc.querySelector('[data-chain="9745"]').click();await wait(()=>doc.querySelector('#networkLayer').hidden);assert.equal(doc.querySelector('#network').value,'9745');assert.ok(doc.querySelector('#networkIcon use').getAttribute('href').includes('9745'));doc.querySelector('#confirmPayment').click();
 await wait(()=>doc.querySelector('#paymentContent code'));
 const order=f.sql.prepare('SELECT * FROM membership_purchases').get();assert.equal(order.chain_id,9745);assert.equal(doc.querySelector('#paymentContent code').textContent,order.address);assert.match(doc.querySelector('#paymentContent').textContent,/Plasma/);assert.match(doc.querySelector('#paymentContent').textContent,/USDT0/);assert.match(doc.querySelector('#paymentContent').textContent,new RegExp(order.token));
 const image=doc.querySelector('#paymentContent img');assert.equal(doc.querySelector('.qr-card').getAttribute('aria-busy'),'true');image.dispatchEvent(new dom.window.Event('load'));await wait(()=>doc.querySelector('.qr-card').classList.contains('ready'));assert.equal(new URL(image.src).searchParams.get('qr'),order.id);
 const copy=[...doc.querySelectorAll('#paymentContent button')].find(b=>b.textContent==='复制地址');copy.click();await wait(()=>copied===order.address);
 const mock=[...doc.querySelectorAll('#paymentContent button')].find(b=>b.textContent==='模拟准确到账');
 if(simulation){assert.ok(mock);mock.click();await wait(()=>doc.querySelector('#paymentContent').textContent.includes('已开通'));assert.ok(!doc.querySelector('#paymentContent img'));}
 else{assert.equal(mock,undefined);assert.ok(!doc.querySelector('[role=alert]'));}
 await wait(()=>!doc.querySelector('#buy').disabled); // The simulated purchase refreshes the quote.
 doc.querySelector('#closePayment').click();await wait(()=>doc.querySelector('#paymentLayer').hidden);assert.equal(doc.activeElement.id,'buy');assert.deepEqual(errors,[]);
 }finally{dom?.window.close();f.close()}
}
console.log('PASS real address/QR, contract and network labels, clipboard and isolated local simulation UI');
