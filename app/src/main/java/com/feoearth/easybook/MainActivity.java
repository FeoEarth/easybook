package com.feoearth.easybook;

import android.app.Activity;
import android.content.*;
import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.view.*;
import org.json.JSONObject;
import org.json.JSONArray;
import androidx.webkit.*;
import java.util.Collections;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
    private WebView web;
    private android.widget.FrameLayout safeArea;
    private boolean ready;
    private volatile boolean destroyed;
    private volatile long documentGeneration;
    private NoteRepository repository;
    private SecurityManager security;
    private static final ExecutorService syncIo=Executors.newSingleThreadExecutor();
    private String pendingExport;
    private String attachmentSpace,attachmentNote,attachmentExportName;private long attachmentGeneration;private byte[] attachmentExport;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final String LOCAL = "https://appassets.androidplatform.net/index.html";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        repository=NoteRepository.get(this);
        security=new SecurityManager(this,repository,io);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = dark ? 0xff000000 : 0xfff2f2f7;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        web = new WebView(this); web.setBackgroundColor(color);
        web.setTag("notes-webview");web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        // Insets belong to the container: WebView padding does not reliably constrain
        // CSS position:fixed controls to the Android safe area.
        safeArea = new android.widget.FrameLayout(this);
        safeArea.setBackgroundColor(color);
        safeArea.addView(web, new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (android.os.Build.VERSION.SDK_INT >= 30) safeArea.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            web.evaluateJavascript("window.setKeyboardVisible && window.setKeyboardVisible(" + insets.isVisible(WindowInsets.Type.ime()) + ")", null);
            return WindowInsets.CONSUMED;
        });
        setContentView(safeArea);
        safeArea.requestApplyInsets();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setSupportMultipleWindows(false);s.setSaveFormData(false);
        android.webkit.CookieManager.getInstance().setAcceptCookie(false);android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            android.widget.TextView message=new android.widget.TextView(this);
            message.setText("请先更新 Android System WebView，再打开 Easybook。旧笔记不会被删除。");message.setPadding(30,100,30,30);setContentView(message);return;
        }
        WebViewCompat.addWebMessageListener(web,"EasybookNative",Collections.singleton("https://appassets.androidplatform.net"),(view,message,origin,isMainFrame,reply)->{
            if(!isMainFrame||!("https".equals(origin.getScheme())&&"appassets.androidplatform.net".equals(origin.getHost())&&(origin.getPort()==-1||origin.getPort()==443))||!LOCAL.equals(web.getUrl()))return;
            String text=message.getData();
            if(text==null||text.length()>16*1024*1024)return;
            try{JSONObject envelope=new JSONObject(text);String requestId=envelope.getString("id"),method=envelope.getString("method");JSONObject args=envelope.optJSONObject("args");if(args==null)args=new JSONObject();final JSONObject input=args;final long generation=documentGeneration;
                if(!requestId.matches("[a-zA-Z0-9-]{1,80}"))return;
                Runnable operation=()->{try{if(destroyed||generation!=documentGeneration)throw new SecurityException();security.authorize(method,input,generation);JSONObject output=dispatch(method,input,generation);respond(reply,generation,new JSONObject().put("id",requestId).put("ok",true).put("result",output));}catch(Exception e){try{respond(reply,generation,new JSONObject().put("id",requestId).put("ok",false).put("error","操作未完成，数据已保留；可重试或导出备份").put("code",e instanceof CredentialVault.KeyUnavailable?"CREDENTIAL_UNAVAILABLE":"OPERATION_FAILED"));}catch(Exception ignored){}}};
                if(method.equals("sync")||method.equals("attachment.get"))syncIo.execute(operation);else io.execute(operation);
            }catch(Exception ignored){}
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("https://appassets.androidplatform.net/editor.js".equals(u.toString())) {try{return new WebResourceResponse("application/javascript","UTF-8",new ByteArrayInputStream(readAsset("editor.js").getBytes(StandardCharsets.UTF_8)));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}}
                if (LOCAL.equals(u.toString())) {
                    try {
                        boolean legacy=false;
                        String html=readAsset("index.html");if(!legacy)html=html.replace("connect-src https://easybook-sync.1902521952.workers.dev","connect-src 'none'");
                        html=html.replace("<script>","<script>"+(legacy?"window.EasybookRollbackMode=true;":"")+readAsset("native-api.js")+"</script><script>");
                        return new WebResourceResponse("text/html","UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }
                    catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
                }


                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return !r.isForMainFrame() || !LOCAL.equals(r.getUrl().toString()); }
            @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){ready=false;documentGeneration++;}
        });
        web.loadUrl(LOCAL);
    }
    private String readAsset(String name)throws IOException {try(InputStream in=getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private void respond(JavaScriptReplyProxy reply,long generation,JSONObject value){runOnUiThread(()->{if(!destroyed&&generation==documentGeneration&&LOCAL.equals(web.getUrl()))try{reply.postMessage(value.toString());}catch(IllegalStateException ignored){}});}
    private String bounded(JSONObject args,String name,int max)throws Exception{if(!(args.get(name) instanceof String))throw new IllegalArgumentException();String s=args.getString(name);if(s.length()>max)throw new IllegalArgumentException("Value too large");return s;}
    private JSONObject dispatch(String method,JSONObject args,long generation)throws Exception {
        String active=(method.equals("commit")||method.equals("search")||method.equals("snapshot")||method.equals("sync")||method.equals("device.exportNotes"))?repository.activeSpace():"";
        switch(method){
            case "bootstrap":{
                repository.secureCredentials();JSONObject report=new JSONObject().put("state","not-needed");repository.secureCredentials();security.initialized(generation);return repository.snapshot(repository.activeSpace()).put("migration",report).put("security",repository.securityStatus());
            }
            case "commit":{String k=args.getString("key");if(!k.equals(active))throw new IllegalStateException("Workspace changed");return repository.commit(k,args.getJSONObject("changes"));}
            case "search":{if(!args.getString("key").equals(active))throw new IllegalStateException("Workspace changed");return new JSONObject().put("notes",repository.search(active,bounded(args,"query",2000),bounded(args,"category",80),args.optBoolean("everywhere")));}
            case "snapshot":return repository.snapshot(active);
            case "sync":{if(!repository.securityStatus().getBoolean("paired"))throw new CredentialVault.KeyUnavailable();String k=args.getString("key");if(!k.equals(active))throw new IllegalStateException("Workspace changed");return new NativeSync(repository,new NativeSync.HttpsTransport(new DataProtection.Plaintext())).run(k);}
            case "attachment.pick":{String space=repository.activeSpace(),noteId=bounded(args,"noteId",36);if(repository.row(space,"note",noteId)==null)throw new SecurityException();runOnUiThread(()->{if(destroyed||generation!=documentGeneration)return;attachmentSpace=space;attachmentNote=noteId;attachmentGeneration=generation;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");startActivityForResult(i,83);});return new JSONObject().put("picker",true);}
            case "attachment.get":{String space=repository.activeSpace(),id=bounded(args,"id",64);requireAttachmentReference(space,id);return repository.attachments.get(space,id);}
            case "attachment.restore":{String space=repository.activeSpace();JSONArray files=args.getJSONArray("files");if(files.length()>100)throw new IllegalArgumentException();for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);repository.attachments.accept(space,f.getString("id"),f);repository.saveAttachment(space,new JSONObject(f.toString()).put("data",JSONObject.NULL).put("dirty",true));}return new JSONObject().put("restored",files.length());}
            case "attachment.export":{String space=repository.activeSpace(),id=bounded(args,"id",64);requireAttachmentReference(space,id);JSONObject f=repository.attachments.get(space,id);byte[] bytes=android.util.Base64.decode(f.getString("data"),android.util.Base64.NO_WRAP);runOnUiThread(()->{if(destroyed||generation!=documentGeneration)return;attachmentExport=bytes;attachmentExportName=AttachmentStore.cleanName(f.optString("name","附件"));Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,attachmentExportName);startActivityForResult(i,84);});return new JSONObject().put("picker",true);}
            case "security.pair":security.pairing(()->{if(!destroyed&&generation==documentGeneration)web.reload();});return new JSONObject().put("nativeDialog",true);
            case "security.status":return repository.securityStatus();
            case "migration.cleaned":if(!repository.setting("rendererCredentials","").equals("cleared")){repository.scrubDeletedPages();repository.setSetting("rendererCredentials","cleared");}return new JSONObject().put("verified",true);
            case "migration.retry":return repository.secureCredentials();
            case "migration.status":return new JSONObject().put("reports",repository.migrationReports()).put("security",repository.securityStatus()).put("rendererCredentials",repository.setting("rendererCredentials","pending"));
            case "migration.rollback":repository.rollbackSecurity();return new JSONObject().put("verified",true).put("mode","native-encrypted");
            case "ui.ready":runOnUiThread(()->{if(!destroyed&&generation==documentGeneration){ready=true;receiveShare(getIntent());}});return new JSONObject();
            case "device.theme":{String mode=bounded(args,"value",10);if(!mode.matches("auto|light|dark"))throw new IllegalArgumentException();new DeviceActions().theme(mode);break;}
            case "device.haptic":runOnUiThread(()->web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP));break;
            case "device.copy":new DeviceActions().copy(bounded(args,"value",100000));break;
            case "device.share":new DeviceActions().share(bounded(args,"title",200),bounded(args,"text",60500));break;
            case "device.exportNotes":{JSONObject snapshot=repository.snapshot(active);JSONArray files=new JSONArray(),metas=repository.rows(active,"attachment");for(int i=0;i<metas.length();i++)files.put(repository.attachments.payload(active,metas.getJSONObject(i).getString("id")));new DeviceActions().exportNotes(new JSONObject().put("format","easybook-json-v1").put("notes",snapshot.getJSONArray("notes")).put("folders",snapshot.getJSONArray("folders")).put("attachments",files).toString());break;}
            case "device.importNotes":new DeviceActions().importNotes();break;
            default:throw new IllegalArgumentException("Unknown method");
        }
        return new JSONObject();
    }
    private void requireAttachmentReference(String space,String id)throws Exception{AttachmentStore.validId(id);JSONArray notes=repository.rows(space,"note");for(int i=0;i<notes.length();i++)if(DocumentModel.assets(notes.getJSONObject(i).getJSONObject("document")).contains(id))return;throw new SecurityException("Unreferenced attachment");}
    public class DeviceActions {
        public void theme(String value) { runOnUiThread(() -> {
            boolean dark = "dark".equals(value) || (!"light".equals(value) && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
            int color = dark ? 0xff000000 : 0xfff2f2f7;
            web.setBackgroundColor(color); safeArea.setBackgroundColor(color); getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(color);
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }); }
        public void copy(String value) { runOnUiThread(() -> {
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Easybook", value));
        }); }
        public void haptic() { runOnUiThread(() -> web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)); }
        public void share(String title, String text) { runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_SEND); i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT,title); i.putExtra(Intent.EXTRA_TEXT,text);
            startActivity(Intent.createChooser(i,"分享笔记"));
        }); }
        public void exportNotes(String value) { runOnUiThread(() -> {
            if (value.length() > 50000000) { notifyJs("备份过大，请分批整理"); return; }
            pendingExport = value;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json"); i.putExtra(Intent.EXTRA_TITLE,"Easybook-backup.json");
            startActivityForResult(i, 81);
        }); }
        public void importNotes() { runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
            startActivityForResult(i, 82);
        }); }
    }
    private void notifyJs(String text) { web.evaluateJavascript("window.showNativeMessage && window.showNativeMessage("+JSONObject.quote(text)+")",null); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 81 && (result != RESULT_OK || data == null)) {pendingExport = null; return;}
        if(request==84&&(result!=RESULT_OK||data==null)){attachmentExport=null;return;}
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if(request==83){final String space=attachmentSpace,noteId=attachmentNote;final long generation=attachmentGeneration;attachmentSpace=null;attachmentNote=null;if(space==null)return;io.execute(()->{try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException();String name="附件";try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}JSONObject meta=repository.attachments.save(space,name,getContentResolver().getType(uri),AttachmentStore.read(in),true);runOnUiThread(()->{if(!destroyed&&generation==documentGeneration)web.evaluateJavascript("window.receiveAttachment("+JSONObject.quote(space)+","+JSONObject.quote(noteId)+","+meta.toString()+")",null);});}catch(Exception e){runOnUiThread(()->notifyJs("附件未添加：请选择不超过 5 MB 的文件并重试"));}});return;}
        if(request==84){final byte[] bytes=attachmentExport;attachmentExport=null;if(bytes==null)return;io.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException();out.write(bytes);runOnUiThread(()->notifyJs("附件已保存"));}catch(Exception e){runOnUiThread(()->notifyJs("附件保存失败，可重试"));}});return;}
        if (request == 81 && pendingExport != null) {
            final String value = pendingExport; pendingExport = null;
            io.execute(() -> { try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException(); out.write(value.getBytes(StandardCharsets.UTF_8));
                runOnUiThread(() -> notifyJs("备份已保存"));
            } catch (IOException e) {runOnUiThread(() -> notifyJs("备份保存失败，请重试"));} });
        } else if (request == 82) io.execute(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (in == null) throw new IOException(); byte[] buf = new byte[8192]; int n;
                while ((n=in.read(buf))!=-1) { if (out.size()+n>50000000) throw new IOException(); out.write(buf,0,n); }
                String text = out.toString("UTF-8");
                runOnUiThread(() -> web.evaluateJavascript("window.importBackupText("+JSONObject.quote(text)+")",null));
            } catch (IOException e) {runOnUiThread(() -> notifyJs("无法读取文件或备份超过 50 MB"));}
        });
    }
    private void receiveShare(Intent i) {
        if (ready && Intent.ACTION_SEND.equals(i.getAction()) && "text/plain".equals(i.getType())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) web.evaluateJavascript("window.receiveSharedText(" + JSONObject.quote(text) + ")", null);
            i.setAction(Intent.ACTION_MAIN);
        }
    }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); receiveShare(i); }
    @Override public void onBackPressed() {
        if (!ready) {super.onBackPressed(); return;}
        web.evaluateJavascript("window.handleBack()", handled -> {if (!"true".equals(handled)) MainActivity.super.onBackPressed();});
    }
    @Override protected void onPause() { web.evaluateJavascript("window.persistNow && window.persistNow()", null); super.onPause(); }
    @Override protected void onDestroy() { ready=false; destroyed=true;if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))WebViewCompat.removeWebMessageListener(web,"EasybookNative");web.destroy();io.shutdown();super.onDestroy(); }
}

