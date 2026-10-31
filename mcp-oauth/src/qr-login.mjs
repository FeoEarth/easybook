import {hash} from '../../worker/mcp-common.mjs';
import {IDENTITY_ORIGIN,identityEnabled} from '../../worker/identity-origin.mjs';
import {session,csrf,requireForm,rateLimit,random,json,page,redirect,createSession,cookie,readCookie} from './accounts.mjs';
import {nativeSession,nativeBody,s256} from './native-sessions.mjs';
import {sessionAllowed} from '../../worker/security-checkpoint.mjs';
import {QR_ID,QR_CHALLENGE,QR_STATE,QR_TTL_MS,qrState,validateQrRequest,createQrChallenge} from './qr-challenge.mjs';
import {escape} from './appearance.mjs';
import qrcode from './vendor/qrcode-generator.mjs';

const fail=(code,status=400)=>json({error:code},status);
const webPost=request=>request.method==='POST'&&request.headers.get('Origin')===IDENTITY_ORIGIN&&request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/json';
const postBody=async request=>{
 const contentType=request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
 if(contentType!=='application/json'||Number(request.headers.get('Content-Length')||0)>4096)throw fail('invalid_body',400);
 const raw=await request.text();if(raw.length>4096)throw fail('invalid_body',400);
 try{const x=JSON.parse(raw);if(x&&typeof x==='object'&&!Array.isArray(x))return x}catch{}
 throw fail('invalid_body',400);
};
async function lookup(env,id){
 if(!QR_ID.test(id||''))return null;
 return env.DB.prepare('SELECT * FROM account_qr_logins WHERE id_hash=?').bind(await hash(id)).first();
}
async function approve(env,id,approver,decision){
 if(!['allow','deny'].includes(decision))return fail('invalid_decision');
 const r=await lookup(env,id);if(qrState(r)!=='pending')return fail('expired_or_used',409);
 if(Date.now()-approver.authenticated_at>300000)return fail('reauthentication_required',403);
 const now=Date.now(),digest=await hash(id);
 const stmt=decision==='allow'
  ?env.DB.prepare('UPDATE account_qr_logins SET approved_account_id=?,approved_session_id=?,approved_at=? WHERE id_hash=? AND expires_at>? AND approved_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL RETURNING id_hash').bind(approver.account_id,approver.id,now,digest,now)
  :env.DB.prepare('UPDATE account_qr_logins SET cancelled_at=? WHERE id_hash=? AND expires_at>? AND approved_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL RETURNING id_hash').bind(now,digest,now);
 return await stmt.first()?json({status:decision==='allow'?'approved':'cancelled'}):fail('expired_or_used',409);
}
const QR_COOKIE='__Host-easybook-qr-login';
function qrPage(id,entry){
 const url=IDENTITY_ORIGIN+'/account/qr/approve?id='+id;
 const image=qrcode(0,'M');image.addData(url);image.make();
 const svg=image.createSvgTag({cellSize:5,margin:20,scalable:true});
 return page('使用二维码登录','<p>在已经登录 Easybook 的手机、电脑或平板上扫描二维码，确认后即可登录此设备。</p><div style="max-width:290px;margin:24px auto;padding:14px;background:white;border-radius:22px">'+svg+'</div><p>二维码有效期约 '+Math.max(0,Math.ceil((entry.expires_at-Date.now())/1000))+' 秒，确认页面会显示待登录设备类型。</p><p><a class="link" href="'+escape(url)+'">也可以在其他已登录设备打开授权链接</a></p><p>请勿批准任何不是你本人发起的登录请求。</p>',{'Refresh':'3; url=/account/qr/wait'});
}
async function browserWait(request,env){
 const [id,state,verifier]=readCookie(request,QR_COOKIE).split('.');
 const pending=await lookup(env,id);
 if(!QR_ID.test(id||'')||!QR_STATE.test(state||'')||!QR_ID.test(verifier||'')||!pending||pending.initiator_kind!=='web'||await hash(state)!==pending.state_hash||await s256(verifier)!==pending.challenge)return redirect('/account/qr',[cookie(QR_COOKIE,'',0)]);
 const phase=qrState(pending);
 if(phase==='approved'){
  const redeemed=await redeemQr(request,env,pending,{id,state,verifier},false);
  if(redeemed.status!==200)return redeemed;
  const set=redeemed.headers.get('Set-Cookie');
  return redirect('/account',[set,cookie(QR_COOKIE,'',0)]);
 }
 if(phase==='pending')return qrPage(id,pending);
 return redirect('/account/qr',[cookie(QR_COOKIE,'',0)]);
}
async function redeemQr(request,env,entry,input,native){
 const source=await env.DB.prepare('SELECT * FROM account_sessions WHERE id=? AND account_id=? AND revoked_at IS NULL AND expires_at>?').bind(entry.approved_session_id,entry.approved_account_id,Date.now()).first();
 if(!source||!await sessionAllowed(env,source))return fail('approval_revoked',403);
 const factor=await env.DB.prepare('SELECT credential_id FROM account_session_passkeys WHERE session_id=?').bind(source.id).first();
 const now=Date.now();
 const proof=await env.DB.prepare("DELETE FROM account_qr_logins WHERE id_hash=? AND initiator_kind=? AND challenge=? AND state_hash=? AND approved_session_id=? AND approved_at IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.id=account_qr_logins.approved_session_id AND s.account_id=account_qr_logins.approved_account_id AND s.revoked_at IS NULL AND s.expires_at>? AND a.deleted_at IS NULL) RETURNING approved_account_id").bind(await hash(input.id),native?'android':'web',entry.challenge,entry.state_hash,source.id,now,now).first();
 if(!proof)return fail('already_used',409);
 const established=await createSession(request,env,proof.approved_account_id,factor?.credential_id||null,source.authenticated_at);
 if(native){
  await env.DB.prepare('INSERT INTO account_native_sessions(session_id,created_at) VALUES(?,?)').bind(established.id,now).run();
  return json({token:established.token,session_id:established.id,expires_in:604800});
 }
 const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
 headers.append('Set-Cookie',established.cookie);
 return new Response(JSON.stringify({ok:true}),{headers});
}
export async function qrLoginRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(path!=='/account/qr'&&!path.startsWith('/account/qr/')&&!path.startsWith('/account/native/qr/'))return null;
 if(!identityEnabled(env)||url.origin!==IDENTITY_ORIGIN)return fail('not_available',404);
 if(path==='/account/qr'&&request.method==='GET'){
  await rateLimit(request,env,'qr-browser-start',10);
  const current=await session(request,env);
  if(current)return redirect('/account');
  const id=random(),state=random(),verifier=random(),challenge=await s256(verifier),state_hash=await hash(state);
  await createQrChallenge(env.DB,await hash(id),{challenge,state,state_hash},'web');
  const entry=await lookup(env,id);
  const response=qrPage(id,entry);response.headers.set('Set-Cookie',cookie(QR_COOKIE,id+'.'+state+'.'+verifier,120));return response;
 }
 if(path==='/account/qr/wait'&&request.method==='GET')return browserWait(request,env);
 const native=path.startsWith('/account/native/qr/');
 const action=path.split('/').pop();
 if(action==='approve'&&!native&&request.method==='GET'){
  const id=url.searchParams.get('id'),entry=await lookup(env,id);
  if(qrState(entry)!=='pending')return page('二维码已失效','<p>请在发起设备重新生成登录二维码。</p>');
  const current=await session(request,env);
  if(!current)return redirect('/account/passkeys?return='+encodeURIComponent(path+'?id='+id));
  const hidden='<input type="hidden" name="id" value="'+escape(id)+'"><input type="hidden" name="csrf" value="'+await csrf(request,current)+'">';
  return page('确认扫码登录','<p>另一个 '+(entry.initiator_kind==='android'?'Android':'Web')+' 设备请求登录 Easybook。仅在你本人发起操作时确认；扫码不会传输工作区同步密钥。</p><p>当前账户：<strong>'+escape(current.display_name)+'</strong></p><form method="post" action="/account/qr/approve">'+hidden+'<button name="decision" value="allow">确认登录</button><button name="decision" value="deny">拒绝</button></form>');
 }
 if(!['start','status','redeem','approve'].includes(action)||request.method!=='POST')return fail('method_not_allowed',405);
 await rateLimit(request,env,'qr-'+action,action==='status'?120:15);
 let input;
 if(native){input=await nativeBody(request,4096)}
 else if(action==='approve'){
  const current=await session(request,env);if(!current)return fail('unauthorized',401);
  const form=await requireForm(request,current,2048);
  const answer=await approve(env,form.get('id'),current,form.get('decision'));
  return answer.status===200?page('扫码确认完成','<p>请求已处理。请返回发起登录的设备。</p>'):answer;
 }else{
  if(!webPost(request))return fail('invalid_origin_or_content_type',403);
  input=await postBody(request);
 }
 if(action==='approve'){
  const current=await nativeSession(request,env);if(!current)return fail('unauthorized',401);
  return approve(env,input?.id,current,input?.decision);
 }
 if(action==='start'){
  if(!validateQrRequest(input))return fail('invalid_challenge');
  const id=random(),state_hash=await hash(input.state);
  await createQrChallenge(env.DB,await hash(id),{...input,state_hash},native?'android':'web');
  return json({id,confirm_url:IDENTITY_ORIGIN+'/account/qr/approve?id='+id,expires_in:QR_TTL_MS/1000});
 }
 const entry=await lookup(env,input?.id);
 if(!entry||entry.initiator_kind!==(native?'android':'web')||!QR_STATE.test(input?.state||'')||typeof input?.verifier!=='string'||!QR_CHALLENGE.test(entry.challenge)||await hash(input.state)!==entry.state_hash||await s256(input.verifier)!==entry.challenge)return fail('invalid_grant',400);
 const status=qrState(entry);
 if(action==='status')return json({status});
 if(status!=='approved')return fail('not_approved',409);
 return redeemQr(request,env,entry,input,native);
}
