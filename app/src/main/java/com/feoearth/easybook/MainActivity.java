package com.feoearth.easybook;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.view.WindowInsets;
import android.view.View;
import org.json.JSONObject;
import java.io.IOException;

public class MainActivity extends Activity {
    private WebView web;
    private boolean ready;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xfff7f6f2);
        getWindow().setNavigationBarColor(0xfff7f6f2);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        web = new WebView(this);
        setContentView(web);
        if (android.os.Build.VERSION.SDK_INT >= 35) web.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost()) && "/index.html".equals(u.getPath())) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html")); }
                    catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", null); }
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return true; }
            @Override public void onPageFinished(WebView v, String url) { ready = true; receiveShare(getIntent()); }
        });
        web.loadUrl("https://appassets.androidplatform.net/index.html");
    }
    private void receiveShare(Intent i) {
        if (ready && Intent.ACTION_SEND.equals(i.getAction()) && "text/plain".equals(i.getType())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) web.evaluateJavascript("window.receiveSharedText(" + JSONObject.quote(text) + ")", null);
            i.setAction(Intent.ACTION_MAIN);
        }
    }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); setIntent(i); receiveShare(i); }
    @Override public void onBackPressed() { web.evaluateJavascript("window.goHome()", null); }
    @Override protected void onPause() { web.evaluateJavascript("window.persistNow()", null); super.onPause(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
