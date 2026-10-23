package com.feoearth.easybook;

import android.app.Activity;
import android.content.*;
import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.view.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
    private WebView web;
    private android.widget.FrameLayout safeArea;
    private boolean ready;
    private String pendingExport;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final String LOCAL = "https://appassets.androidplatform.net/index.html";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = dark ? 0xff000000 : 0xfff2f2f7;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        web = new WebView(this); web.setBackgroundColor(color);
        web.setTag("notes-webview");
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
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new DeviceActions(), "EasybookDevice");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (LOCAL.equals(u.toString())) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html")); }
                    catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0])); }
                }
                if ("https".equals(u.getScheme()) && "easybook-sync.1902521952.workers.dev".equals(u.getHost()) && u.getPath().startsWith("/api/")) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
            @Override public void onPageFinished(WebView v, String url) { if (LOCAL.equals(url)) {ready = true; receiveShare(getIntent());} }
        });
        web.loadUrl(LOCAL);
    }
    public class DeviceActions {
        @JavascriptInterface public void theme(String value) { runOnUiThread(() -> {
            boolean dark = "dark".equals(value) || (!"light".equals(value) && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
            int color = dark ? 0xff000000 : 0xfff2f2f7;
            web.setBackgroundColor(color); safeArea.setBackgroundColor(color); getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(color);
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }); }
        @JavascriptInterface public void copy(String value) { runOnUiThread(() -> {
            ((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Easybook", value));
        }); }
        @JavascriptInterface public void haptic() { runOnUiThread(() -> web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)); }
        @JavascriptInterface public void share(String title, String text) { runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_SEND); i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT,title); i.putExtra(Intent.EXTRA_TEXT,text);
            startActivity(Intent.createChooser(i,"分享笔记"));
        }); }
        @JavascriptInterface public void exportNotes(String value) { runOnUiThread(() -> {
            if (value.length() > 10000000) { notifyJs("备份过大，请分批整理"); return; }
            pendingExport = value;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json"); i.putExtra(Intent.EXTRA_TITLE,"Easybook-backup.json");
            startActivityForResult(i, 81);
        }); }
        @JavascriptInterface public void importNotes() { runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
            startActivityForResult(i, 82);
        }); }
    }
    private void notifyJs(String text) { web.evaluateJavascript("window.showNativeMessage && window.showNativeMessage("+JSONObject.quote(text)+")",null); }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 81 && (result != RESULT_OK || data == null)) {pendingExport = null; return;}
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (request == 81 && pendingExport != null) {
            final String value = pendingExport; pendingExport = null;
            io.execute(() -> { try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException(); out.write(value.getBytes(StandardCharsets.UTF_8));
                runOnUiThread(() -> notifyJs("备份已保存"));
            } catch (IOException e) {runOnUiThread(() -> notifyJs("备份保存失败，请重试"));} });
        } else if (request == 82) io.execute(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                if (in == null) throw new IOException(); byte[] buf = new byte[8192]; int n;
                while ((n=in.read(buf))!=-1) { if (out.size()+n>10000000) throw new IOException(); out.write(buf,0,n); }
                String text = out.toString("UTF-8");
                runOnUiThread(() -> web.evaluateJavascript("window.importBackupText("+JSONObject.quote(text)+")",null));
            } catch (IOException e) {runOnUiThread(() -> notifyJs("无法读取文件或备份超过 10 MB"));}
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
    @Override protected void onDestroy() { ready=false; web.removeJavascriptInterface("EasybookDevice");web.destroy();io.shutdown();super.onDestroy(); }
}
