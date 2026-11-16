// Loopback-only simulation server: no deployment entrypoint and no real chain calls.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {fixture} from './membership-fixture.mjs';
import {membershipAPI} from '../worker/membership.mjs';
import {membershipPage} from '../worker/membership-page.mjs';
const wallet=JSON.parse(readFileSync('.local-membership/wallet.json','utf8'));
if(!wallet.testOnly)throw Error('Test wallet required');
mkdirSync('.local-membership',{recursive:true,mode:0o700});
const origin='http://127.0.0.1:8789',f=await fixture({wallet,origin,filename:'.local-membership/demo.sqlite'});
const server=createServer(async(req,res)=>{
 try{
 if(req.headers.host!=='127.0.0.1:8789'){res.writeHead(403);res.end();return}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);res.end();return}}
 const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(body?{body}:{})}),path=new URL(request.url).pathname;
 let response;
 if(path==='/')response=new Response(null,{status:302,headers:{Location:'/membership','Set-Cookie':f.cookie+'; Secure; HttpOnly; SameSite=Strict; Path=/'}});
 else if(path==='/__simulate'&&req.method==='POST'){
 if(req.headers.origin!==origin||!req.headers.cookie?.split(';').map(x=>x.trim()).includes(f.cookie)||req.headers['x-easybook-csrf']!==f.csrf)response=Response.json({error:'forbidden'},{status:403});
 else{const data=JSON.parse(body),order=f.sql.prepare('SELECT * FROM membership_orders WHERE id=? AND account_id=?').get(data.orderId,f.account);if(!order)response=Response.json({error:'not_found'},{status:404});else{f.inject(order);await f.scan();response=Response.json({simulated:true})}}
 }else if(path==='/membership')response=await membershipPage(request,f.env);
 else if(path==='/api/membership'||path.startsWith('/api/membership/'))response=await membershipAPI(request,f.env);
 else response=new Response('Not found',{status:404});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Local simulation error')}
});
const ticker=setInterval(()=>f.scan().catch(()=>console.error('Local scanner error')),60000);
server.listen(8789,'127.0.0.1',()=>console.log('模拟支付测试，请勿转账: '+origin));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(ticker);server.close(()=>{f.close();process.exit(0)})});
