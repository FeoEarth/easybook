package com.feoearth.easybook;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.widget.Toast;
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
    static final String LEGACY="https://easybook-mcp-oauth.1902521952.workers.dev/account";
    private static final String SESSION="account-session-v1",PENDING="account-login-pending-v1";
    private final Activity activity;private final NoteRepository db;private final ExecutorService io;
    private volatile boolean starting;
    static final class HttpFailure extends IOException {final int status;HttpFailure(int value){super("Account HTTP "+value);status=value;}}
    NativeAccount(Activity activity,NoteRepository db,ExecutorService io){this.activity=activity;this.db=db;this.io=io;}
    private JSONObject read(String name)throws Exception{String value=db.setting(name,"");return value.isEmpty()?null:new JSONObject(db.vault.open(value,name));}
    private void write(String name,JSONObject value)throws Exception{String sealed=db.vault.seal(value.toString(),name);if(!value.toString().equals(db.vault.open(sealed,name)))throw new SecurityException("Account persistence verification failed");db.setSetting(name,sealed);}
    JSONObject publicStatus()throws Exception{try{JSONObject value=read(SESSION);if(value==null)return new JSONObject().put("signedIn",false);return new JSONObject().put("signedIn",value.getLong("expires")>System.currentTimeMillis()).put("sessionId",value.getString("sessionId")).put("expiresAt",value.getLong("expires"));}catch(Exception e){return new JSONObject().put("signedIn",false).put("reauthenticationRequired",true);}}
    private static JSONObject request(String path,JSONObject body,String token)throws Exception{
        if(!java.util.Arrays.asList("/account/native/start","/account/native/token","/account/native/session","/account/native/logout").contains(path))throw new SecurityException("Account path denied");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(ORIGIN+path).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(12000);connection.setReadTimeout(15000);connection.setRequestMethod(body==null?"GET":"POST");connection.setRequestProperty("X-Easybook-Native","1");connection.setRequestProperty("Content-Type","application/json");if(token!=null)connection.setRequestProperty("Authorization","Easybook-Session "+token);
        try{if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}}
            int status=connection.getResponseCode();if(status!=200)throw new HttpFailure(status);
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[2048];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>16384)throw new IOException("Account response too large");out.write(buffer,0,n);}return new JSONObject(out.toString("UTF-8"));}
        }finally{connection.disconnect();}
    }
    void open(){try{if(publicStatus().optBoolean("signedIn")){browse(ORIGIN+"/account");return;}}catch(Exception ignored){}begin();}
    void begin(){if(starting)return;starting=true;io.execute(()->{try{
        String verifier=NoteRepository.newKey(),state=NoteRepository.newKey();String challenge=android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.UTF_8)),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING);
        JSONObject response=request("/account/native/start",new JSONObject().put("challenge",challenge).put("state",state),null);String flow=response.getString("flow"),destination=response.getString("authorization_url");Uri uri=Uri.parse(destination);
        if(!flow.matches("[a-f0-9]{64}")||!"https".equals(uri.getScheme())||!"easybook.loonxy.com".equals(uri.getHost())||uri.getPort()!=-1||uri.getUserInfo()!=null||!"/account/handoff".equals(uri.getPath())||!flow.equals(uri.getQueryParameter("flow"))||!state.equals(uri.getQueryParameter("state")))throw new SecurityException("Invalid authorization destination");
        write(PENDING,new JSONObject().put("flow",flow).put("state",state).put("verifier",verifier).put("expires",System.currentTimeMillis()+300000));browse(destination);
    }catch(HttpFailure e){if(e.status==404)browse(LEGACY);else message("账户登录暂不可用，请稍后重试");}
    catch(Exception e){message("登录未开始，请检查网络后重试");}finally{starting=false;}});}
    boolean handle(Intent intent){if(intent==null||!Intent.ACTION_VIEW.equals(intent.getAction()))return false;Uri uri=intent.getData();if(uri==null||!"easybook".equals(uri.getScheme())||!"account".equals(uri.getHost())||!"/callback".equals(uri.getPath())||uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getFragment()!=null)return false;
        if(uri.getQueryParameterNames().size()!=3||!uri.getQueryParameterNames().containsAll(java.util.Arrays.asList("flow","code","state")))return true;
        for(String name:new String[]{"flow","code","state"})if(uri.getQueryParameters(name).size()!=1||uri.getQueryParameter(name)==null||!uri.getQueryParameter(name).matches("[a-f0-9]{64}"))return true;
        final String flow=uri.getQueryParameter("flow"),code=uri.getQueryParameter("code"),state=uri.getQueryParameter("state");
        io.execute(()->{try{JSONObject pending=read(PENDING);if(pending==null||pending.getLong("expires")<System.currentTimeMillis()||!same(flow,pending.getString("flow"))||!same(state,pending.getString("state"))){message("登录回调已过期或不匹配，请返回原登录流程");return;}
            JSONObject response=request("/account/native/token",new JSONObject().put("flow",flow).put("code",code).put("state",state).put("verifier",pending.getString("verifier")),null);
            String token=response.getString("token"),sessionId=response.getString("session_id");long seconds=response.getLong("expires_in");if(!token.matches("[a-f0-9]{64}")||!sessionId.matches("[a-f0-9-]{36}")||seconds<=0||seconds>604800)throw new SecurityException("Invalid account session");
            write(SESSION,new JSONObject().put("token",token).put("sessionId",sessionId).put("expires",System.currentTimeMillis()+seconds*1000));db.setSetting(PENDING,"");message("Easybook 账户已登录；工作区密钥保持独立");
        }catch(Exception e){message("登录未完成或已过期，请重新开始");}});return true;
    }
    void signOut(){io.execute(()->{try{JSONObject value=read(SESSION);if(value==null)return;request("/account/native/logout",new JSONObject(),value.getString("token"));db.setSetting(SESSION,"");db.setSetting(PENDING,"");message("此设备账户已退出；独立同步密钥仍可使用");}catch(Exception e){message("未能撤销此设备会话，请联网后重试");}});}
    private static boolean same(String a,String b){return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8));}
    private void browse(String url){activity.runOnUiThread(()->{if(activity.isDestroyed())return;try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));}catch(ActivityNotFoundException e){message("未找到可用的系统浏览器");}});}
    private void message(String text){activity.runOnUiThread(()->{if(!activity.isDestroyed())Toast.makeText(activity,text,Toast.LENGTH_LONG).show();});}
}
