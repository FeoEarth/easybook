package com.feoearth.easybook;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.util.HashSet;

public final class WebSearchActivity extends Activity {
    static final int REQUEST = 88;
    static final int MAX_RESULT_JSON_CHARS = 65536;
    private static final int RESULT_LIMIT = 10;
    static final String QUERY = "query", TOKEN = "token", RESULTS = "results";
    private static final String READ_RESULTS = """
        (() => {
          if (!['duckduckgo.com','html.duckduckgo.com','lite.duckduckgo.com'].includes(location.hostname)
              || location.protocol !== 'https:' || document.querySelector('#challenge-form,#anomaly-modal,.anomaly-modal,iframe[src*="captcha"]')) return [];
          const results = [], seen = new Set();
          for (const link of [...document.querySelectorAll('a[data-testid="result-title-a"], a.result__a, a.result-link')].slice(0,25)) {
            if (link.closest('.result--ad,[data-testid="ad"]')) continue;
            let url;
            try {
              url = new URL(link.href);
              if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
                if (url.pathname !== '/l/') continue;
                url = new URL(url.searchParams.get('uddg'));
              }
              if (!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2000||seen.has(url.href)) continue;
            } catch { continue; }
            const clean = (node, size) => (node?.textContent || '').replace(/\\s+/g,' ').trim().slice(0,size);
            const title = clean(link,300);
            if (!title) continue;
            const card = link.closest('[data-testid="result"],.result');
            const snippet = card?.querySelector('[data-result="snippet"],[data-testid="result-snippet"],.result__snippet')
              || link.closest('tr')?.nextElementSibling?.querySelector('.result-snippet');
            const description = clean(snippet,700);
            seen.add(url.href); results.push({url:url.href,title,description});
            if (results.length === SEARCH_RESULT_LIMIT) break;
          }
          return results;
        })()
        """.replace("SEARCH_RESULT_LIMIT", Integer.toString(RESULT_LIMIT));

    private WebView web;
    private LinearLayout preview;
    private ScrollView previewScroll;
    private TextView status;
    private Button read, use;
    private Uri searchUrl;
    private String token;
    private JSONArray sources;
    private int navigation;
    private boolean destroyed;

    @Override protected void onCreate(Bundle saved) {
        if (AppAppearance.dark(AppAppearance.mode(this), AppAppearance.systemDark(getResources().getConfiguration()))) {
            setTheme(android.R.style.Theme_Material_NoActionBar);
        }
        super.onCreate(saved);
        setTitle("联网搜索");
        token = getIntent().getStringExtra(TOKEN);
        String query = getIntent().getStringExtra(QUERY);
        if (token == null || query == null || query.trim().isEmpty() || query.length() > 400) { finish(); return; }
        setResult(RESULT_CANCELED, new Intent().putExtra(TOKEN, token));
        searchUrl = Uri.parse("https://duckduckgo.com/").buildUpon().appendQueryParameter("q", query).build();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.addView(button("关闭", this::finish));
        read = button("读取当前页", this::readPage);
        toolbar.addView(read);
        toolbar.addView(button("系统浏览器", this::openSystemBrowser));
        root.addView(toolbar);
        status = new TextView(this);
        status.setPadding(dp(12), dp(4), dp(12), dp(8));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() ? !permitted(request.getUrl())
                    : !"https".equals(request.getUrl().getScheme());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !permitted(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                navigation++;
                read.setEnabled(false);
                if (!permitted(Uri.parse(url))) {
                    view.stopLoading();
                    status.setText("当前网页已离开搜索站。请返回搜索结果。");
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                read.setEnabled(permitted(Uri.parse(url)) && permitted(Uri.parse(view.getUrl() == null ? "" : view.getUrl())));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) status.setText("页面未能加载。可在系统浏览器继续。");
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));

        previewScroll = new ScrollView(this);
        preview = new LinearLayout(this);
        preview.setOrientation(LinearLayout.VERTICAL);
        preview.setPadding(dp(16), dp(8), dp(16), dp(8));
        previewScroll.addView(preview);
        root.addView(previewScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        use = button("使用这些结果", this::returnSources);
        root.addView(use);
        setContentView(root);
        showPage();
        read.setEnabled(false);
        web.loadUrl(searchUrl.toString());
    }

    private static boolean permitted(Uri url) {
        String host = url.getHost();
        return "https".equals(url.getScheme()) && url.getUserInfo() == null && url.getPort() == -1
            && ("duckduckgo.com".equals(host) || "html.duckduckgo.com".equals(host) || "lite.duckduckgo.com".equals(host));
    }

    private Button button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void showPage() {
        sources = null;
        previewScroll.setVisibility(View.GONE);
        use.setVisibility(View.GONE);
        read.setText("读取当前页");
        web.setVisibility(View.VISIBLE);
        status.setText("如网站要求验证，请完成后点「读取当前页」。");
    }

    private void readPage() {
        if (sources != null) { showPage(); return; }
        String address = web.getUrl();
        if (address == null || !permitted(Uri.parse(address))) return;
        String visibleQuery = Uri.parse(address).getQueryParameter("q");
        if (visibleQuery != null && !visibleQuery.equals(searchUrl.getQueryParameter("q"))) {
            status.setText("当前关键词已更改。请返回原关键词的结果页。");
            return;
        }
        int revision = navigation;
        read.setEnabled(false);
        web.evaluateJavascript(READ_RESULTS, raw -> {
            if (destroyed || navigation != revision || !address.equals(web.getUrl())) return;
            read.setEnabled(true);
            try {
                JSONArray results = validatedSources(raw);
                if (results.length() > 0) {
                    showPreview(results);
                    return;
                }
            } catch (Exception ignored) {}
            status.setText("当前页没有可读取的结果。请完成验证或等结果加载，也可在系统浏览器继续。");
        });
    }

    private static JSONArray validatedSources(String raw) throws Exception {
        JSONArray results = new JSONArray();
        if (raw == null || raw.length() > MAX_RESULT_JSON_CHARS) return results;
        Object decoded = new JSONTokener(raw).nextValue();
        if (!(decoded instanceof JSONArray)) return results;
        JSONArray entries = (JSONArray) decoded;
        HashSet<String> seen = new HashSet<>();
        for (int index = 0; index < Math.min(entries.length(), RESULT_LIMIT); index++) {
            JSONObject item = entries.optJSONObject(index);
            if (item == null || !(item.opt("url") instanceof String) || !(item.opt("title") instanceof String)) continue;
            String url = item.optString("url"), title = item.optString("title").trim(), description = item.optString("description");
            if (url.length() > 2000 || title.isEmpty() || title.length() > 300 || description.length() > 700) continue;
            URI target;
            try { target = URI.create(url); } catch (IllegalArgumentException error) { continue; }
            if (target.getHost() == null || target.getUserInfo() != null || !("https".equals(target.getScheme()) || "http".equals(target.getScheme())) || !seen.add(url)) continue;
            results.put(new JSONObject().put("url", url).put("title", title).put("description", description));
        }
        return results;
    }

    private void showPreview(JSONArray results) throws Exception {
        sources = results;
        preview.removeAllViews();
        for (int index = 0; index < sources.length(); index++) {
            JSONObject result = sources.getJSONObject(index);
            TextView title = new TextView(this);
            title.setText(result.optString("title"));
            title.setTextSize(17);
            preview.addView(title);
            TextView detail = new TextView(this);
            detail.setText(result.optString("url") + "\n" + result.optString("description"));
            detail.setPadding(0, dp(2), 0, dp(14));
            preview.addView(detail);
        }
        status.setText("确认下面的公开来源。使用后会回到原对话继续回答。");
        web.setVisibility(View.GONE);
        previewScroll.setVisibility(View.VISIBLE);
        read.setText("返回网页");
        use.setVisibility(View.VISIBLE);
    }

    private void returnSources() {
        if (sources == null) return;
        setResult(RESULT_OK, new Intent().putExtra(TOKEN, token).putExtra(RESULTS, sources.toString()));
        finish();
    }

    private void openSystemBrowser() {
        try { startActivity(new Intent(Intent.ACTION_VIEW, searchUrl)); }
        catch (ActivityNotFoundException error) { status.setText("设备没有可用的系统浏览器。"); }
    }

    @Override public void onBackPressed() {
        if (sources != null) showPage();
        else if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (web != null) {
            web.stopLoading();
            if (web.getParent() instanceof LinearLayout) ((LinearLayout) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
