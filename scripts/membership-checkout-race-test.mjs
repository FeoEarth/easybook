// Local SQLite and simulated RPC only. No live payments.
import assert from 'node:assert/strict';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {PRICE_VERSION} from '../worker/membership-plans.mjs';
import {accountBalance} from '../worker/membership-bonus.mjs';

const call=(f,path,body)=>membershipAPI(new Request(f.origin+'/api/membership'+path,{
 method:body===undefined?'GET':'POST',
 headers:{Cookie:f.cookie,Origin:f.origin,'Content-Type':'application/json','X-Easybook-CSRF':f.csrf},
 ...(body===undefined?{}:{body:JSON.stringify(body)})
}),f.env);
async function success(response){
 assert.ok(response.ok,await response.clone().text());
 return response.json();
}
const giftRequest=(amount,idempotency=crypto.randomUUID())=>({kind:'balance',amount,chainId:137,idempotency});
const paymentBody=order=>({amount:order.amount,plan:order.plan,chainId:137});

const f=await fixture();
try{
 await success(await call(f,''));
 f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run('20000000',f.account);

 const request=giftRequest('5');
 const order=await success(await call(f,'/gift-orders',request));
 assert.equal((await success(await call(f,'/gift-orders',request))).id,order.id);
 const duplicate=await call(f,'/gift-cards/buy',request);
 assert.equal(duplicate.status,409);
 assert.equal((await duplicate.json()).error,'idempotency_conflict');
 assert.equal((await accountBalance(f.env,f.account)).balance,'20.00');

 const other=giftRequest('5');
 const conflict=await call(f,'/gift-orders',other);
 assert.equal(conflict.status,409);
 const pending=await conflict.json();
 assert.equal(pending.error,'pending_order_exists');
 assert.equal(pending.order.id,order.id);

 const pay=()=>call(f,'/gift-orders/'+order.id+'/pay',paymentBody(order));
 const receipts=await Promise.all([pay(),pay()]).then(results=>Promise.all(results.map(success)));
 assert.ok(receipts.every(row=>row.id===order.id&&row.settled_at));
 assert.equal((await accountBalance(f.env,f.account)).balance,'15.00');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_gift_cards').get().n,1);

 const oldPurchase=giftRequest('2');
 await success(await call(f,'/gift-cards/buy',oldPurchase));
 const collision=await call(f,'/gift-orders',oldPurchase);
 assert.equal(collision.status,409);
 assert.equal((await collision.json()).error,'idempotency_conflict');

 const concurrentKey=crypto.randomUUID();
 const responses=await Promise.all(['1','2'].map(amount=>call(f,'/gift-orders',giftRequest(amount,concurrentKey))));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const winner=await responses.find(r=>r.ok).json();
 assert.equal((await responses.find(r=>!r.ok).json()).error,'idempotency_conflict');
 await success(await call(f,'/gift-orders/'+winner.id+'/cancel',{}));

 const competing=await Promise.all(['1','2'].map(amount=>call(f,'/gift-orders',giftRequest(amount))));
 assert.deepEqual(competing.map(r=>r.status).sort(),[201,409]);
 const active=await competing.find(r=>r.ok).json();
 const rejected=await competing.find(r=>!r.ok).json();
 assert.equal(rejected.error,'pending_order_exists');
 assert.equal(rejected.order.id,active.id);
 await success(await call(f,'/gift-orders/'+active.id+'/cancel',{}));

 const simultaneous=giftRequest('1');
 const replies=await Promise.all([
  call(f,'/gift-orders',simultaneous),
  call(f,'/gift-cards/buy',simultaneous)
 ]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 assert.equal((await replies.find(r=>!r.ok).json()).error,'idempotency_conflict');
 const bought=await replies.find(r=>r.ok).json();
 if(bought.record_type==='gift_purchase_order'){
  await success(await call(f,'/gift-orders/'+bought.id+'/pay',paymentBody(bought)));
 }
 assert.equal((await accountBalance(f.env,f.account)).balance,'12.00');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_gift_cards WHERE request_id=?').get(simultaneous.idempotency).n,1);
}finally{f.close()}

for(const kind of ['gift','membership']){
 const f=await fixture();
 try{
  const endpoint=kind==='gift'?'/gift-orders':'/orders';
  const request=kind==='gift'?giftRequest('2'):{plan:'month',chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),reserveOnly:true};
  const order=await success(await call(f,endpoint,request));
  const fund=()=>call(f,endpoint+'/'+order.id+'/fund',paymentBody(order));
  assert.equal((await success(await fund())).payment_method,'chain');

  // Make the status retry wake the scanner. Settlement happens before the activation UPDATE.
  const log=f.inject(order);
  f.sql.prepare('UPDATE membership_cursors SET updated_at=0 WHERE chain_id=?').run(order.chain_id);
  let scans=0;
  f.env.MEMBERSHIP_JOB_TOKEN='local-fixture';
  f.env.MEMBERSHIP_SCANNER={fetch:async()=>{
   scans++;
   await f.scan();
   return Response.json({ok:true});
  }};
  const result=await success(await fund());
  assert.equal(scans,1);
  assert.ok(result.settled_at,kind+' returns its settled order');
  assert.equal(result.id,order.id);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM membership_receipts WHERE tx=?').get(log.transactionHash).n,1);
  assert.equal((await success(await fund())).settled_at,result.settled_at);
 }finally{f.close()}
}
for(const kind of ['gift','membership']){
 const f=await fixture();
 try{
  const endpoint=kind==='gift'?'/gift-orders':'/orders';
  const request=kind==='gift'?giftRequest('1'):{plan:'month',chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),reserveOnly:true};
  const order=await success(await call(f,endpoint,request));
  f.sql.prepare('UPDATE membership_balances SET units=? WHERE account_id=?').run(order.amount,f.account);

  // Hold the first request on its balance read, after it has already loaded the open order.
  // The other request can settle and deplete the balance before the first one resumes.
  const {promise:paused,resolve:pause}=Promise.withResolvers();
  const {promise:resume,resolve:resumeRead}=Promise.withResolvers();
  const prepare=f.DB.prepare.bind(f.DB);
  let delayFirst=true;
  f.DB.prepare=sql=>{
   const statement=prepare(sql);
   if(sql==='SELECT units FROM membership_balances WHERE account_id=?'&&delayFirst){
    delayFirst=false;
    const read=statement.first.bind(statement);
    statement.first=async()=>{pause();await resume;return read()};
   }
   return statement;
  };
  const pay=()=>call(f,endpoint+'/'+order.id+'/pay',paymentBody(order)).then(success);
  const delayed=pay();
  await Promise.race([paused,delayed.then(()=>assert.fail('First payment did not pause on the balance read'))]);
  const settled=await pay().finally(resumeRead);
  assert.ok(settled.settled_at);
  assert.equal((await delayed).settled_at,settled.settled_at);
  assert.equal((await accountBalance(f.env,f.account)).balance,'0.00');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM membership_balance_events WHERE kind IN ('debit','gift_purchase')").get().n,1);
 }finally{f.close()}
}
for(const kind of ['gift','membership']){
 const f=await fixture();
 const realNow=Date.now;
 try{
  const endpoint=kind==='gift'?'/gift-orders':'/orders';
  const request=kind==='gift'?giftRequest('2'):{plan:'month',chainId:137,priceVersion:PRICE_VERSION,idempotency:crypto.randomUUID(),reserveOnly:true};
  const order=await success(await call(f,endpoint,request));
  const path=endpoint+'/'+order.id;
  await success(await call(f,path+'/fund',paymentBody(order)));
  // Both credits and the cancellation are recorded in the same millisecond.
  const realTime=realNow();
  Date.now=()=>realTime;
  f.inject(order,{amount:'400000'});await f.scan();
  assert.equal((await success(await call(f,path+'/cancel',{}))).received,'0.40');
  f.inject(order,{amount:'600000'});await f.scan();
  assert.equal((await success(await call(f,path))).received,'0.40');
  assert.equal((await accountBalance(f.env,f.account)).balance,'1.00');
 }finally{Date.now=realNow;f.close()}
}
console.log('PASS checkout idempotency, account-scoped conflicts and concurrent payment settlement');
