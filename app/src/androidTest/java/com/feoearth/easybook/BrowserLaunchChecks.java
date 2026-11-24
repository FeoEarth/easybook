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
            test.runOnMainSync(() -> main.agentBrowserClient().call("browser.begin", args).whenComplete((value, error) -> {
                if (error == null) ready.complete(value); else ready.completeExceptionally(error);
            }));
            boolean approved = false;
            long deadline = SystemClock.uptimeMillis() + 20000;
            while (!ready.isDone() && SystemClock.uptimeMillis() < deadline && !approved) {
                AccessibilityNodeInfo window = automation.getRootInActiveWindow();
                if (window != null && AgentBrowserProtocol.PACKAGE.equals(String.valueOf(window.getPackageName())) &&
                    !window.findAccessibilityNodeInfosByText("开始使用本地浏览器？").isEmpty()) {
                    for (AccessibilityNodeInfo button : window.findAccessibilityNodeInfosByText("允许")) {
                        if ("允许".equals(String.valueOf(button.getText()))) approved = button.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        if (approved) break;
                    }
                }
                if (!approved) SystemClock.sleep(200);
            }
            DataLayerChecks.require(approved, "companion consent did not appear: " + (ready.isDone() ? ready.get() : "timed out"));
            JSONObject outcome = ready.get(45, TimeUnit.SECONDS);
            DataLayerChecks.require("ready".equals(outcome.optString("status")), "companion did not start: " + outcome);
        } finally {
            test.runOnMainSync(() -> main.agentBrowserClient().call("browser.end", args));
        }
    }
}
