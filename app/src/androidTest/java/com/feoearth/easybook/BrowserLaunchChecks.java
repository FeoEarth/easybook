package com.feoearth.easybook;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.os.Bundle;
import android.os.Parcel;
import android.os.ResultReceiver;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import java.lang.reflect.Field;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class BrowserLaunchChecks {
    static void run() throws Exception {
        CountDownLatch received = new CountDownLatch(1);
        ResultReceiver callback = new ResultReceiver(null) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (code == 1 && data.getBoolean("attached")) received.countDown();
            }
        };
        Bundle extras = new Bundle();
        extras.putParcelable("receiver", AgentBrowserClient.transportReceiver(callback));
        Parcel wire = Parcel.obtain();
        try {
            wire.writeBundle(extras);
            wire.setDataPosition(0);
            // The companion APK cannot see any classes defined by the main APK.
            ResultReceiver remote = wire.readBundle(ResultReceiver.class.getClassLoader()).getParcelable("receiver");
            DataLayerChecks.require(remote.getClass() == ResultReceiver.class, "browser callback uses a framework parcelable");
            Bundle response = new Bundle();
            response.putBoolean("attached", true);
            remote.send(1, response);
            DataLayerChecks.require(received.await(2, TimeUnit.SECONDS), "browser callback delivers IPC replies");
        } finally {
            wire.recycle();
        }
    }

    static void launch(Instrumentation test) throws Exception {
        run();
        MainActivity main = (MainActivity) test.startActivitySync(new Intent(test.getTargetContext(), MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Field documentReady = MainActivity.class.getDeclaredField("ready");
        documentReady.setAccessible(true);
        long initializationDeadline = SystemClock.uptimeMillis() + 15000;
        while (!documentReady.getBoolean(main) && SystemClock.uptimeMillis() < initializationDeadline) SystemClock.sleep(100);
        DataLayerChecks.require(documentReady.getBoolean(main), "Easybook WebView did not finish initializing");
        JSONObject args = new JSONObject().put("token", UUID.randomUUID().toString()).put("preset", "search");
        CompletableFuture<JSONObject> ready = new CompletableFuture<>();
        UiAutomation automation = test.getUiAutomation();
        try {
            request(test, main, "browser.begin", args, ready);
            approve(automation, "开始使用本地浏览器？", ready);
            JSONObject outcome = ready.get(45, TimeUnit.SECONDS);
            DataLayerChecks.require("ready".equals(outcome.optString("status")), "companion did not start: " + outcome);
            CompletableFuture<JSONObject> content = new CompletableFuture<>();
            JSONObject step = new JSONObject().put("token", args.getString("token")).put("id", UUID.randomUUID().toString())
                .put("name", "browser_open").put("arguments", new JSONObject().put("url", "https://example.com/"));
            request(test, main, "browser.step", step, content);
            approve(automation, "打开公开网页？", content);
            JSONObject page = content.get(40, TimeUnit.SECONDS);
            DataLayerChecks.require("ok".equals(page.optString("status")) && "Example Domain".equals(page.optString("title"))
                && page.optString("text").contains("documentation examples"),
                "companion did not read the public HTTPS page: " + page);
        } finally {
            test.runOnMainSync(() -> main.agentBrowserClient().call("browser.end", args));
        }
    }

    private static void request(Instrumentation test, MainActivity main, String method, JSONObject args, CompletableFuture<JSONObject> reply) {
        test.runOnMainSync(() -> main.agentBrowserClient().call(method, args).whenComplete((value, error) -> {
            if (error == null) reply.complete(value); else reply.completeExceptionally(error);
        }));
    }

    private static void approve(UiAutomation automation, String title, CompletableFuture<JSONObject> reply) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 20000;
        while (!reply.isDone() && SystemClock.uptimeMillis() < deadline) {
            AccessibilityNodeInfo window = automation.getRootInActiveWindow();
            if (window != null && AgentBrowserProtocol.PACKAGE.equals(String.valueOf(window.getPackageName())) &&
                !window.findAccessibilityNodeInfosByText(title).isEmpty()) {
                for (AccessibilityNodeInfo button : window.findAccessibilityNodeInfosByText("允许")) {
                    if ("允许".equals(String.valueOf(button.getText())) && button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return;
                }
            }
            SystemClock.sleep(200);
        }
        throw new AssertionError(title + " did not appear: " + (reply.isDone() ? reply.get() : "timed out"));
    }
}
