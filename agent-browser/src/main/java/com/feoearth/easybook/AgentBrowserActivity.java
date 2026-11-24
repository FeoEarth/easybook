package com.feoearth.easybook;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.os.ResultReceiver;
import android.widget.FrameLayout;
import org.json.JSONObject;

/** The optional APK shares a signer, while keeping its renderer in a separate app sandbox. */
public final class AgentBrowserActivity extends Activity {
    private AgentBrowser browser;
    private ResultReceiver receiver;
    private int ownerUid;
    private boolean attached, ended;
    private IBinder owner;
    private final IBinder.DeathRecipient ownerDied = () -> runOnUiThread(() -> stop(false));

    @Override protected void onCreate(Bundle state) {
        boolean dark = getIntent().getBooleanExtra("dark", false);
        if (dark) setTheme(android.R.style.Theme_Material_NoActionBar);
        super.onCreate(state);
        try {
            if (state != null || !AgentBrowserProtocol.MAIN_PACKAGE.equals(getCallingPackage())) { finish(); return; }
            PackageManager packages = getPackageManager();
            int flags = AgentBrowserProtocol.SIGNATURE_FLAGS;
            if (!AgentBrowserProtocol.matches(packages.getPackageInfo(getCallingPackage(), flags), packages.getPackageInfo(getPackageName(), flags))) {
                finish(); return;
            }
            ownerUid = packages.getApplicationInfo(getCallingPackage(), 0).uid;
        } catch (PackageManager.NameNotFoundException error) { finish(); return; }
        receiver = getIntent().getParcelableExtra("receiver");
        owner = getIntent().getExtras() == null ? null : getIntent().getExtras().getBinder("owner");
        if (receiver == null || owner == null) { finish(); return; }
        try { owner.linkToDeath(ownerDied, 0); }
        catch (RemoteException error) { finish(); return; }
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(dark ? 0xff1c1c1e : 0xfff2f2f7);
        if (Build.VERSION.SDK_INT >= 30) container.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        setContentView(container);
        container.requestApplyInsets();
        browser = new AgentBrowser(this, container, dark, getIntent().getBooleanExtra("autoSearch", false),
            token -> stop(true), this::finishUnexpectedly);
    }

    private boolean command(Message message) {
        if (message.sendingUid != ownerUid || ended) return true;
        Bundle request = message.getData();
        String method = request.getString("method", "");
        int id = message.arg1;
        try {
            JSONObject args = new JSONObject(request.getString("args", "{}"));
            browser.call(method, args).whenComplete((value, error) -> {
                if (ended) return;
                Bundle result = new Bundle();
                result.putInt("id", id);
                if (error == null) result.putString("result", value.toString());
                receiver.send(AgentBrowserProtocol.RESPONSE, result);
                if (method.equals("browser.end")) stop(false);
                else if (method.equals("browser.begin")) {
                    String status = error == null ? value.optString("status") : "failed";
                    if (status.equals("cancelled")) stop(false);
                    else if (!status.equals("ready")) finishUnexpectedly();
                }
            });
        } catch (Exception error) { finishUnexpectedly(); }
        return true;
    }

    private void stop(boolean notify) {
        if (ended) return;
        ended = true;
        setResult(RESULT_OK);
        if (notify) receiver.send(AgentBrowserProtocol.STOPPED, Bundle.EMPTY);
        finish();
    }

    private void finishUnexpectedly() {
        if (ended) return;
        ended = true;
        finish();
    }

    @Override protected void onResume() {
        super.onResume();
        if (browser == null) return;
        browser.foregrounded();
        if (!attached) {
            attached = true;
            Bundle channel = new Bundle();
            channel.putParcelable("messenger", new Messenger(new Handler(Looper.getMainLooper(), this::command)));
            receiver.send(AgentBrowserProtocol.ATTACHED, channel);
        }
    }

    @Override protected void onStop() {
        // A transient pause can leave the consent dialog visible.
        if (browser != null && !ended && !browser.backgrounded()) stop(true);
        super.onStop();
    }

    @Override public void onBackPressed() {
        if (browser != null) browser.close(true);
        stop(true);
    }

    @Override protected void onDestroy() {
        if (browser != null) browser.close(false);
        if (owner != null) try { owner.unlinkToDeath(ownerDied, 0); }
        catch (java.util.NoSuchElementException ignored) { }
        super.onDestroy();
    }
}
