import {membershipUI} from './membership-ui.mjs';
import {hash} from './mcp-common.mjs';
import QRCode from 'qrcode/lib/core/qrcode.js';
import SVG from 'qrcode/lib/renderer/svg-tag.js';
import {membershipPrincipal} from './membership.mjs';
import {session,csrf,readCookie} from '../mcp-oauth/src/accounts.mjs';
export async function membershipPage(request,env){
 let token='',cookie='',csrfValue='';
 try{
 const p=await membershipPrincipal(request,env);if(p.kind!=='account')throw Error();
 if(request.headers.get('Authorization')?.startsWith('Easybook-Session ')){
 token=crypto.randomUUID()+crypto.randomUUID();await env.DB.batch([env.DB.prepare('DELETE FROM membership_web_sessions WHERE expires_at<?').bind(Date.now()),env.DB.prepare('INSERT INTO membership_web_sessions VALUES(?,?,?)').bind(await hash(token),p.sessionId,Date.now()+1800000)]);cookie='__Host-easybook-membership='+token+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800';csrfValue=await hash(token);
 }else{token=readCookie(request,'__Host-easybook-membership');csrfValue=token?await hash(token):await csrf(request,await session(request,env))}
 }catch{return new Response('<meta charset="utf-8"><p>请先登录账户，再打开会员页面。</p><a href="/account">登录账户</a>',{status:401,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})}
 const url=new URL(request.url),simulation=env.MEMBERSHIP_SIMULATION==='true';
 if(simulation&&!['localhost','127.0.0.1','membership.test'].includes(url.hostname))return new Response('Simulation is local only',{status:403});
 if(url.searchParams.has('depositQr')){const wallet=await env.DB.prepare('SELECT address FROM membership_account_wallets WHERE account_id=?').bind((await membershipPrincipal(request,env)).accountId).first();if(!wallet)return new Response('Not found',{status:404});return new Response(SVG.render(QRCode.create(wallet.address),{}),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}})}
 if(url.searchParams.has('qr')){const order=await env.DB.prepare('SELECT address FROM membership_purchases WHERE id=? AND account_id=?').bind(url.searchParams.get('qr'),(await membershipPrincipal(request,env)).accountId).first();if(!order)return new Response('Not found',{status:404});return new Response(SVG.render(QRCode.create(order.address),{}),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}})}
 return new Response(membershipUI({csrf:csrfValue,simulation}),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",...(cookie?{'Set-Cookie':cookie}:{})}})
}
