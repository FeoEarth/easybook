package com.feoearth.easybook;

import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class AgentBrowserInstaller {
    private static final int CURRENT_VERSION = 3;
    private static final long ESTIMATED_BYTES = 100L * 1024 * 1024;
    private static final long MAX_BYTES = 160L * 1024 * 1024;
    private final MainActivity activity;
    private final DownloadManager downloads;
    private final SharedPreferences preferences;
    private final File temporary, directory, apk;
    private final String abi;
    private static final ExecutorService VERIFIER = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean VERIFYING = new AtomicBoolean();

    AgentBrowserInstaller(MainActivity activity, SharedPreferences preferences) {
        this.activity = activity;
        this.preferences = preferences;
        downloads = activity.getSystemService(DownloadManager.class);
        File external = activity.getExternalFilesDir(null);
        temporary = external == null ? null : new File(external, "easybook-agent-browser.download");
        directory = new File(activity.getCacheDir(), "agent-browser");
        apk = new File(directory, "Easybook-Agent-Browser.apk");
        abi = Arrays.stream(Build.SUPPORTED_ABIS).filter(name -> name.equals("arm64-v8a") || name.equals("armeabi-v7a") || name.equals("x86_64"))
            .findFirst().orElse("");
    }

    boolean installed() {
        return installedVersion() > 0;
    }

    private long installedVersion() {
        try {
            PackageInfo browser = activity.getPackageManager().getPackageInfo(AgentBrowserProtocol.PACKAGE, AgentBrowserProtocol.SIGNATURE_FLAGS);
            return trusted(browser) ? version(browser) : 0;
        } catch (PackageManager.NameNotFoundException error) { return 0; }
    }

    private static long version(PackageInfo browser) {
        return Build.VERSION.SDK_INT >= 28 ? browser.getLongVersionCode() : browser.versionCode;
    }

    private boolean trusted(PackageInfo browser) throws PackageManager.NameNotFoundException {
        PackageInfo main = activity.getPackageManager().getPackageInfo(activity.getPackageName(), AgentBrowserProtocol.SIGNATURE_FLAGS);
        return AgentBrowserProtocol.matches(main, browser);
    }

    JSONObject status() throws Exception {
        long installedVersion = installedVersion();
        JSONObject result = new JSONObject().put("available", installedVersion > 0).put("supported", !abi.isEmpty())
            .put("downloadable", !abi.isEmpty() && !BuildConfig.LOCAL_AI_RUNTIME_TAG.isEmpty())
            .put("estimatedBytes", ESTIMATED_BYTES).put("autoSearch", preferences.getBoolean("autoSearch", false));
        if (installedVersion >= CURRENT_VERSION) {
            discardDownload();
            return result.put("state", "installed");
        }
        if (ready()) return result.put("state", "ready");
        if (VERIFYING.get()) return result.put("state", "verifying");
        long id = preferences.getLong("download", -1);
        if (id >= 0) try (Cursor row = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (row != null && row.moveToFirst()) {
                int state = row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (state == DownloadManager.STATUS_SUCCESSFUL) { verify(id); return result.put("state", "verifying"); }
                if (state == DownloadManager.STATUS_FAILED) return result.put("state", "failed").put("error", "浏览器组件下载失败");
                return result.put("state", "downloading").put("bytes", row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    .put("totalBytes", row.getLong(row.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            }
        }
        String failure = preferences.getString("failure", "");
        return result.put("state", failure.isEmpty() ? (installedVersion > 0 ? "update" : "missing") : "failed").put("error", failure);
    }

    JSONObject download() throws Exception {
        if (abi.isEmpty() || BuildConfig.LOCAL_AI_RUNTIME_TAG.isEmpty() || temporary == null) throw new IOException("此版本或设备无法下载浏览器组件");
        JSONObject current = status();
        if (!Arrays.asList("missing", "update", "failed").contains(current.getString("state"))) return current;
        if (new StatFs(activity.getCacheDir().getPath()).getAvailableBytes() < ESTIMATED_BYTES * 4) throw new IOException("请至少预留 400 MiB 存储空间");
        discardDownload();
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(releaseBase() + asset()));
        request.setTitle("Easybook · 本地浏览器组件").setDescription("GeckoView · " + abi)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setAllowedOverMetered(true).setAllowedOverRoaming(false).setDestinationUri(Uri.fromFile(temporary));
        preferences.edit().putLong("download", downloads.enqueue(request)).remove("failure").apply();
        return status();
    }

    void cancel() {
        if (VERIFYING.get()) throw new IllegalStateException("正在验证浏览器组件");
        discardDownload();
        preferences.edit().remove("failure").apply();
    }

    void install() throws IOException {
        if (!ready()) throw new IOException("请先下载并验证浏览器组件");
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
        activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
    }

    void remove() {
        if (installed()) activity.startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + AgentBrowserProtocol.PACKAGE)));
    }

    private boolean ready() {
        String build = preferences.getString("verifiedBuild", "");
        return !build.isEmpty() && build.equals(BuildConfig.LOCAL_AI_RUNTIME_TAG) && apk.isFile() && apk.length() == preferences.getLong("verifiedBytes", 0);
    }

    private String asset() { return "Easybook-Agent-Browser-" + abi + ".apk"; }
    private String releaseBase() { return "https://github.com/FeoEarth/easybook/releases/download/" + BuildConfig.LOCAL_AI_RUNTIME_TAG + "/"; }

    private void discardDownload() {
        long id = preferences.getLong("download", -1);
        if (id >= 0) downloads.remove(id);
        if (temporary != null && temporary.exists()) temporary.delete();
        if (apk.exists()) apk.delete();
        preferences.edit().remove("download").remove("verifiedBuild").remove("verifiedBytes").apply();
    }

    private void verify(long id) {
        if (!VERIFYING.compareAndSet(false, true)) return;
        VERIFIER.execute(() -> {
            File staging = new File(directory, "verifying.apk");
            try {
                if (temporary == null || !temporary.isFile() || temporary.length() > MAX_BYTES) throw new IOException("浏览器组件文件无效");
                String expected = expectedDigest();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("浏览器组件缓存不可用");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long bytes = 0;
                try (FileInputStream input = new FileInputStream(temporary); FileOutputStream output = new FileOutputStream(staging)) {
                    byte[] buffer = new byte[256 * 1024];
                    for (int count; (count = input.read(buffer)) != -1;) {
                        bytes += count;
                        if (bytes > MAX_BYTES) throw new IOException("浏览器组件文件无效");
                        output.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                    }
                    output.getFD().sync();
                }
                StringBuilder hash = new StringBuilder();
                for (byte value : digest.digest()) hash.append(String.format(Locale.ROOT, "%02x", value & 255));
                PackageInfo archive = activity.getPackageManager().getPackageArchiveInfo(staging.getPath(), AgentBrowserProtocol.SIGNATURE_FLAGS);
                if (!expected.contentEquals(hash) || !trusted(archive)) throw new IOException("浏览器组件校验值或签名不匹配");
                if (version(archive) < CURRENT_VERSION) throw new IOException("浏览器组件版本过低");
                if (!staging.renameTo(apk)) throw new IOException("无法保存浏览器组件");
                preferences.edit().putString("verifiedBuild", BuildConfig.LOCAL_AI_RUNTIME_TAG).putLong("verifiedBytes", bytes).remove("download").remove("failure").apply();
            } catch (Exception error) {
                preferences.edit().remove("download").putString("failure", "浏览器组件验证失败，请重新下载").apply();
            } finally {
                staging.delete();
                downloads.remove(id);
                VERIFYING.set(false);
            }
        });
    }

    private String expectedDigest() throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(releaseBase() + "SHA256SUMS.txt").openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(12000);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.US_ASCII))) {
            for (String line; (line = reader.readLine()) != null;) {
                if (line.length() < 68 || line.length() > 180) continue;
                String[] fields = line.trim().split("\\s+");
                if (fields.length == 2 && fields[0].matches("[a-f0-9]{64}") && fields[1].equals(asset())) return fields[0];
            }
            throw new IOException("发布版本缺少浏览器组件校验值");
        } finally { connection.disconnect(); }
    }

}
