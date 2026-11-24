package com.feoearth.easybook;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.Parcel;
import android.os.RemoteException;
import android.os.ResultReceiver;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiConsumer;

/** Owns the foreground task and routes commands to the same-signer optional Activity. */
final class AgentBrowserClient {
    static final int REQUEST = 91;
    private final MainActivity activity;
    private final BiConsumer<String,Boolean> stopped;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final SharedPreferences preferences;
    private final AgentBrowserInstaller installer;
    private Task task;
    private boolean activityOpen;
    private int serial;

    private static final class Task {
        final String token;
        final Binder owner = new Binder();
        final Map<Integer,CompletableFuture<JSONObject>> pending = new HashMap<>();
        Messenger remote;
        IBinder.DeathRecipient remoteDied;
        Task(String token) { this.token = token; }
    }

    AgentBrowserClient(MainActivity activity, BiConsumer<String,Boolean> stopped) {
        this.activity = activity;
        this.stopped = stopped;
        preferences = activity.getSharedPreferences("easybook-agent-browser", 0);
        installer = new AgentBrowserInstaller(activity, preferences);
    }

    CompletableFuture<JSONObject> call(String method, JSONObject args) {
        CompletableFuture<JSONObject> reply = new CompletableFuture<>();
        try {
            switch (method) {
                case "browser.status": reply.complete(installer.status()); break;
                case "browser.configure":
                    if (args.has("autoSearch") == args.has("publicDns")) throw new IllegalArgumentException("无效的浏览器设置");
                    String setting = args.has("publicDns") ? "publicDns" : "autoSearch";
                    if (!(args.opt(setting) instanceof Boolean)) throw new IllegalArgumentException("无效的浏览器设置");
                    preferences.edit().putBoolean(setting, args.getBoolean(setting)).apply();
                    reply.complete(installer.status()); break;
                case "browser.download": reply.complete(installer.download()); break;
                case "browser.install": installer.install(); reply.complete(installer.status()); break;
                case "browser.cancelDownload": installer.cancel(); reply.complete(installer.status()); break;
                case "browser.remove": installer.remove(); reply.complete(installer.status()); break;
                case "browser.begin": begin(args, reply); break;
                case "browser.step":
                    if (task == null || !task.token.equals(args.optString("token")) || task.remote == null) reply.complete(result("expired"));
                    else send(task, method, args, reply);
                    break;
                case "browser.end":
                    if (task != null && task.token.equals(args.optString("token"))) close(false);
                    reply.complete(result("closed")); break;
                default: throw new SecurityException("Unknown browser operation");
            }
        } catch (Exception error) { reply.completeExceptionally(error); }
        return reply;
    }

    private void begin(JSONObject args, CompletableFuture<JSONObject> reply) throws Exception {
        String token = args.getString("token");
        if (!token.matches("[a-f0-9-]{36}")) throw new SecurityException("Invalid browser task");
        if (activityOpen || task != null) { reply.complete(result("busy")); return; }
        if (!installer.installed()) { reply.complete(result("unavailable")); return; }
        Task run = new Task(token);
        task = run;
        run.pending.put(0, reply);
        ResultReceiver receiver = new ResultReceiver(ui) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (code == AgentBrowserProtocol.ATTACHED) {
                    if (run.remote != null) return;
                    run.remote = data.getParcelable("messenger");
                    if (task != run) { sendEnd(run); return; }
                    if (run.remote == null) { disconnected(run); return; }
                    IBinder.DeathRecipient death = () -> ui.post(() -> disconnected(run));
                    try {
                        run.remote.getBinder().linkToDeath(death, 0);
                        run.remoteDied = death;
                    } catch (RemoteException error) { disconnected(run); return; }
                    run.pending.remove(0);
                    AgentBrowserClient.this.send(run, "browser.begin", args, reply);
                } else if (task == run && code == AgentBrowserProtocol.RESPONSE) {
                    CompletableFuture<JSONObject> pending = run.pending.remove(data.getInt("id"));
                    if (pending != null) {
                        try {
                            JSONObject result = new JSONObject(data.getString("result", "{}"));
                            pending.complete(result);
                            if (pending == reply && !"ready".equals(result.optString("status"))) clear(run, false);
                        }
                        catch (Exception error) { pending.completeExceptionally(error); }
                    }
                } else if (task == run && code == AgentBrowserProtocol.STOPPED) clear(run, true);
            }
        };
        try {
            Bundle connection = new Bundle();
            connection.putBinder("owner", run.owner);
            activity.startActivityForResult(new Intent().setComponent(new ComponentName(AgentBrowserProtocol.PACKAGE, AgentBrowserProtocol.ACTIVITY))
                .putExtras(connection).putExtra("receiver", transportReceiver(receiver)).putExtra("dark", activity.agentBrowserDark())
                .putExtra("autoSearch", preferences.getBoolean("autoSearch", false))
                .putExtra("publicDns", preferences.getBoolean("publicDns", true)), REQUEST);
            activityOpen = true;
            ui.postDelayed(() -> {
                if (task == run && run.remote == null) {
                    reply.complete(result("unavailable"));
                    clear(run, false);
                    activity.finishActivity(REQUEST);
                }
            }, 12000);
        } catch (RuntimeException error) {
            run.pending.remove(0);
            clear(run, false);
            throw error;
        }
        reply.whenComplete((value, error) -> { if (error != null) clear(run, false); });
    }

    static ResultReceiver transportReceiver(ResultReceiver receiver) {
        // Parcel records the concrete class name. The optional APK cannot load the host's callback subclass.
        Parcel parcel = Parcel.obtain();
        try {
            receiver.writeToParcel(parcel, 0);
            parcel.setDataPosition(0);
            return ResultReceiver.CREATOR.createFromParcel(parcel);
        } finally {
            parcel.recycle();
        }
    }

    private void send(Task run, String method, JSONObject args, CompletableFuture<JSONObject> reply) {
        int id = ++serial;
        run.pending.put(id, reply);
        try { transmit(run, method, args, id); }
        catch (RemoteException | RuntimeException error) { disconnected(run); }
    }

    private void sendEnd(Task run) {
        if (run.remote == null) return;
        try { transmit(run, "browser.end", new JSONObject().put("token", run.token), 0); }
        catch (Exception ignored) { }
    }

    private void transmit(Task run, String method, JSONObject args, int id) throws RemoteException {
        Message message = Message.obtain();
        message.arg1 = id;
        Bundle data = new Bundle();
        data.putString("method", method);
        data.putString("args", args.toString());
        message.setData(data);
        run.remote.send(message);
    }

    void activityReturned(int resultCode) {
        android.util.Log.d("EasybookBrowser", "Companion activity finished: " + resultCode);
        activityOpen = false;
        if (task != null) {
            if (resultCode == Activity.RESULT_OK) clear(task, true);
            else disconnected(task);
        }
    }

    void close(boolean notify) {
        if (task != null) {
            android.util.Log.d("EasybookBrowser", "Host closed browser task");
            sendEnd(task);
            clear(task, notify);
            if (activityOpen) activity.finishActivity(REQUEST);
        }
    }

    private void clear(Task run, boolean notify) {
        if (task != run) return;
        complete(run, "cancelled");
        if (notify) stopped.accept(run.token, false);
    }

    private void disconnected(Task run) {
        if (task != run) return;
        complete(run, "browser_closed");
        if (activityOpen) activity.finishActivity(REQUEST);
        stopped.accept(run.token, true);
    }

    private void complete(Task run, String status) {
        task = null;
        if (run.remoteDied != null) {
            try { run.remote.getBinder().unlinkToDeath(run.remoteDied, 0); }
            catch (java.util.NoSuchElementException ignored) { }
        }
        for (CompletableFuture<JSONObject> reply : run.pending.values()) reply.complete(result(status));
        run.pending.clear();
    }

    private static JSONObject result(String state) {
        try { return new JSONObject().put("status", state); }
        catch (org.json.JSONException error) { throw new IllegalStateException(error); }
    }
}
