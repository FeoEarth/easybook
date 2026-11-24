package com.feoearth.easybook;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebRequestError;
import java.io.File;
import java.io.FileOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/** A private, single-tab Android browser owned by the foreground Agent task. */
final class AgentBrowser {
    private static final String CHANNEL = "easybookAgentBrowser";
    private static final String EXTENSION = "agent-browser@easybook.invalid";
    private static final String SEARCH_HOST = "duckduckgo.com";
    private static GeckoRuntime runtime;
    private static AgentBrowserProxy proxy;

    private final Activity activity;
    private final boolean dark;
    private final boolean autoSearch;
    private final FrameLayout container;
    private final Consumer<String> stopped;
    private final Runnable failed;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<String> allowed = new HashSet<>(), declined = new HashSet<>(), actions = new HashSet<>();
    private final Map<String,URI> links = new LinkedHashMap<>();
    private String token, preset, url = "", lastPublicUrl = "", handoffCode = "";
    private GeckoSession session;
    private GeckoView view;
    private LinearLayout chrome;
    private TextView address, status;
    private Button back, takeover, system;
    private View shield;
    private WebExtension.Port port;
    private Pending pending;
    private CompletableFuture<JSONObject> starting;
    private AlertDialog dialog;
    private boolean paused, loading, canGoBack, externalOpened, proxyVerified;
    private int revision, requestNumber;

    private static final class Pending {
        final CompletableFuture<JSONObject> reply;
        int request;
        int revision;
        int deadline;
        boolean navigates;
        Pending(CompletableFuture<JSONObject> reply) { this.reply = reply; }
    }

    AgentBrowser(Activity activity, FrameLayout container, boolean dark, boolean autoSearch, Consumer<String> stopped, Runnable failed) {
        this.activity = activity;
        this.dark = dark;
        this.autoSearch = autoSearch;
        this.container = container;
        this.stopped = stopped;
        this.failed = failed;
    }

    CompletableFuture<JSONObject> call(String method, JSONObject args) {
        CompletableFuture<JSONObject> reply = new CompletableFuture<>();
        try {
            switch (method) {
                case "browser.begin": begin(args, reply); break;
                case "browser.step": step(args, reply); break;
                case "browser.end":
                    if (token != null && token.equals(args.optString("token"))) close(false);
                    reply.complete(result("closed")); break;
                default: throw new SecurityException("Invalid browser operation");
            }
        } catch (Exception | LinkageError error) {
            if (starting == reply) close(false);
            else if (pending != null && pending.reply == reply) finish(result("failed"));
            reply.completeExceptionally(error);
        }
        return reply;
    }

    private void begin(JSONObject args, CompletableFuture<JSONObject> reply) throws Exception {
        String requested = args.getString("token");
        String requestedPreset = args.optString("preset");
        if (!requested.matches("[a-f0-9-]{36}") || !Arrays.asList("", "search", "read", "compare").contains(requestedPreset)) {
            throw new SecurityException("Invalid browser task");
        }
        if (token != null) { reply.complete(result("busy")); return; }
        token = requested;
        preset = requestedPreset;
        starting = reply;
        String disclosure = "网页在手机上打开。网页标题、链接和有限的正文摘录会发送到当前云端模型。";
        if (preset.equals("search")) disclosure += "\n\n本次联网搜索可直接打开搜索结果中的公开站点。";
        confirm("开始使用本地浏览器？", disclosure, granted -> {
            if (!requested.equals(token)) return;
            android.util.Log.d("EasybookBrowser", granted ? "Browser startup approved" : "Browser startup declined");
            if (!granted) { close(false); return; }
            try {
                GeckoRuntime engine = runtime();
                showChrome();
                engine.getWebExtensionController().ensureBuiltIn("resource://android/assets/agent-browser/", EXTENSION)
                    .then(extension -> engine.getWebExtensionController().setAllowedInPrivateBrowsing(extension, true))
                    .then(extension -> {
                        if (requested.equals(token)) openSession(engine, extension);
                        return null;
                    }, failure -> { if (requested.equals(token)) failStartup(); return null; });
                handler.postDelayed(() -> { if (requested.equals(token) && starting == reply) failStartup(); }, 25000);
            } catch (Exception | LinkageError error) { failStartup(); }
        });
    }

    private GeckoRuntime runtime() throws Exception {
        if (runtime != null) return runtime;
        if (proxy == null) proxy = new AgentBrowserProxy();
        File preferences = new File(activity.getNoBackupFilesDir(), "agent-browser-gecko.yaml");
        String yaml = "prefs:\n"
            + "  network.proxy.type: 1\n"
            + "  network.proxy.http: '127.0.0.1'\n  network.proxy.http_port: " + proxy.port() + "\n"
            + "  network.proxy.ssl: '127.0.0.1'\n  network.proxy.ssl_port: " + proxy.port() + "\n"
            + "  network.proxy.no_proxies_on: ''\n  network.proxy.allow_hijacking_localhost: true\n"
            + "  network.proxy.failover_direct: false\n  network.trr.mode: 5\n"
            + "  network.dns.disablePrefetch: true\n  network.prefetch-next: false\n"
            + "  network.http.http3.enable: false\n  network.webtransport.enabled: false\n"
            + "  media.peerconnection.enabled: false\n  network.captive-portal-service.enabled: false\n"
            + "  signon.rememberSignons: false\n  datareporting.healthreport.uploadEnabled: false\n";
        try (FileOutputStream output = new FileOutputStream(preferences)) {
            output.write(yaml.getBytes(StandardCharsets.UTF_8));
        }
        runtime = GeckoRuntime.create(activity.getApplicationContext(), new GeckoRuntimeSettings.Builder()
            .configFilePath(preferences.getAbsolutePath()).remoteDebuggingEnabled(false).build());
        return runtime;
    }

    private void openSession(GeckoRuntime engine, WebExtension extension) {
        try {
            session = new GeckoSession(new GeckoSessionSettings.Builder().usePrivateMode(true).contextId(token).build());
            installDelegates();
            session.getWebExtensionController().setMessageDelegate(extension, new WebExtension.MessageDelegate() {
                @Override public void onConnect(WebExtension.Port connected) {
                    try {
                        if (session != connected.sender.session || !connected.sender.isTopLevel()) { connected.disconnect(); return; }
                        AgentBrowserProxy.publicUrl(connected.sender.url);
                    } catch (RuntimeException error) { connected.disconnect(); return; }
                    port = connected;
                    connected.setDelegate(new WebExtension.PortDelegate() {
                        @Override public void onPortMessage(Object value, WebExtension.Port source) {
                            if (source == port && value instanceof JSONObject) receive((JSONObject) value);
                        }
                        @Override public void onDisconnect(WebExtension.Port source) { if (source == port) port = null; }
                    });
                    scheduleRead(250);
                }
            }, CHANNEL);
            proxy.setActive(true);
            session.open(engine);
            view.setSession(session);
            String lease = token;
            String host = probeHost();
            proxy.expectProbe(host, () -> handler.post(() -> {
                if (lease.equals(token) && starting != null) {
                    proxyVerified = true;
                    handler.postDelayed(() -> { if (lease.equals(token) && starting != null) ready(); }, 900);
                }
            }));
            session.loadUri("https://" + host + "/");
        } catch (Exception | LinkageError error) { failStartup(); }
    }

    private String probeHost() { return token + ".browser-proxy.invalid"; }

    private void ready() {
        if (!proxyVerified || starting == null) return;
        loading = false;
        status.setText("等待 AI 操作");
        starting.complete(result("ready"));
        starting = null;
    }

    private void showChrome() {
        chrome = new LinearLayout(activity);
        chrome.setOrientation(LinearLayout.VERTICAL);
        chrome.setBackgroundColor(dark ? 0xff1c1c1e : 0xfff2f2f7);
        LinearLayout controls = new LinearLayout(activity);
        back = button("返回", () -> {
            if (canGoBack && session != null) {
                if (!paused) pause("已接管。恢复后，AI 将重新读取当前网页。");
                session.goBack();
            }
        });
        back.setEnabled(false);
        controls.addView(back);
        takeover = button("接管", this::toggleTakeover);
        controls.addView(takeover);
        system = button("系统浏览器", this::openExternally);
        system.setEnabled(false);
        controls.addView(system);
        controls.addView(button("停止", () -> close(true)));
        chrome.addView(controls);
        address = new TextView(activity);
        address.setSingleLine();
        address.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        address.setPadding(dp(16), dp(3), dp(16), dp(3));
        address.setTextColor(dark ? 0xffeeeeee : 0xff27272a);
        chrome.addView(address);
        status = new TextView(activity);
        status.setTextColor(dark ? 0xffcccccc : 0xff50505a);
        status.setText("正在启动本地浏览器…");
        status.setPadding(dp(16), dp(3), dp(16), dp(8));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        chrome.addView(status);
        FrameLayout content = new FrameLayout(activity);
        view = new GeckoView(activity);
        content.addView(view, new FrameLayout.LayoutParams(-1, -1));
        shield = new View(activity);
        shield.setBackgroundColor(dark ? 0xff1c1c1e : 0xfff2f2f7);
        shield.setClickable(true);
        shield.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        content.addView(shield, new FrameLayout.LayoutParams(-1, -1));
        chrome.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        container.addView(chrome, new FrameLayout.LayoutParams(-1, -1));
    }

    private Button button(String label, Runnable handler) {
        Button button = new Button(activity);
        button.setText(label);
        button.setOnClickListener(view -> handler.run());
        return button;
    }

    private void installDelegates() {
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession browser, LoadRequest request) {
                return authorize(browser, request.uri);
            }
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession browser, String uri) { return GeckoResult.fromValue(null); }
            @Override public void onLocationChange(GeckoSession browser, String value,
                    List<GeckoSession.PermissionDelegate.ContentPermission> permissions, Boolean userGesture) {
                if (browser != session || value == null) return;
                try { arrived(AgentBrowserProxy.publicUrl(value)); } catch (RuntimeException ignored) { }
            }
            @Override public void onCanGoBack(GeckoSession browser, boolean value) {
                if (browser == session) { canGoBack = value && !url.isEmpty(); back.setEnabled(canGoBack); }
            }
            @Override public GeckoResult<String> onLoadError(GeckoSession browser, String value, WebRequestError error) {
                if (browser == session && starting == null && !value.contains(".browser-proxy.invalid/")) loadFailed();
                return null;
            }
        });
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override public void onPageStart(GeckoSession browser, String value) {
                if (browser != session || starting != null) return;
                loading = true;
                port = null;
                invalidate();
            }
            @Override public void onPageStop(GeckoSession browser, boolean success) {
                if (browser != session) return;
                if (starting != null) { ready(); return; }
                loading = false;
                if (success) scheduleRead(550); else if (pending != null && pending.navigates) loadFailed();
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override public void onCrash(GeckoSession browser) { rendererExited(browser); }
            @Override public void onKill(GeckoSession browser) { rendererExited(browser); }
        });
        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            @Override public void onAndroidPermissionsRequest(GeckoSession browser, String[] permissions, Callback callback) { callback.reject(); }
            @Override public GeckoResult<Integer> onContentPermissionRequest(GeckoSession browser, ContentPermission permission) {
                return GeckoResult.fromValue(ContentPermission.VALUE_DENY);
            }
            @Override public void onMediaPermissionRequest(GeckoSession browser, String uri, MediaSource[] video,
                    MediaSource[] audio, MediaCallback callback) { callback.reject(); }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override public GeckoResult<PromptResponse> onAuthPrompt(GeckoSession browser, AuthPrompt prompt) {
                if (browser == session) handoff("此网页需要登录。请在系统浏览器继续。", "sign_in");
                return GeckoResult.fromValue(prompt.dismiss());
            }
            @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession browser, FilePrompt prompt) {
                return GeckoResult.fromValue(prompt.dismiss());
            }
        });
    }

    private GeckoResult<AllowOrDeny> authorize(GeckoSession browser, String destination) {
        if (session != browser) return GeckoResult.deny();
        if (destination.equals("about:blank") && url.isEmpty() && pending == null ||
            starting != null && destination.equals("https://" + probeHost() + "/")) return GeckoResult.allow();
        final URI target;
        try { target = AgentBrowserProxy.publicUrl(destination); }
        catch (RuntimeException error) { finish(result("blocked_url")); return GeckoResult.deny(); }
        String host = host(target);
        if (allowed.contains(host) || (preset.equals("search") && !paused && pending != null && pending.navigates)) {
            return GeckoResult.allow();
        }
        if (declined.contains(host) || dialog != null) return GeckoResult.deny();
        GeckoResult<AllowOrDeny> answer = new GeckoResult<>();
        chooseSites(Collections.singleton(host), selection -> {
            boolean permit = browser == session && selection.contains(host);
            if (!permit && browser == session) finish(result("site_declined"));
            if (permit && pending != null) timeout(pending);
            answer.complete(permit ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
        });
        return answer;
    }

    private void step(JSONObject args, CompletableFuture<JSONObject> reply) throws Exception {
        if (session == null || token == null || !token.equals(args.optString("token"))) { reply.complete(result("expired")); return; }
        if (pending != null) { reply.complete(result("busy")); return; }
        String id = args.getString("id"), name = args.getString("name");
        if (!id.matches("[a-f0-9-]{36}") || actions.size() >= 12 || !actions.add(id)) {
            reply.complete(result("expired")); return;
        }
        JSONObject parameters = args.getJSONObject("arguments");
        Pending step = new Pending(reply);
        pending = step;
        if (paused) { status.setText("已接管。恢复后，AI 将重新读取当前网页。"); return; }
        if (!handoffCode.isEmpty()) { resumeReading(); return; }
        timeout(step);
        switch (name) {
            case "browser_search": search(parameters.getString("query").trim()); break;
            case "browser_open": open(AgentBrowserProxy.publicUrl(parameters.getString("url"))); break;
            case "browser_follow": follow(parameters); break;
            case "browser_read": sendRead("read", ""); break;
            case "browser_scroll":
                String direction = parameters.getString("direction");
                if (!direction.equals("up") && !direction.equals("down")) { finish(result("invalid")); break; }
                sendRead("scroll", direction); break;
            case "browser_back":
                if (!canGoBack) { finish(result("no_history")); break; }
                step.navigates = true;
                status.setText("AI 正在返回上一页…");
                session.goBack(); break;
            default: finish(result("invalid"));
        }
    }

    private void search(String query) {
        if (query.isEmpty() || query.length() > 400 || query.matches("(?s).*[\\p{Cntrl}].*")) { finish(result("invalid")); return; }
        Pending step = pending;
        Runnable navigate = () -> {
            if (pending != step || paused) return;
            allowed.add(SEARCH_HOST);
            allowed.add("html." + SEARCH_HOST);
            allowed.add("lite." + SEARCH_HOST);
            openPage(URI.create(new Uri.Builder().scheme("https").authority(SEARCH_HOST).path("/")
                .appendQueryParameter("q", query).build().toString()), "AI 正在联网搜索…");
        };
        if (autoSearch) navigate.run();
        else confirm("发送公开搜索关键词？", "DuckDuckGo\n\n" + query, accepted -> {
            if (pending != step) return;
            if (accepted) navigate.run(); else finish(result("search_declined"));
        });
    }

    private void open(URI target) {
        Pending step = pending;
        if (declined.contains(host(target))) { finish(result("site_declined")); return; }
        confirm("打开公开网页？", target.toASCIIString(), accepted -> {
            if (pending != step || paused) return;
            if (!accepted) { declined.add(host(target)); finish(result("site_declined")); return; }
            allowed.add(host(target));
            openPage(target, "AI 正在打开网页…");
        });
    }

    private void follow(JSONObject parameters) throws Exception {
        URI first = links.get(parameters.getString("id"));
        if (first == null) { finish(result("stale_link")); return; }
        if (declined.contains(host(first))) { finish(result("site_declined")); return; }
        if (preset.equals("search")) { openPage(first, "AI 正在打开来源…"); return; }
        LinkedHashSet<String> sites = new LinkedHashSet<>();
        sites.add(host(first));
        JSONArray more = parameters.optJSONArray("also");
        for (int i = 0; more != null && i < Math.min(4, more.length()); i++) {
            URI link = links.get(more.optString(i));
            if (link != null) sites.add(host(link));
        }
        sites.removeAll(allowed);
        sites.removeAll(declined);
        Pending step = pending;
        int page = revision;
        chooseSites(sites, selection -> {
            if (pending != step || paused) return;
            if (page != revision) { finish(result("stale_link")); return; }
            if (!allowed.contains(host(first))) { finish(result("site_declined")); return; }
            openPage(first, "AI 正在打开来源…");
        });
    }

    private void openPage(URI target, String label) {
        pending.navigates = true;
        timeout(pending);
        loading = true;
        invalidate();
        status.setText(label);
        shield.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        GeckoSession.Loader loader = new GeckoSession.Loader().uri(target.toASCIIString());
        if (url.isEmpty()) loader.flags(GeckoSession.LOAD_FLAGS_REPLACE_HISTORY);
        session.load(loader);
    }

    private void arrived(URI location) {
        String value = location.toASCIIString();
        if (!value.equals(url)) invalidate();
        url = value;
        address.setText(value);
        system.setEnabled(true);
        scheduleRead(450);
    }

    private void invalidate() { revision++; links.clear(); }

    private void scheduleRead(int ms) {
        Pending step = pending;
        if (step == null || paused || loading || port == null || dialog != null || step.request != 0) return;
        handler.postDelayed(() -> {
            if (pending == step && !paused && !loading && port != null && dialog == null && step.request == 0) sendRead("read", "");
        }, ms);
    }

    private void sendRead(String op, String direction) {
        if (port == null || url.isEmpty()) {
            if (!loading) finish(result("no_page"));
            return;
        }
        status.setText(op.equals("scroll") ? "AI 正在滚动网页…" : "AI 正在读取网页…");
        pending.request = ++requestNumber;
        pending.revision = revision;
        port.postMessage(object("id", pending.request, "op", op, "direction", direction));
    }

    private void receive(JSONObject data) {
        if (!samePage(url, data.optString("url"))) return;
        if (data.optBoolean("form")) { handoff("请在系统浏览器填写或提交表单。", "system_browser"); return; }
        Pending step = pending;
        if (step == null || paused || step.request == 0 || step.request != data.optInt("id") || step.revision != revision) return;
        if (data.optBoolean("blocked")) {
            pause("网页需要验证或暂时限流。请接管后处理，再点恢复。");
            return;
        }
        if (data.optBoolean("signIn")) { handoff("此网页需要登录。请在系统浏览器继续。", "sign_in"); return; }
        links.clear();
        JSONArray raw = data.optJSONArray("links"), output = new JSONArray();
        String text = limit(data.optString("text"), 2400);
        int remaining = 3600 - text.length();
        revision++;
        for (int i = 0; raw != null && i < Math.min(18, raw.length()); i++) {
            JSONObject link = raw.optJSONObject(i);
            if (link == null) continue;
            try {
                URI target = AgentBrowserProxy.publicUrl(link.optString("url"));
                String title = limit(link.optString("title"), 120), shown = displayUrl(target);
                String snippet = limit(link.optString("snippet"), 160);
                int size = shown.length() + title.length() + snippet.length() + 80;
                if (size > remaining) continue;
                String key = revision + ":" + i;
                links.put(key, target);
                JSONObject item = object("id", key, "title", title, "url", shown);
                if (!snippet.isEmpty()) item.put("snippet", snippet);
                output.put(item);
                remaining -= size;
            } catch (RuntimeException | org.json.JSONException ignored) { }
        }
        status.setText("等待 AI 操作");
        lastPublicUrl = url;
        finish(object("status", "ok", "url", displayUrl(URI.create(url)), "title", limit(data.optString("title"), 180),
            "text", text, "links", output));
    }

    private static String displayUrl(URI uri) {
        String url = uri.toASCIIString();
        // Fragments and the search engine's keyword URL are unnecessary in source citations.
        int hash = url.indexOf('#');
        if (hash >= 0) url = url.substring(0, hash);
        if (host(uri).endsWith(SEARCH_HOST)) { int query = url.indexOf('?'); if (query >= 0) url = url.substring(0, query); }
        return limit(url, 500);
    }

    private static boolean samePage(String current, String candidate) {
        if (current.isEmpty()) return false;
        try {
            URI a = AgentBrowserProxy.publicUrl(current).normalize(), b = AgentBrowserProxy.publicUrl(candidate).normalize();
            return host(a).equals(host(b)) && TextUtils.equals(a.getRawQuery(), b.getRawQuery()) &&
                TextUtils.equals(a.getRawFragment(), b.getRawFragment()) && path(a).equals(path(b));
        } catch (RuntimeException error) { return false; }
    }

    private static String path(URI uri) { return uri.getRawPath().isEmpty() ? "/" : uri.getRawPath(); }
    private static String host(URI uri) { return uri.getHost().toLowerCase(Locale.ROOT); }

    private void toggleTakeover() {
        if (session == null) return;
        if (!paused) { pause("已接管。恢复前不会把网页内容发送给 AI。"); return; }
        paused = false;
        externalOpened = false;
        shield.setVisibility(View.VISIBLE);
        takeover.setText("接管");
        status.setText("正在恢复 AI 浏览…");
        if (pending != null) resumeReading();
    }

    private void resumeReading() {
        String returnTo = handoffCode;
        handoffCode = "";
        pending.request = 0;
        timeout(pending);
        if (!returnTo.isEmpty() && lastPublicUrl.isEmpty()) finish(result(returnTo));
        else if (!returnTo.isEmpty() && !lastPublicUrl.equals(url)) openPage(AgentBrowserProxy.publicUrl(lastPublicUrl), "正在返回公开网页…");
        else if (url.isEmpty() && !loading) finish(result("no_page"));
        else scheduleRead(250);
    }

    private void pause(String message) {
        paused = true;
        invalidate();
        if (pending != null) pending.request = 0;
        shield.setVisibility(View.GONE);
        takeover.setText("恢复 AI");
        status.setText(message);
    }

    private void handoff(String message, String code) {
        handoffCode = code;
        pause(message);
    }

    private void openExternally() {
        if (url.isEmpty()) return;
        try {
            URI target = AgentBrowserProxy.publicUrl(url);
            if (handoffCode.isEmpty()) handoffCode = "system_browser";
            pause("已交给系统浏览器。返回 Easybook 后可以恢复 AI 浏览。");
            externalOpened = true;
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(target.toASCIIString())).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException error) { externalOpened = false; status.setText("未找到可用的系统浏览器。"); }
    }

    boolean backgrounded() {
        if (externalOpened) return true;
        android.util.Log.d("EasybookBrowser", "Companion activity no longer visible");
        close(true);
        return false;
    }
    void foregrounded() { externalOpened = false; }

    void close(boolean notify) {
        String closedToken = token;
        token = null;
        if (dialog != null) { dialog.dismiss(); dialog = null; }
        if (starting != null) { starting.complete(result("cancelled")); starting = null; }
        finish(result("cancelled"));
        if (port != null) { port.disconnect(); port = null; }
        if (chrome != null) container.removeView(chrome);
        if (view != null) { view.releaseSession(); view = null; }
        if (session != null) { session.close(); session = null; }
        if (proxy != null && closedToken != null) proxy.setActive(false);
        if (runtime != null && closedToken != null) runtime.getStorageController().clearDataForSessionContext(closedToken);
        chrome = null;
        url = lastPublicUrl = handoffCode = "";
        loading = paused = canGoBack = externalOpened = proxyVerified = false;
        allowed.clear(); declined.clear(); actions.clear(); invalidate();
        if (notify && closedToken != null) stopped.accept(closedToken);
    }

    private void failStartup() {
        android.util.Log.w("EasybookBrowser", "Gecko startup did not verify its local proxy");
        if (starting != null) { starting.complete(result("unavailable")); starting = null; }
        close(false);
    }

    private void rendererExited(GeckoSession browser) {
        if (browser != session || token == null) return;
        JSONObject outcome = result("browser_closed");
        CompletableFuture<JSONObject> launch = starting;
        starting = null;
        if (launch != null) launch.complete(outcome);
        finish(outcome);
        failed.run();
        close(false);
    }

    private void loadFailed() {
        loading = false;
        if (status != null) status.setText("网页未能加载。");
        finish(result("load_failed"));
    }

    private void timeout(Pending step) {
        int window = ++step.deadline;
        handler.postDelayed(() -> {
            if (pending == step && !paused && dialog == null && step.deadline == window) {
                if (session != null && loading) session.stop();
                loadFailed();
            }
        }, 24000);
    }

    private void finish(JSONObject value) {
        Pending step = pending;
        pending = null;
        if (step != null) step.reply.complete(value);
    }

    private void confirm(String label, String message, Consumer<Boolean> answer) {
        if (dialog != null) { answer.accept(false); return; }
        dialog = new AlertDialog.Builder(activity).setTitle(label).setMessage(message)
            .setPositiveButton("允许", (d,w) -> { dialog = null; answer.accept(true); })
            .setNegativeButton("取消", (d,w) -> { dialog = null; answer.accept(false); })
            .setOnCancelListener(d -> { dialog = null; answer.accept(false); }).show();
    }

    private void chooseSites(Set<String> sites, Consumer<Set<String>> answer) {
        if (sites.isEmpty()) { answer.accept(Collections.emptySet()); return; }
        if (dialog != null) { answer.accept(Collections.emptySet()); return; }
        String[] hosts = new ArrayList<>(sites).toArray(new String[0]);
        boolean[] checked = new boolean[hosts.length];
        java.util.Arrays.fill(checked, true);
        dialog = new AlertDialog.Builder(activity).setTitle("允许本次任务打开的网站")
            .setMultiChoiceItems(hosts, checked, (d,which,selected) -> checked[which] = selected)
            .setPositiveButton("允许所选网站", (d,w) -> {
                dialog = null;
                Set<String> selected = new HashSet<>();
                for (int i = 0; i < hosts.length; i++) {
                if (checked[i]) { selected.add(hosts[i]); allowed.add(hosts[i]); }
                    else declined.add(hosts[i]);
                }
                answer.accept(selected);
            }).setNegativeButton("取消", (d,w) -> { dialog = null; declined.addAll(sites); answer.accept(Collections.emptySet()); })
            .setOnCancelListener(d -> { dialog = null; declined.addAll(sites); answer.accept(Collections.emptySet()); }).show();
    }

    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static String limit(String value, int max) { return value.substring(0, Math.min(max, value.length())); }
    private static JSONObject result(String status) { return object("status", status); }
    private static JSONObject object(Object... pairs) {
        JSONObject object = new JSONObject();
        try { for (int i = 0; i < pairs.length; i += 2) object.put((String) pairs[i], pairs[i + 1]); }
        catch (org.json.JSONException error) { throw new IllegalArgumentException(error); }
        return object;
    }
}
