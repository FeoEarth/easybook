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
import java.util.Map;
import java.util.HashMap;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
    private WebView web;
    public com.feoearth.easybook.glass.NativeGlassMenu nativeGlass;
    private long glassGeneration=-1;
    private android.widget.FrameLayout safeArea;
    private android.net.ConnectivityManager connectivity;
    private android.net.ConnectivityManager.NetworkCallback networkCallback;
    private String networkSignature="";
    private boolean ready;
    private volatile boolean destroyed;
    private volatile long documentGeneration;
    private NoteRepository repository;
    private SecurityManager security;
    private NativeAccount nativeAccount;
    private AppUpdateManager appUpdater;
    private static final ExecutorService syncIo=Executors.newSingleThreadExecutor();
    private String pendingExport;
    private String attachmentSpace,attachmentNote,attachmentExportName;private long attachmentGeneration;private File attachmentExport;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private static String operationErrorCode(Exception e){
        if(e instanceof CredentialVault.KeyUnavailable)return "CREDENTIAL_UNAVAILABLE";
        if(e instanceof android.database.sqlite.SQLiteFullException)return "STORAGE_FULL";
        if(e instanceof android.database.sqlite.SQLiteDatabaseLockedException)return "STORAGE_BUSY";
        if(e instanceof android.database.sqlite.SQLiteReadOnlyDatabaseException)return "STORAGE_READ_ONLY";
        return "OPERATION_FAILED";
    }
    private static String operationErrorMessage(Exception e){
        if(e instanceof NativeAccount.HttpFailure)return NativeAccount.failureMessage(e);
        switch(operationErrorCode(e)){
            case "STORAGE_FULL":return "本机存储空间不足，请释放空间后重试";
            case "STORAGE_BUSY":return "本机数据库暂时被占用，请稍后重试";
            case "STORAGE_READ_ONLY":return "本机数据库当前只读，无法保存移动操作";
            default:return "操作未完成，数据已保留；可重试或导出备份";
        }
    }
    void accountChanged(){runOnUiThread(()->{if(!destroyed&&ready&&web!=null&&LOCAL.equals(web.getUrl()))web.evaluateJavascript("window.easybookAccountChanged&&window.easybookAccountChanged()",null);});}
    private static final String LOCAL = "https://appassets.androidplatform.net/index.html";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        repository=NoteRepository.get(this);SyncPolicy.initialize(this);
        nativeAccount=new NativeAccount(this,repository,io);nativeAccount.handle(getIntent());
        security=new SecurityManager(this,repository,io);
        appUpdater=new AppUpdateManager(this,event->runOnUiThread(()->{
            if(!destroyed&&ready&&web!=null&&LOCAL.equals(web.getUrl()))
                web.evaluateJavascript("window.easybookUpdateProgress&&window.easybookUpdateProgress("+event.toString()+")",null);
        }));
        connectivity=(android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        networkCallback=new android.net.ConnectivityManager.NetworkCallback(){
            private void changed(android.net.NetworkCapabilities c){String signature=c==null?"offline":c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)+":"+c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)+":"+c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED);runOnUiThread(()->{if(signature.equals(networkSignature))return;networkSignature=signature;if(ready&&!destroyed&&web!=null&&LOCAL.equals(web.getUrl()))web.evaluateJavascript("window.easybookNetworkChanged&&window.easybookNetworkChanged()",null);});}
            @Override public void onCapabilitiesChanged(android.net.Network n,android.net.NetworkCapabilities c){changed(c);}
            @Override public void onLost(android.net.Network n){changed(null);}
        };connectivity.registerDefaultNetworkCallback(networkCallback);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if(security!=null)security.setDark(dark);
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
        if(BuildConfig.NATIVE_GLASS_PROTOTYPE && android.os.Build.VERSION.SDK_INT>=33){
            nativeGlass=new com.feoearth.easybook.glass.NativeGlassMenu(this,safeArea,web,()->!destroyed && ready && glassGeneration==documentGeneration && LOCAL.equals(web.getUrl()));
            web.setLayerType(View.LAYER_TYPE_HARDWARE,null);
            web.setOnScrollChangeListener((v,x,y,oldX,oldY)->nativeGlass.refreshBackdrop());
            nativeGlass.backdrop.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));
            safeArea.addView(nativeGlass.backdrop,new android.widget.FrameLayout.LayoutParams(-1,-1));
            safeArea.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{if(nativeGlass!=null && (r-l!=or-ol||b-t!=ob-ot))nativeGlass.onBoundsChanged();});
        }else safeArea.addView(web, new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (android.os.Build.VERSION.SDK_INT >= 30) safeArea.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
            if(nativeGlass!=null && (v.getPaddingLeft()!=bars.left || v.getPaddingTop()!=bars.top || v.getPaddingRight()!=bars.right || v.getPaddingBottom()!=Math.max(bars.bottom,ime.bottom)))nativeGlass.onBoundsChanged();
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            web.evaluateJavascript("window.setKeyboardVisible && window.setKeyboardVisible(" + insets.isVisible(WindowInsets.Type.ime()) + ")", null);
            return WindowInsets.CONSUMED;
        });
        setContentView(safeArea);
        safeArea.requestApplyInsets();
        WebSettings s = web.getSettings();
        web.setWebChromeClient(new WebChromeClient(){
            @Override public android.graphics.Bitmap getDefaultVideoPoster(){return android.graphics.Bitmap.createBitmap(1,1,android.graphics.Bitmap.Config.ARGB_8888);}
            @Override public void onShowCustomView(View view,CustomViewCallback callback){
                if(videoFullscreen!=null||!LOCAL.equals(web.getUrl())){callback.onCustomViewHidden();return;}
                videoFullscreen=view;videoFullscreenCallback=callback;videoSystemUi=getWindow().getDecorView().getSystemUiVisibility();videoOrientation=getRequestedOrientation();
                videoFullscreen.setBackgroundColor(android.graphics.Color.BLACK);
                ((ViewGroup)getWindow().getDecorView()).addView(view,new android.widget.FrameLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT,android.view.ViewGroup.LayoutParams.MATCH_PARENT));
                getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
                setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }
            @Override public void onHideCustomView(){hideVideoFullscreen();}
            @Override public boolean onConsoleMessage(ConsoleMessage message){
                if(message.messageLevel()==ConsoleMessage.MessageLevel.ERROR)android.util.Log.e("NativeGlassProbe",message.message()+" at "+message.lineNumber());
                return false;
            }
        });
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
                Runnable operation=()->{try{if(destroyed||generation!=documentGeneration)throw new SecurityException();security.authorize(method,input,generation);JSONObject output=dispatch(method,input,generation);respond(reply,generation,new JSONObject().put("id",requestId).put("ok",true).put("result",output));}catch(Exception e){try{respond(reply,generation,new JSONObject().put("id",requestId).put("ok",false).put("error",operationErrorMessage(e)).put("code",operationErrorCode(e)));}catch(Exception ignored){}}};
                if(method.equals("sync")||method.equals("attachment.get")||method.equals("attachment.open")||method.equals("attachment.share")||method.equals("attachment.export"))syncIo.execute(operation);else io.execute(operation);
            }catch(Exception ignored){}
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("https://appassets.androidplatform.net/editor.js".equals(u.toString())) {try{return new WebResourceResponse("application/javascript","UTF-8",new ByteArrayInputStream(readAsset("editor.js").getBytes(StandardCharsets.UTF_8)));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}}
                if("https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&u.getPath()!=null&&u.getPath().matches("/attachment/[a-f0-9]{64}")){
                    try{
                        String id=u.getLastPathSegment(),space=repository.activeSpace();requireAttachmentReference(space,id);
                        JSONObject meta=repository.row(space,"attachment",id);if(meta==null)throw new IOException();
                        String mime=meta.optString("mime","application/octet-stream");
                        if(mime.equals("application/octet-stream")){String name=meta.optString("name","").toLowerCase(java.util.Locale.ROOT);if(name.endsWith(".mp4")||name.endsWith(".m4v"))mime="video/mp4";else if(name.endsWith(".mov"))mime="video/quicktime";else if(name.endsWith(".webm"))mime="video/webm";}
                        if(!mime.matches("image/(png|jpeg|gif|webp)|application/pdf|text/plain|(audio|video)/[a-zA-Z0-9.+-]+"))mime="application/octet-stream";
                        File original=repository.attachments.file(space,id);if(!original.isFile())throw new IOException();if("1".equals(u.getQueryParameter("poster"))){if(!mime.startsWith("video/"))throw new IOException();return VideoPoster.response(MainActivity.this,original,space,id);}long length=original.length();
                        String range=null;for(Map.Entry<String,String> header:r.getRequestHeaders().entrySet())if(header.getKey().equalsIgnoreCase("Range"))range=header.getValue();
                        AttachmentRange bytes;try{bytes=AttachmentRange.parse(range,length);}catch(IOException invalid){Map<String,String> headers=new HashMap<>();headers.put("Content-Range","bytes */"+length);headers.put("Content-Length","0");headers.put("Cache-Control","no-store");return new WebResourceResponse("text/plain","UTF-8",416,"Range Not Satisfiable",headers,new ByteArrayInputStream(new byte[0]));}
                        // WebView seeks from byte zero itself. Keep the prefix available for
                        // that seek, then stop at the absolute requested end (not count).
                        InputStream stream=new FilterInputStream(new FileInputStream(original)){long remaining=bytes.end+1;
                            @Override public int read()throws IOException{if(remaining==0)return -1;int v=in.read();if(v>=0)remaining--;return v;}
                            @Override public int read(byte[] b,int off,int len)throws IOException{if(len==0)return 0;if(remaining==0)return -1;int n=in.read(b,off,(int)Math.min(len,remaining));if(n>0)remaining-=n;return n;}
                            @Override public long skip(long n)throws IOException{long skipped=in.skip(Math.min(Math.max(0,n),remaining));remaining-=skipped;return skipped;}
                            @Override public int available()throws IOException{return (int)Math.min(remaining,in.available());}
                        };
                        Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Accept-Ranges","bytes");headers.put("Content-Length",Long.toString(bytes.count));headers.put("X-Content-Type-Options","nosniff");if(bytes.partial)headers.put("Content-Range","bytes "+bytes.start+"-"+bytes.end+"/"+length);
                        return new WebResourceResponse(mime,null,bytes.partial?206:200,bytes.partial?"Partial Content":"OK",headers,stream);
                    }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
                }
                if("https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&u.getPath()!=null&&u.getPath().startsWith("/pdf/")&&!u.getPath().contains("..")&&u.getPath().matches("/pdf/[A-Za-z0-9_./-]+")){
                    String asset=u.getPath().substring(1),mime=asset.endsWith(".mjs")||asset.endsWith(".js")?"application/javascript":asset.endsWith(".css")?"text/css":asset.endsWith(".md")||asset.endsWith(".txt")?"text/plain":asset.endsWith(".wasm")?"application/wasm":asset.endsWith(".json")?"application/json":asset.endsWith(".svg")?"image/svg+xml":asset.endsWith(".ttf")?"font/ttf":"application/octet-stream";
                    try{return new WebResourceResponse(mime,null,200,"OK",Collections.singletonMap("X-Content-Type-Options","nosniff"),getAssets().open(asset));}catch(IOException error){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
                }
                if("https".equals(u.getScheme())&&"appassets.androidplatform.net".equals(u.getHost())&&("/native-glass/highlight-palette.js".equals(u.getPath())||"/native-glass/adaptive-toolbar.js".equals(u.getPath()))){
                    try{return new WebResourceResponse("application/javascript","UTF-8",200,"OK",Collections.singletonMap("X-Content-Type-Options","nosniff"),getAssets().open(u.getPath().substring(1)));}catch(IOException error){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
                }
                if (LOCAL.equals(u.toString())) {
                    try {
                        boolean legacy=false;
                        String html=readAsset("index.html");html=html.replace("</head>","<script>localStorage.setItem(\"easybook-fast-mode\",\""+getPreferences(MODE_PRIVATE).getBoolean("fastMode",false)+"\");</script></head>");if(!legacy)html=html.replace("connect-src 'self' https://easybook-sync.1902521952.workers.dev","connect-src 'self'");
                        html=html.replace("<script>","<script>"+(legacy?"window.EasybookRollbackMode=true;":"")+readAsset("native-api.js")+"</script><script>");
                        if(BuildConfig.NATIVE_GLASS_PROTOTYPE && android.os.Build.VERSION.SDK_INT>=33&&!getPreferences(MODE_PRIVATE).getBoolean("fastMode",false))html=html.replace("</body>","<script>"+readAsset("native-glass/dock-surface.js")+";"+readAsset("native-glass/toolbar-surface.js")+";"+readAsset("native-glass/format-surface.js")+";"+readAsset("native-glass/move-surface.js")+";"+readAsset("native-glass/sync-surface.js")+";"+readAsset("native-glass/menu.js")+"</script></body>");
                        return new WebResourceResponse("text/html","UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }
                    catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
                }


                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return !r.isForMainFrame() || !LOCAL.equals(r.getUrl().toString()); }
            @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){ready=false;documentGeneration++;if(nativeGlass!=null){nativeGlass.clearFormatFrame();nativeGlass.dismiss(true);}}
        });
        web.loadUrl(LOCAL);
    }
    private String readAsset(String name)throws IOException {try(InputStream in=getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private void respond(JavaScriptReplyProxy reply,long generation,JSONObject value){runOnUiThread(()->{if(!destroyed&&generation==documentGeneration&&LOCAL.equals(web.getUrl()))try{reply.postMessage(value.toString());}catch(IllegalStateException ignored){}});}
    private String bounded(JSONObject args,String name,int max)throws Exception{if(!(args.get(name) instanceof String))throw new IllegalArgumentException();String s=args.getString(name);if(s.length()>max)throw new IllegalArgumentException("Value too large");return s;}
    private void openAppRelease(){runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://github.com/FeoEarth/easybook/releases/latest")));}catch(ActivityNotFoundException e){notifyJs("无法打开下载页面");}});}
    private JSONObject dispatch(String method,JSONObject args,long generation)throws Exception {
        String active=(method.equals("commit")||method.equals("search")||method.equals("snapshot")||method.equals("sync.activity")||method.equals("sync")||method.equals("device.exportNotes"))?repository.activeSpace():"";
        if(method.startsWith("ui.glass.")&&getPreferences(MODE_PRIVATE).getBoolean("fastMode",false))return new JSONObject().put("accepted",false);
        switch(method){
            case "bootstrap":{
                repository.secureCredentials();JSONObject report=new JSONObject().put("state","not-needed");repository.secureCredentials();security.initialized(generation);new SyncJournal(repository,repository.activeSpace()).recover();SyncPolicy.scheduleSafely(SyncPolicy.read(repository,repository.activeSpace()));return repository.snapshot(repository.activeSpace()).put("syncPolicy",SyncPolicy.read(repository,repository.activeSpace())).put("migration",report).put("security",repository.securityStatus());
            }
            case "commit":{String k=args.getString("key");if(!k.equals(active))throw new IllegalStateException("Workspace changed");return repository.commit(k,args.getJSONObject("changes"));}
            case "search":{if(!args.getString("key").equals(active))throw new IllegalStateException("Workspace changed");return new JSONObject().put("notes",repository.search(active,bounded(args,"query",2000),bounded(args,"category",80),args.optBoolean("everywhere")));}
            case "snapshot":return repository.snapshot(active);
            case "sync.activity":{
                if(!args.getString("key").equals(active))throw new SecurityException();SyncJournal journal=new SyncJournal(repository,active);String action=args.optString("action", "read");
                if(action.equals("configure")){
                    try{
                        JSONObject policy=NativeSync.configure(repository,active,args.getJSONObject("policy"));
                        return new JSONObject().put("policy",policy).put("saved",true).put("scheduleWarning",SyncPolicy.scheduleSafely(policy));
                    }catch(Exception e){
                        android.util.Log.w("EasybookSyncPolicy","configure_failed:"+operationErrorCode(e)+":"+e.getClass().getSimpleName());
                        throw e;
                    }
                }
                else if(action.equals("delete")||action.equals("clear")){JSONArray ids=args.optJSONArray("ids");if(ids!=null){if(ids.length()>500)throw new IllegalArgumentException();for(int i=0;i<ids.length();i++)if(ids.getString(i).length()>512)throw new IllegalArgumentException();}journal.delete(ids,action.equals("clear"));}
                else if(!action.equals("read"))throw new IllegalArgumentException();
                return new JSONObject().put("tasks",journal.tasks()).put("policy",SyncPolicy.read(repository,active)).put("running",NativeSync.isRunning(active)).put("runtime",new JSONObject(repository.setting("sync-runtime:"+NoteRepository.spaceId(active),"{}")));
            }
            case "sync":{if(!repository.securityStatus().getBoolean("paired"))throw new CredentialVault.KeyUnavailable();String k=args.getString("key");if(!k.equals(active))throw new IllegalStateException("Workspace changed");return new NativeSync(repository,new NativeSync.HttpsTransport(new DataProtection.Plaintext())).run(k,args.optBoolean("manual"));}
            case "attachment.pick":{String space=repository.activeSpace(),noteId=bounded(args,"noteId",36),kind=bounded(args,"kind",10);if(!kind.matches("media|files"))throw new IllegalArgumentException();if(repository.row(space,"note",noteId)==null)throw new SecurityException();runOnUiThread(()->{if(destroyed||generation!=documentGeneration)return;if(attachmentSpace!=null){notifyJs("请先完成当前选择");return;}attachmentSpace=space;attachmentNote=noteId;attachmentGeneration=generation;try{Intent picker;if(kind.equals("media")&&android.os.Build.VERSION.SDK_INT>=33){picker=new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);picker.putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX,android.provider.MediaStore.getPickImagesMaxLimit());}else picker=documentPicker(kind);try{startActivityForResult(picker,83);}catch(ActivityNotFoundException e){startActivityForResult(documentPicker(kind),83);}}catch(Exception e){attachmentSpace=null;attachmentNote=null;notifyJs("无法打开系统选择器，请稍后重试");pickerFinished(generation);}});return new JSONObject().put("picker",true);}
            case "ui.performance":{if(!(args.get("enabled") instanceof Boolean))throw new IllegalArgumentException();boolean enabled=args.getBoolean("enabled");if(!getPreferences(MODE_PRIVATE).edit().putBoolean("fastMode",enabled).commit())throw new IOException("Preference not saved");runOnUiThread(()->{if(nativeGlass!=null){nativeGlass.dismiss(true);nativeGlass.clearFormatFrame();}});return new JSONObject().put("enabled",enabled);}
            case "device.update":{String action=bounded(args,"action",8);
                if(action.equals("check"))return appUpdater.check();
                if(action.equals("state"))return appUpdater.state();
                if(action.equals("download"))return appUpdater.download();
                if(action.equals("cancel"))return appUpdater.cancel();
                if(action.equals("install"))return appUpdater.install();
                if(action.equals("open")){openAppRelease();return new JSONObject().put("opened",true);}
                throw new IllegalArgumentException();}
            case "attachment.get":{String space=repository.activeSpace(),id=bounded(args,"id",64);requireAttachmentReference(space,id);return repository.attachments.get(space,id);}
            case "attachment.restore":{String space=repository.activeSpace();JSONArray files=args.getJSONArray("files");if(files.length()>100)throw new IllegalArgumentException();for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);repository.attachments.accept(space,f.getString("id"),f);repository.saveAttachment(space,new JSONObject(f.toString()).put("data",JSONObject.NULL).put("dirty",true));}return new JSONObject().put("restored",files.length());}
            case "attachment.open":case "attachment.share":{String space=repository.activeSpace(),id=bounded(args,"id",64);requireAttachmentReference(space,id);JSONObject f=repository.attachments.get(space,id);if(!f.optBoolean("available"))throw new IOException("Attachment only on original device");openNativeFile(f,method.equals("attachment.share"),generation);return new JSONObject().put("opened",true);}
            case "attachment.export":{String space=repository.activeSpace(),id=bounded(args,"id",64);requireAttachmentReference(space,id);JSONObject f=repository.attachments.get(space,id);if(!f.optBoolean("available"))throw new IOException("Attachment only on original device");File bytes=repository.attachments.file(space,id);runOnUiThread(()->{if(destroyed||generation!=documentGeneration)return;attachmentExport=bytes;attachmentExportName=AttachmentStore.cleanName(f.optString("name","附件"));Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,attachmentExportName);startActivityForResult(i,84);});return new JSONObject().put("picker",true);}
            case "security.account":nativeAccount.open();return new JSONObject().put("externalBrowser",true);
            case "account.passkey":if(!(args.get("register") instanceof Boolean)||args.has("name")&&!(args.get("name") instanceof String)||args.optString("name").length()>100)throw new SecurityException("Invalid account request");nativeAccount.passkey(args.getBoolean("register"),args.optString("name",""));return new JSONObject().put("pending",true);
            case "account.browser":nativeAccount.beginBrowser();return new JSONObject().put("externalBrowser",true);
            case "account.resume":nativeAccount.resume();return new JSONObject().put("pending",true);
            case "account.login":nativeAccount.begin();return new JSONObject().put("externalBrowser",true);
            case "account.status":return nativeAccount.publicStatus();
            case "workspace.action":{
                if(NativeSync.isRunning(repository.activeSpace()))throw new IllegalStateException("Sync running");
                String action=bounded(args,"action",16);JSONObject result=WorkspaceClient.perform(repository,action,args);
                if(action.equals("select")||action.equals("create")||action.equals("rotate")||action.equals("mode"))runOnUiThread(()->{if(!destroyed&&generation==documentGeneration)web.reload();});
                return result;
            }
            case "account.manage":return nativeAccount.manage(args);
            case "ai.config":return nativeAccount.ai(new JSONObject().put("action","config"));
            case "ai.credential":return nativeAccount.ai(new JSONObject(args.toString()).put("action","credential"));
            case "ai.chat":return nativeAccount.ai(new JSONObject(args.toString()).put("action","chat"));
            case "account.devices":return nativeAccount.devices();
            case "account.device.revoke":return nativeAccount.revokeDevice(bounded(args,"id",36));
            case "account.logout":nativeAccount.signOut();return new JSONObject().put("pending",true);
            case "security.mcp":security.mcpPairing();return new JSONObject().put("nativeDialog",true);
            case "security.pair":security.pairing(()->{if(!destroyed&&generation==documentGeneration)web.reload();});return new JSONObject().put("nativeDialog",true);
            case "security.status":return repository.securityStatus();
            case "migration.cleaned":if(!repository.setting("rendererCredentials","").equals("cleared")){repository.scrubDeletedPages();repository.setSetting("rendererCredentials","cleared");}return new JSONObject().put("verified",true);
            case "migration.retry":return repository.secureCredentials();
            case "migration.status":return new JSONObject().put("reports",repository.migrationReports()).put("security",repository.securityStatus()).put("rendererCredentials",repository.setting("rendererCredentials","pending"));
            case "migration.rollback":repository.rollbackSecurity();return new JSONObject().put("verified",true).put("mode","native-encrypted");
            case "ui.glass.dismiss":{
                if(nativeGlass!=null)runOnUiThread(()->{if(!destroyed && ready && generation==documentGeneration)nativeGlass.dismiss(true);});
                return new JSONObject();
            }
            case "ui.glass.invalidate":{
                if(nativeGlass!=null)runOnUiThread(()->{if(!destroyed && ready && generation==documentGeneration)nativeGlass.refreshBackdrop();});
                return new JSONObject();
            }
            case "ui.glass.pdf":case "ui.glass.sync":case "ui.glass.dock":case "ui.glass.move":case "ui.glass.toolbar":case "ui.glass.format":{
                boolean available=BuildConfig.NATIVE_GLASS_PROTOTYPE && android.os.Build.VERSION.SDK_INT>=33 && nativeGlass!=null;
                if(!available)return new JSONObject().put("accepted",false);
                if(method.equals("ui.glass.pdf")&&(args.getInt("slot")<0||args.getInt("slot")>7))throw new IllegalArgumentException();
                if(method.equals("ui.glass.dock")&&(args.getInt("slot")<0||args.getInt("slot")>2))throw new IllegalArgumentException();
                if(!(args.get("visible") instanceof Boolean))throw new IllegalArgumentException();
                if(args.getBoolean("visible")){
                    if(method.equals("ui.glass.move")||method.equals("ui.glass.sync")){double scroll=args.getDouble("scrollTop"),bottom=args.getDouble("bottomCorner");if(!Double.isFinite(scroll)||scroll<0||scroll>100000||!Double.isFinite(bottom)||bottom<0||bottom>10000)throw new IllegalArgumentException();}
                    if(method.equals("ui.glass.toolbar")){double scroll=args.getDouble("scrollLeft");if(!Double.isFinite(scroll)||scroll<0||scroll>100000)throw new IllegalArgumentException();}
                    for(String field:new String[]{"left","top","width","height","viewportWidth","opacity","corner"}){
                        double value=args.getDouble(field);if(!Double.isFinite(value)||Math.abs(value)>10000)throw new IllegalArgumentException();
                    }
                    if(args.getDouble("width")<1||args.getDouble("height")<1||args.getDouble("viewportWidth")<1||!(args.get("dark") instanceof Boolean))throw new IllegalArgumentException();
                    if(args.getDouble("opacity")<0||args.getDouble("opacity")>1||args.getDouble("corner")<0)throw new IllegalArgumentException();
                    if(!(args.get("mounted") instanceof Boolean)||args.optInt("revision",-1)<0)throw new IllegalArgumentException();
                    if(args.has("content")){
                        JSONObject content=args.getJSONObject("content");
                        for(String field:new String[]{"html","css","symbols","rootStyle","bodyClass","panel","theme"}){
                            if(!(content.get(field) instanceof String)||content.getString(field).length()>180000)throw new IllegalArgumentException();
                        }
                        if(content.toString().length()>260000)throw new IllegalArgumentException();
                    }
                }
                runOnUiThread(()->{if(!destroyed && ready && generation==documentGeneration){glassGeneration=generation;if(method.equals("ui.glass.pdf"))nativeGlass.updatePdfFrame(args);else if(method.equals("ui.glass.sync"))nativeGlass.updateSyncFrame(args);else if(method.equals("ui.glass.dock"))nativeGlass.updateDockFrame(args);else if(method.equals("ui.glass.move"))nativeGlass.updateMoveFrame(args);else if(method.equals("ui.glass.toolbar"))nativeGlass.updateToolbarFrame(args);else nativeGlass.updateFormatFrame(args);}});
                return new JSONObject().put("accepted",true);
            }
            case "ui.glass.palette":{
                String color=bounded(args,"color",7);if(!color.matches("(?:#[0-9a-fA-F]{6})?"))throw new IllegalArgumentException();
                if(nativeGlass!=null)runOnUiThread(()->{if(!destroyed&&ready&&generation==documentGeneration)nativeGlass.updatePaletteSelection(color);});return new JSONObject();
            }
            case "ui.glass.anchor":{
                for(String field:new String[]{"anchorLeft","anchorTop","anchorRight","anchorBottom","viewportWidth","viewportHeight"}){
                    double value=args.getDouble(field);if(!Double.isFinite(value)||value<0||value>10000)throw new IllegalArgumentException();
                }
                if(args.getDouble("viewportWidth")<1||args.getDouble("viewportHeight")<1)throw new IllegalArgumentException();
                if(nativeGlass!=null)runOnUiThread(()->{if(!destroyed&&ready&&generation==documentGeneration)nativeGlass.updateMenuAnchor(args);});return new JSONObject();
            }
            case "ui.glass.menu":{
                boolean available=BuildConfig.NATIVE_GLASS_PROTOTYPE && android.os.Build.VERSION.SDK_INT>=33 && nativeGlass!=null;
                if(!available)return new JSONObject().put("accepted",false);
                double right=args.getDouble("right"),bottom=args.getDouble("bottom"),width=args.getDouble("viewportWidth");
                if(!Double.isFinite(right)||!Double.isFinite(bottom)||!Double.isFinite(width)||right<0||bottom<0||width<1||width>10000||right>width+1||bottom>10000)throw new IllegalArgumentException();
                if(!args.getString("layout").matches("list|grid")||!args.getString("sort").matches("title|updated")||!(args.get("dark") instanceof Boolean))throw new IllegalArgumentException();
                if(args.has("placement")){
                    if(!args.getString("placement").matches("above|below"))throw new IllegalArgumentException();
                    for(String field:new String[]{"anchorLeft","anchorTop","anchorRight","anchorBottom","viewportHeight"}){
                        double value=args.getDouble(field);if(!Double.isFinite(value)||value<0||value>10000)throw new IllegalArgumentException();
                    }
                    if(args.getDouble("viewportHeight")<1)throw new IllegalArgumentException();
                }
                String kind=args.optString("kind","list");
                if(!kind.matches("list|link|actions|move|attachment|palette|context"))throw new IllegalArgumentException();
                if(args.optString("title").length()>120||args.optString("value").length()>2048)throw new IllegalArgumentException();
                if(!kind.equals("list")){
                    org.json.JSONArray items=args.getJSONArray("items");if(items.length()>96)throw new IllegalArgumentException();
                    if(kind.equals("palette")){
                        if(items.length()>16)throw new IllegalArgumentException();
                        for(int i=0;i<items.length();i++)if(!items.getJSONObject(i).optString("color").matches("(?:#[0-9a-fA-F]{6})?"))throw new IllegalArgumentException();
                    }
                    for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);
                        if(!item.getString("id").matches("panel-[0-9]{1,4}-[0-9]{1,3}")||item.getString("label").length()>120||item.optString("subtitle").length()>160)throw new IllegalArgumentException();}
                }
                runOnUiThread(()->{if(!destroyed && ready && generation==documentGeneration){glassGeneration=generation;if(!nativeGlass.show(args))web.evaluateJavascript("window.easybookNativeGlassFallback && window.easybookNativeGlassFallback()",null);}});
                return new JSONObject().put("accepted",true);
            }
            case "ui.ready":runOnUiThread(()->{if(!destroyed&&generation==documentGeneration){ready=true;receiveShare(getIntent());}});return new JSONObject();
            case "device.theme":{String mode=bounded(args,"value",10);if(!mode.matches("auto|light|dark"))throw new IllegalArgumentException();new DeviceActions().theme(mode);break;}
            case "device.haptic":runOnUiThread(()->web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP));break;
            case "device.copy":new DeviceActions().copy(bounded(args,"value",100000));break;
            case "device.share":new DeviceActions().share(bounded(args,"title",200),bounded(args,"text",60500));break;
            case "device.exportNotes":{JSONObject snapshot=repository.snapshot(active);JSONArray files=new JSONArray(),metas=repository.rows(active,"attachment");long backupSize=0;for(int i=0;i<metas.length();i++){JSONObject meta=metas.getJSONObject(i);backupSize+=meta.optLong("size");if(meta.optLong("size")>5*1024*1024||backupSize>20*1024*1024||!repository.attachments.file(active,meta.getString("id")).isFile()){runOnUiThread(()->notifyJs("JSON备份未导出：大附件请先逐个保存到设备；仅原设备附件请在原设备导出"));return new JSONObject().put("exported",false);}files.put(repository.attachments.payload(active,meta.getString("id")));}new DeviceActions().exportNotes(new JSONObject().put("format","easybook-json-v1").put("notes",snapshot.getJSONArray("notes")).put("folders",snapshot.getJSONArray("folders")).put("attachments",files).toString());break;}
            case "device.importNotes":new DeviceActions().importNotes();break;
            default:throw new IllegalArgumentException("Unknown method");
        }
        return new JSONObject();
    }
    private void openNativeFile(JSONObject f,boolean share,long generation)throws Exception{
        File dir=new File(getCacheDir(),"shared");dir.mkdirs();long cutoff=System.currentTimeMillis()-24L*60*60*1000;File[] stale=dir.listFiles();if(stale!=null)for(File file:stale)if(file.lastModified()<cutoff)file.delete();
        File group=new File(dir,f.getString("id"));group.mkdirs();File target=new File(group,AttachmentStore.cleanName(f.getString("name")));try(InputStream in=new FileInputStream(repository.attachments.file(repository.activeSpace(),f.getString("id")));FileOutputStream out=new FileOutputStream(target)){AttachmentStore.copy(in,out,AttachmentStore.MAX);}
        Uri uri=androidx.core.content.FileProvider.getUriForFile(this,getPackageName()+".files",target);String mime=f.optString("mime","application/octet-stream");
        runOnUiThread(()->{if(destroyed||generation!=documentGeneration)return;try{Intent intent;if(share){intent=new Intent(Intent.ACTION_SEND);intent.setType(mime);intent.putExtra(Intent.EXTRA_STREAM,uri);intent.setClipData(ClipData.newRawUri("附件",uri));}else{intent=new Intent(Intent.ACTION_VIEW);intent.setDataAndType(uri,mime);}intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(share?Intent.createChooser(intent,"分享附件"):intent);}catch(ActivityNotFoundException e){notifyJs("没有可用的查看应用，请保存后打开");}});
    }
    private void requireAttachmentReference(String space,String id)throws Exception{AttachmentStore.validId(id);JSONArray notes=repository.rows(space,"note");for(int i=0;i<notes.length();i++)if(DocumentModel.assets(notes.getJSONObject(i).getJSONObject("document")).contains(id))return;throw new SecurityException("Unreferenced attachment");}
    public class DeviceActions {
        public void theme(String value) { runOnUiThread(() -> {
            boolean dark = "dark".equals(value) || (!"light".equals(value) && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
            if(security!=null)security.setDark(dark);
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
        if(request==83){final String space=attachmentSpace,noteId=attachmentNote;final long generation=attachmentGeneration;attachmentSpace=null;attachmentNote=null;if(space==null)return;java.util.LinkedHashSet<Uri> selected=new java.util.LinkedHashSet<>();if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount();i++)selected.add(data.getClipData().getItemAt(i).getUri());if(data.getData()!=null)selected.add(data.getData());}if(selected.isEmpty()){pickerFinished(generation);return;}final int flags=data.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION;io.execute(()->{for(Uri uri:selected){if(uri==null||!"content".equals(uri.getScheme()))continue;boolean persisted=false;try{try{getContentResolver().takePersistableUriPermission(uri,flags);persisted=true;}catch(SecurityException ignored){}try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException();String name="附件";try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}JSONObject meta=repository.attachments.saveStream(space,name,getContentResolver().getType(uri),in,true,null,-1);runOnUiThread(()->{if(!destroyed&&generation==documentGeneration)web.evaluateJavascript("window.receiveAttachment("+JSONObject.quote(space)+","+JSONObject.quote(noteId)+","+meta.toString()+")",null);});}}catch(Exception e){runOnUiThread(()->notifyJs("附件未添加：单文件最多1 GB，请检查读取权限及存储空间后重试"));}finally{if(persisted)try{getContentResolver().releasePersistableUriPermission(uri,flags);}catch(SecurityException ignored){}}}pickerFinished(generation);});return;}
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if(request==84){final File bytes=attachmentExport;attachmentExport=null;if(bytes==null)return;io.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException();try(InputStream in=new FileInputStream(bytes)){AttachmentStore.copy(in,out,AttachmentStore.MAX);}runOnUiThread(()->notifyJs("附件已保存"));}catch(Exception e){runOnUiThread(()->notifyJs("附件保存失败，可重试"));}});return;}
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
    private Intent documentPicker(String kind){Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT);picker.addCategory(Intent.CATEGORY_OPENABLE);picker.setType("*/*");picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);if(kind.equals("media"))picker.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","video/*"});return picker;}
    private void pickerFinished(long generation){runOnUiThread(()->{if(!destroyed&&generation==documentGeneration)web.evaluateJavascript("window.attachmentPickerFinished&&window.attachmentPickerFinished()",null);});}
    private void receiveShare(Intent i) {
        if (ready && Intent.ACTION_SEND.equals(i.getAction()) && "text/plain".equals(i.getType())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) web.evaluateJavascript("window.receiveSharedText(" + JSONObject.quote(text) + ")", null);
            i.setAction(Intent.ACTION_MAIN);
        }
    }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); if(nativeAccount==null||!nativeAccount.handle(i))receiveShare(i); }
    private View videoFullscreen;private WebChromeClient.CustomViewCallback videoFullscreenCallback;private int videoSystemUi,videoOrientation;
    private void hideVideoFullscreen(){if(videoFullscreen==null)return;View view=videoFullscreen;WebChromeClient.CustomViewCallback callback=videoFullscreenCallback;videoFullscreen=null;videoFullscreenCallback=null;((ViewGroup)view.getParent()).removeView(view);getWindow().getDecorView().setSystemUiVisibility(videoSystemUi);setRequestedOrientation(videoOrientation);callback.onCustomViewHidden();safeArea.requestApplyInsets();}
    @Override public void onBackPressed() {
        if(videoFullscreen!=null){hideVideoFullscreen();return;}
        if(security!=null && security.back())return;
        if(nativeGlass!=null && nativeGlass.back())return;
        if (!ready) {super.onBackPressed(); return;}
        web.evaluateJavascript("window.handleBack()", handled -> {if (!"true".equals(handled)) MainActivity.super.onBackPressed();});
    }
    @Override protected void onResume(){super.onResume();if(nativeAccount!=null)nativeAccount.resume();}
    @Override protected void onPause() { if(security!=null)security.dismissConnection(); if(nativeGlass!=null)nativeGlass.dismiss(true);web.evaluateJavascript("window.EasybookVideo?.pauseAll();window.persistNow && window.persistNow()", null); super.onPause(); }
    @Override protected void onDestroy() { hideVideoFullscreen(); if(nativeAccount!=null)nativeAccount.cancel(); if(security!=null)security.dismissConnection(); if(connectivity!=null&&networkCallback!=null)connectivity.unregisterNetworkCallback(networkCallback); if(nativeGlass!=null){nativeGlass.clearFormatFrame();nativeGlass.dismiss(true);}ready=false; destroyed=true;if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))WebViewCompat.removeWebMessageListener(web,"EasybookNative");web.destroy();if(appUpdater!=null)appUpdater.shutdown();io.shutdown();super.onDestroy(); }
}










