package com.feoearth.easybook;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.widget.Toast;
import android.os.CancellationSignal;
import androidx.credentials.*;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.CreateCredentialException;
import org.json.*;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;

/** Account tokens and PKCE verifiers are native-only Keystore envelopes.
 * Browser callbacks carry a short-lived one-use code, never a session token. */
final class NativeAccount {
    static final String ORIGIN="https://easybook.loonxy.com";
    // Native HTTP cannot complete browser bot challenges. Browser/RP stay canonical.
    static final String IDENTITY_API="https://easybook-mcp-oauth.1902521952.workers.dev";
    static final String SYNC_API="https://easybook-sync.1902521952.workers.dev";
    private static final String SESSION="account-session-v1",PENDING="account-login-pending-v1",LOGOUT="account-logout-pending-v1";
    private final Activity activity;private final NoteRepository db;private final ExecutorService io;
    private static final ExecutorService revocations=java.util.concurrent.Executors.newSingleThreadExecutor();
    private volatile boolean starting;
    private volatile String feedback="",stage="账户验证";
    private void stage(String value){stage=value;feedback=value+"…";changed();}
    private void report(Exception error){String detail=error instanceof HttpFailure?" [HTTP "+((HttpFailure)error).status+(((HttpFailure)error).code.isEmpty()?"":" / "+((HttpFailure)error).code)+"]":"";message(stage+"："+failureMessage(error)+detail);}
    private void changed(){if(activity instanceof MainActivity)((MainActivity)activity).accountChanged();}
    private synchronized boolean startOperation(){if(starting)return false;starting=true;feedback="正在准备账户验证…";changed();return true;}
    private void finishOperation(){starting=false;cancellation=null;changed();}
    private volatile CancellationSignal cancellation;
    static final class HttpFailure extends IOException {final int status;final boolean challenge;final String code;HttpFailure(int value,boolean challenged,String code){super("Account HTTP "+value);status=value;challenge=challenged;this.code=code;}}
    NativeAccount(Activity activity,NoteRepository db,ExecutorService io){this.activity=activity;this.db=db;this.io=io;revocations.execute(this::retryLogout);}
    private JSONObject read(String name)throws Exception{String value=db.setting(name,"");return value.isEmpty()?null:new JSONObject(db.vault.open(value,name));}
    static String token(NoteRepository db)throws Exception{String raw=db.setting(SESSION,"");if(raw.isEmpty())throw new CredentialVault.KeyUnavailable();JSONObject s=new JSONObject(db.vault.open(raw,SESSION));if(s.getLong("expires")<=System.currentTimeMillis())throw new CredentialVault.KeyUnavailable();return s.getString("token");}
    private void write(String name,JSONObject value)throws Exception{String sealed=db.vault.seal(value.toString(),name);if(!value.toString().equals(db.vault.open(sealed,name)))throw new SecurityException("Account persistence verification failed");db.setSetting(name,sealed);}
    JSONObject publicStatus()throws Exception{return status().put("busy",starting).put("feedback",feedback).put("build",BuildConfig.VERSION_CODE).put("source",BuildConfig.SOURCE_SHA);}
    private JSONObject status()throws Exception{try{JSONObject value=read(SESSION);if(value==null)return new JSONObject().put("signedIn",false);return new JSONObject().put("signedIn",value.getLong("expires")>System.currentTimeMillis()).put("sessionId",value.getString("sessionId")).put("expiresAt",value.getLong("expires"));}catch(Exception e){return new JSONObject().put("signedIn",false).put("reauthenticationRequired",true);}}
    private static String serverError(HttpsURLConnection connection){try(InputStream in=connection.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)return "";byte[] bytes=new byte[1024];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>4096)return "";out.write(bytes,0,n);}String code=new JSONObject(out.toString("UTF-8")).optString("error");return code.matches("[A-Za-z_]{1,80}")?code:"";}catch(Exception ignored){return "";}}
    private static JSONObject request(String path,JSONObject body,String token)throws Exception{
        if(!java.util.Arrays.asList("/account/native/ai","/account/native/manage","/account/native/poll","/account/native/start","/account/native/token","/account/native/session","/account/native/logout","/account/native/sessions","/account/native/sessions/revoke","/account/native/passkeys/login/options","/account/native/passkeys/login/verify","/account/native/passkeys/register/options","/account/native/passkeys/register/verify").contains(path))throw new SecurityException("Account path denied");
        String endpoint=NativeTransport.origin(true);HttpsURLConnection connection=(HttpsURLConnection)new URL(endpoint+path).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(12000);connection.setReadTimeout(15000);connection.setRequestMethod(body==null?"GET":"POST");connection.setRequestProperty("X-Easybook-Native","1");connection.setRequestProperty("Content-Type","application/json");if(token!=null)connection.setRequestProperty("Authorization","Easybook-Session "+token);
        try{if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}}
            int status=connection.getResponseCode();if(status!=200&&!(path.equals("/account/native/poll")&&status==202))throw new HttpFailure(status,"challenge".equals(connection.getHeaderField("cf-mitigated")),serverError(connection));
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[2048];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>((path.equals("/account/native/manage")||path.equals("/account/native/ai"))?4194304:path.contains("/passkeys/")?65536:16384))throw new IOException("Account response too large");out.write(buffer,0,n);}return new JSONObject(out.toString("UTF-8"));}
        }catch(IOException error){if(!(error instanceof HttpFailure)||((HttpFailure)error).challenge)NativeTransport.reject(true,endpoint);throw error;}finally{connection.disconnect();}
    }
    void open(){try{if(publicStatus().optBoolean("signedIn")){browse(ORIGIN+"/account");return;}}catch(Exception ignored){}begin();}
    void begin(){begin(true);}
    void beginBrowser(){begin(false);}
    private void begin(boolean github){if(!startOperation())return;io.execute(()->{try{
        String verifier=NoteRepository.newKey(),state=NoteRepository.newKey();String challenge=android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.UTF_8)),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);
        stage("读取登录入口");JSONObject response=request("/account/native/start",new JSONObject().put("challenge",challenge).put("state",state).put("provider",github?"github":(Object)null),null);String flow=response.getString("flow"),destination=response.getString("authorization_url");Uri uri=Uri.parse(destination);
        if(!flow.matches("[a-f0-9]{64}")||!"https".equals(uri.getScheme())||!"easybook.loonxy.com".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||!(github?"/account/login":"/account/handoff").equals(uri.getPath()))throw new SecurityException("Invalid authorization destination");
        Uri handoff=github?Uri.parse(uri.getQueryParameter("return")==null?"":uri.getQueryParameter("return")):Uri.parse(uri.getPath()+"?"+uri.getEncodedQuery());if(handoff.isAbsolute()||!"/account/handoff".equals(handoff.getPath())||!flow.equals(handoff.getQueryParameter("flow"))||!state.equals(handoff.getQueryParameter("state")))throw new SecurityException("Invalid login return path");
        if(activity.isDestroyed())return;write(PENDING,new JSONObject().put("kind","browser").put("flow",flow).put("state",state).put("verifier",verifier).put("expires",System.currentTimeMillis()+480000));feedback="请在系统浏览器中完成登录，再返回 Easybook";browse(destination);
    }catch(Exception e){report(e);}finally{finishOperation();}});}
    boolean handle(Intent intent){if(intent==null||!Intent.ACTION_VIEW.equals(intent.getAction()))return false;Uri uri=intent.getData();if(uri==null||!"easybook".equals(uri.getScheme())||!"account".equals(uri.getHost())||!"/callback".equals(uri.getPath())||uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getFragment()!=null)return false;
        final boolean denied="access_denied".equals(uri.getQueryParameter("error"));
        if(uri.getQueryParameterNames().size()!=3||!uri.getQueryParameterNames().containsAll(java.util.Arrays.asList("flow",denied?"error":"code","state")))return true;
        for(String name:new String[]{"flow","state"})if(uri.getQueryParameters(name).size()!=1||uri.getQueryParameter(name)==null||!uri.getQueryParameter(name).matches("[a-f0-9]{64}"))return true;
        if(denied?uri.getQueryParameters("error").size()!=1:uri.getQueryParameters("code").size()!=1||uri.getQueryParameter("code")==null||!uri.getQueryParameter("code").matches("[a-f0-9]{64}"))return true;
        final String flow=uri.getQueryParameter("flow"),code=uri.getQueryParameter("code"),state=uri.getQueryParameter("state");
        io.execute(()->{try{JSONObject pending=read(PENDING);if(pending==null&&publicStatus().optBoolean("signedIn"))return;if(pending==null||!pending.optString("kind","browser").equals("browser")||pending.getLong("expires")<System.currentTimeMillis()||!same(flow,pending.getString("flow"))||!same(state,pending.getString("state"))){message("登录回调已过期或不匹配，请返回原登录流程");return;}
            if(denied){db.setSetting(PENDING,"");finishOperation();message("已取消浏览器登录");return;}
            stage("交换登录会话");JSONObject response=request("/account/native/token",new JSONObject().put("flow",flow).put("code",code).put("state",state).put("verifier",pending.getString("verifier")),null);
            synchronized(db){JSONObject active=read(PENDING);if(activity.isDestroyed()||active==null||!same(flow,active.getString("flow"))||!same(state,active.getString("state")))return;storeSession(response);db.setSetting(PENDING,"");}message("Easybook 账户已登录；工作区密钥保持独立");
        }catch(Exception e){report(e);}});return true;
    }
    private volatile long lastResumeCheck;
    void resume(){long now=android.os.SystemClock.elapsedRealtime();if(now-lastResumeCheck<1500||starting||io.isShutdown())return;lastResumeCheck=now;io.execute(()->{try{
        JSONObject pending=read(PENDING);if(pending==null||!pending.optString("kind").equals("browser"))return;
        if(pending.getLong("expires")<=System.currentTimeMillis()){db.setSetting(PENDING,"");message("登录流程已过期，请重新开始");return;}
        feedback="正在检查浏览器登录结果…";changed();
        JSONObject result=request("/account/native/poll",new JSONObject().put("flow",pending.getString("flow")).put("state",pending.getString("state")).put("verifier",pending.getString("verifier")),null);
        feedback=result.optString("status").equals("approved")?"浏览器已确认，请点击浏览器页面中的「返回 Easybook」完成登录":"请先在浏览器中确认登录，再返回 App";changed();
    }catch(HttpFailure e){if(e.code.equals("handoff_expired"))try{db.setSetting(PENDING,"");}catch(Exception ignored){}report(e);}catch(Exception e){report(e);}});}
    private void storeSession(JSONObject response)throws Exception{
        String token=response.getString("token"),sessionId=response.getString("session_id");long seconds=response.getLong("expires_in");if(!token.matches("[a-f0-9]{64}")||!sessionId.matches("[a-f0-9-]{36}")||seconds<=0||seconds>604800)throw new SecurityException("Invalid account session");
        write(SESSION,new JSONObject().put("token",token).put("sessionId",sessionId).put("expires",System.currentTimeMillis()+seconds*1000));
    }
    void cancel(){CancellationSignal pending=cancellation;if(pending!=null)pending.cancel();}
    void passkey(boolean register,String name){
        if(!startOperation())return;io.execute(()->{try{
            db.setSetting(PENDING,"");String verifier=NoteRepository.newKey(),state=NoteRepository.newKey();String challenge=android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.UTF_8)),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);
            JSONObject stored=register?read(SESSION):null;final String token=stored!=null&&stored.getLong("expires")>System.currentTimeMillis()?stored.getString("token"):null;
            final String kind=register?"register":"login";stage(register?"准备通行密钥注册":"准备通行密钥登录");JSONObject optionsResponse=request("/account/native/passkeys/"+kind+"/options",new JSONObject().put("challenge",challenge).put("state",state).put("name",name),token);final String flow=optionsResponse.getString("flow");final JSONObject options=optionsResponse.getJSONObject("options");
            if(!flow.matches("[a-f0-9]{64}")||!"easybook.loonxy.com".equals(register?options.getJSONObject("rp").getString("id"):options.getString("rpId")))throw new SecurityException("Invalid passkey relying party");
            if(activity.isDestroyed()){starting=false;return;}write(PENDING,new JSONObject().put("kind","passkey").put("flow",flow).put("state",state).put("verifier",verifier).put("expires",System.currentTimeMillis()+300000));
            activity.runOnUiThread(()->{if(activity.isDestroyed()){starting=false;return;}try{
                stage("等待系统凭据验证");CredentialManager manager=CredentialManager.create(activity);CancellationSignal signal=new CancellationSignal();cancellation=signal;java.util.concurrent.Executor main=command->activity.runOnUiThread(command);
                if(register)manager.createCredentialAsync(activity,new CreatePublicKeyCredentialRequest(options.toString()),signal,main,new CredentialManagerCallback<CreateCredentialResponse,CreateCredentialException>(){
                    public void onResult(CreateCredentialResponse result){if(!(result instanceof CreatePublicKeyCredentialResponse)){finishOperation();message("未获得有效通行密钥，请重新选择凭据");return;}completePasskey(kind,flow,state,verifier,((CreatePublicKeyCredentialResponse)result).getRegistrationResponseJson(),token);}
                    public void onError(CreateCredentialException error){finishOperation();message(credentialMessage(error.getType(),true));}
                });
                else manager.getCredentialAsync(activity,new GetCredentialRequest.Builder().addCredentialOption(new GetPublicKeyCredentialOption(options.toString())).build(),signal,main,new CredentialManagerCallback<GetCredentialResponse,GetCredentialException>(){
                    public void onResult(GetCredentialResponse result){Credential credential=result.getCredential();if(!(credential instanceof PublicKeyCredential)){finishOperation();message("未获得有效通行密钥，请重新选择凭据");return;}completePasskey(kind,flow,state,verifier,((PublicKeyCredential)credential).getAuthenticationResponseJson(),null);}
                    public void onError(GetCredentialException error){finishOperation();message(credentialMessage(error.getType(),false));}
                });
            }catch(Exception error){finishOperation();message("系统通行密钥服务不可用，请更新系统凭据服务或使用 GitHub 登录");}});
        }catch(Exception error){finishOperation();report(error);}});
    }
    private void completePasskey(String kind,String flow,String state,String verifier,String response,String token){if(activity.isDestroyed()||io.isShutdown()){starting=false;return;}io.execute(()->{try{
        JSONObject pending=read(PENDING);if(pending==null||!pending.optString("kind").equals("passkey")||!same(flow,pending.getString("flow"))||!same(state,pending.getString("state"))||pending.getLong("expires")<System.currentTimeMillis())return;
        stage("服务器验证通行密钥");JSONObject result=request("/account/native/passkeys/"+kind+"/verify",new JSONObject().put("flow",flow).put("state",state).put("verifier",verifier).put("response",new JSONObject(response)),token);synchronized(db){JSONObject active=read(PENDING);if(activity.isDestroyed()||active==null||!same(flow,active.getString("flow"))||!same(state,active.getString("state")))return;storeSession(result);db.setSetting(PENDING,"");}message("通行密钥验证成功，账户已登录");
    }catch(Exception error){report(error);}finally{finishOperation();}});}
    private String workspaceProof(String id)throws Exception{
        if(!id.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid workspace");
        try(android.database.Cursor cursor=db.getReadableDatabase().rawQuery("SELECT local_id FROM workspace_identity WHERE workspace_id=?",new String[]{id})){
            if(!cursor.moveToFirst()||db.setting("account-placeholder:space:"+cursor.getString(0),"").equals("1"))throw new CredentialVault.KeyUnavailable();return db.credential("space:"+cursor.getString(0));
        }
    }
    JSONObject manage(JSONObject args)throws Exception{
        String action=args.getString("action");if(action.equals("deletion")){browse(ORIGIN+"/account/delete");return new JSONObject().put("externalBrowser",true);}
        if(!java.util.Arrays.asList("history","grants","approvals","approve","cancel","revoke","revoke-workspace","deletion-preview","delete-account").contains(action))throw new SecurityException("Management action denied");
        if(action.equals("delete-account")){JSONArray choices=args.getJSONArray("choices");for(int i=0;i<choices.length();i++){JSONObject choice=choices.getJSONObject(i);if(choice.optString("action").equals("keep"))choice.put("key",workspaceProof(choice.getString("id")));}}
        JSONObject result=request("/account/native/manage",args,token(db));
        if(action.equals("deletion-preview")){JSONArray personal=result.getJSONArray("personal");for(int i=0;i<personal.length();i++){JSONObject w=personal.getJSONObject(i);boolean available=false;try{workspaceProof(w.getString("id"));available=true;}catch(Exception ignored){}w.put("canProveKey",available);}}
        if(action.equals("delete-account")){db.setSetting(SESSION,"");db.setSetting(PENDING,"");changed();}
        return result;
    }
    JSONObject ai(JSONObject args)throws Exception{
        String action=args.getString("action");if(!java.util.Arrays.asList("config","credential","chat").contains(action))throw new SecurityException("AI action denied");
        if(action.equals("credential")&&!java.util.Arrays.asList("PUT","DELETE").contains(args.optString("method")))throw new SecurityException("AI credential method denied");
        if(args.has("workspace")&&!args.optString("workspace").matches("[a-f0-9]{64}"))throw new SecurityException("Invalid workspace");
        return request("/account/native/ai",args,token(db));
    }
    JSONObject devices()throws Exception{JSONObject saved=read(SESSION);if(saved==null)throw new CredentialVault.KeyUnavailable();try{return request("/account/native/sessions",null,saved.getString("token"));}catch(HttpFailure error){if(error.status==401)db.setSetting(SESSION,"");throw error;}}
    JSONObject revokeDevice(String id)throws Exception{if(id==null||!id.matches("[a-f0-9-]{36}"))throw new SecurityException("Invalid device");JSONObject saved=read(SESSION);if(saved==null)throw new CredentialVault.KeyUnavailable();JSONObject result=request("/account/native/sessions/revoke",new JSONObject().put("id",id),saved.getString("token"));if(result.optBoolean("current"))db.setSetting(SESSION,"");return result;}
    private void retryLogout(){try{for(;;){
        String token;synchronized(db){JSONObject queued=read(LOGOUT);if(queued==null||queued.getJSONArray("sessions").length()==0)return;token=queued.getJSONArray("sessions").getJSONObject(0).getString("token");}
        try{request("/account/native/logout",new JSONObject(),token);}catch(HttpFailure e){if(e.status!=401)throw e;}
        synchronized(db){JSONObject queued=read(LOGOUT);if(queued==null)continue;JSONArray sessions=queued.getJSONArray("sessions");for(int i=sessions.length()-1;i>=0;i--)if(same(token,sessions.getJSONObject(i).getString("token")))sessions.remove(i);if(sessions.length()==0)db.setSetting(LOGOUT,"");else write(LOGOUT,queued);}
    }}catch(Exception ignored){}}
    void signOut(){cancel();io.execute(()->{try{
        synchronized(db){db.setSetting(PENDING,"");JSONObject value=read(SESSION);
            if(value!=null){JSONObject queued=read(LOGOUT);if(queued==null)queued=new JSONObject().put("sessions",new JSONArray());queued.getJSONArray("sessions").put(value);write(LOGOUT,queued);}
            db.setSetting(SESSION,"");}
        finishOperation();message("此设备账户已退出；服务器会话撤销正在后台重试");revocations.execute(this::retryLogout);
    }catch(Exception e){finishOperation();message("本机会话清理未完成，请重试");}});}
    private static boolean same(String a,String b){return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}
    private void browse(String url){activity.runOnUiThread(()->{if(activity.isDestroyed())return;try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));}catch(ActivityNotFoundException e){message("未找到可用的系统浏览器");}});}
    static String credentialMessage(String type,boolean register){
        if(type.contains("CANCELLATION")||type.contains("USER_CANCELED"))return "已取消通行密钥验证，可以重新选择登录方式";
        if(type.contains("NO_CREDENTIAL"))return "没有可用的通行密钥，请确认已启用保存该密钥的密码管理器；旧域名密钥请使用浏览器登录并重新添加";
        if(type.contains("SECURITY_ERROR"))return "应用与网站的通行密钥关联验证未通过，请更新 Easybook 后重试，或使用浏览器登录";
        if(type.contains("UNSUPPORTED")||type.contains("PROVIDER_CONFIGURATION"))return "当前设备未提供通行密钥服务，请更新凭据管理器或使用 GitHub 登录";
        if(type.contains("INTERRUPTED"))return "系统验证被中断，请重试";
        if(type.contains("INVALID_STATE"))return "此通行密钥已存在，请使用登录或选择其他凭据";
        return register?"系统无法创建通行密钥，请检查密码管理器后重试":"系统无法读取通行密钥，请检查密码管理器后重试";
    }
    static String failureMessage(Exception error){
        if(error instanceof HttpFailure){HttpFailure e=(HttpFailure)error;
            if(e.code.equalsIgnoreCase("reauthentication_required"))return "请先使用通行密钥重新验证身份，再执行此操作";
            if(e.code.equals("KEY_PROOF_REQUIRED"))return "本机保存的同步密钥不是当前有效密钥，请重新连接工作区后重试";
            if(e.code.equals("MANAGER_TRANSFER_REQUIRED"))return "请先转移所有共享工作区的管理权";
            if(e.code.equals("CONFLICT"))return "目标或工作区状态已变化，请刷新后重新确认";
            if(e.challenge)return "账户请求被网络安全验证拦截，请稍后重试";
            if(e.status==401)return "账户会话已失效，请重新登录";
            if(e.status==403)return "服务器未允许此账户操作，请重新验证身份";
            if(e.status==409)return "凭据或账户状态已改变，请重新验证";
            if(e.status==429)return "请求过于频繁，请稍后重试";
            if(e.status>=500||e.status==404)return "账户服务暂不可用，请稍后重试";
            return "服务器验证失败，登录请求可能已过期，请重新开始";
        }
        if(error instanceof java.net.SocketTimeoutException)return "账户连接超时（NETWORK_TIMEOUT），请重试或使用浏览器入口";
        if(error instanceof javax.net.ssl.SSLException)return "账户安全连接失败（TLS），请检查系统时间和网络";
        if(error instanceof IOException)return "账户接口连接失败（NETWORK），请检查网络或使用浏览器入口";
        if(error instanceof CredentialVault.KeyUnavailable)return "无法读取安全凭据，请重新登录";
        return "账户验证未完成，请重新开始";
    }
    private void message(String text){feedback=text;activity.runOnUiThread(()->{if(!activity.isDestroyed()){Toast.makeText(activity,text,Toast.LENGTH_LONG).show();if(activity instanceof MainActivity)((MainActivity)activity).accountChanged();}});}
}



