package com.feoearth.easybook;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Android-only updater. Neither the WebView nor a Release tag can choose an APK to install. */
final class AppUpdateManager {
    interface Listener { void changed(JSONObject state); }

    private static final String API = "https://api.github.com/repos/FeoEarth/easybook/releases/latest";
    private static final String RELEASE_PREFIX = "https://github.com/FeoEarth/easybook/releases/download/";
    private static final Pattern CODE = Pattern.compile("(?m)^- APK versionCode: ([1-9][0-9]{0,9})[ \\t]*$");
    private static final int MAX_METADATA = 262144;
    private static final long MAX_APK = 250L * 1024L * 1024L;
    private final Activity activity;
    private final Listener listener;
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    private Release release;
    private File readyFile;
    private String stage = "idle";
    private String error = "";
    private long bytes;
    private volatile boolean cancelRequested;

    private static final class Release {
        final String name, tag, notes, url, sha, apkUrl;
        final int code;
        final long size;
        Release(String name, String tag, String notes, String url, String sha, String apkUrl, int code, long size) {
            this.name=name; this.tag=tag; this.notes=notes; this.url=url; this.sha=sha;
            this.apkUrl=apkUrl; this.code=code; this.size=size;
        }
    }

    AppUpdateManager(Activity activity, Listener listener) {
        this.activity=activity;
        this.listener=listener;
    }

    private static JSONObject readRelease() throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(API).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept","application/vnd.github+json");
        connection.setRequestProperty("User-Agent","Easybook-Android/"+BuildConfig.VERSION_NAME);
        try {
            if(connection.getResponseCode()!=200)throw new IOException("GitHub HTTP "+connection.getResponseCode());
            try(InputStream in=connection.getInputStream()) {
                byte[] buf=new byte[8192];int count;
                java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
                while((count=in.read(buf))!=-1) {
                    if(out.size()+count>MAX_METADATA)throw new IOException("Release metadata is too large");
                    out.write(buf,0,count);
                }
                return new JSONObject(out.toString("UTF-8"));
            }
        } finally { connection.disconnect(); }
    }

    private static Release parseRelease(JSONObject json) throws Exception {
        String tag=json.getString("tag_name");
        if(!tag.matches("v[0-9]+\\.[0-9]+\\.[0-9]+(?:-build[0-9]+)?"))
            throw new IOException("Unsupported release tag");
        String body=json.optString("body","");
        Matcher match=CODE.matcher(body);
        if(!match.find())throw new IOException("Release missing APK versionCode; update requires a new-format release");
        long value=Long.parseLong(match.group(1));
        if(value>Integer.MAX_VALUE)throw new IOException("Invalid APK versionCode");
        JSONArray assets=json.getJSONArray("assets");
        for(int i=0;i<assets.length();i++) {
            JSONObject asset=assets.getJSONObject(i);
            String name=asset.optString("name","");
            String link=asset.optString("browser_download_url","");
            String digest=asset.optString("digest","");
            long size=asset.optLong("size",0);
            if(!name.matches("Easybook-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk"))continue;
            if(!link.startsWith(RELEASE_PREFIX) || !link.endsWith("/"+name))continue;
            if(!digest.matches("sha256:[0-9a-fA-F]{64}"))throw new IOException("Release APK has no SHA-256 digest");
            if(size<=0 || size>MAX_APK)throw new IOException("Invalid APK size");
            return new Release(tag.substring(1).replaceFirst("-build[0-9]+$",""),tag,
                body.length()>16000?body.substring(0,16000):body,
                json.optString("html_url","https://github.com/FeoEarth/easybook/releases/latest"),
                digest.substring(7).toLowerCase(java.util.Locale.ROOT),link,(int)value,size);
        }
        throw new IOException("Release has no supported Android APK");
    }

    JSONObject check() throws Exception {
        Release candidate=parseRelease(readRelease());
        synchronized(lock) {
            if("downloading".equals(stage))throw new IOException("Download in progress");
            release=candidate; readyFile=null; error=""; bytes=0;
            stage="idle";
        }
        if(candidate.code>BuildConfig.VERSION_CODE) {
            File existing=apkFile(candidate.code);
            if(existing.isFile()) {
                try {
                    verify(existing,candidate);
                    synchronized(lock) { readyFile=existing; stage="ready"; bytes=candidate.size; }
                } catch(Exception invalid) { existing.delete(); }
            }
        }
        notifyChanged();
        return state();
    }

    JSONObject state() {
        synchronized(lock) {
            JSONObject result=new JSONObject();
            try {
                result.put("current",BuildConfig.VERSION_NAME)
                    .put("currentCode",BuildConfig.VERSION_CODE)
                    .put("stage",stage).put("error",error).put("downloaded",bytes);
                if(release!=null)result.put("latest",release.name).put("latestCode",release.code)
                    .put("tag",release.tag).put("notes",release.notes).put("size",release.size)
                    .put("url",release.url)
                    .put("updateAvailable",release.code>BuildConfig.VERSION_CODE);
                else result.put("updateAvailable",false);
            }catch(Exception ignored){}
            return result;
        }
    }

    private File apkFile(int code) throws IOException {
        File directory=new File(activity.getCacheDir(),"app-updates");
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Cannot create update cache");
        return new File(directory,"Easybook-"+code+".apk");
    }

    private void notifyChanged() { listener.changed(state()); }

    JSONObject download() throws Exception {
        final Release target;
        synchronized(lock) {
            if(release==null || release.code<=BuildConfig.VERSION_CODE)throw new IOException("No newer APK");
            if("downloading".equals(stage) || "ready".equals(stage))return state();
            target=release;
            cancelRequested=false; bytes=0; error=""; readyFile=null; stage="downloading";
        }
        notifyChanged();
        downloads.execute(()->downloadOnWorker(target));
        return state();
    }

    private void downloadOnWorker(Release target) {
        File tmp=null;
        HttpURLConnection connection=null;
        try {
            File destination=apkFile(target.code);
            tmp=new File(destination.getParentFile(),destination.getName()+".part");
            if(tmp.exists()&&!tmp.delete())throw new IOException("Cannot replace partial download");
            connection=(HttpURLConnection)new URL(target.apkUrl).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept","application/octet-stream");
            connection.setRequestProperty("User-Agent","Easybook-Android/"+BuildConfig.VERSION_NAME);
            if(connection.getResponseCode()!=200)throw new IOException("APK HTTP "+connection.getResponseCode());
            MessageDigest hash=MessageDigest.getInstance("SHA-256");
            long count=0,lastEvent=0;
            try(InputStream in=connection.getInputStream(); FileOutputStream out=new FileOutputStream(tmp)) {
                byte[] buf=new byte[32768]; int length;
                while((length=in.read(buf))!=-1) {
                    if(cancelRequested)throw new InterruptedException("Cancelled");
                    count+=length;
                    if(count>target.size || count>MAX_APK)throw new IOException("APK exceeds declared size");
                    hash.update(buf,0,length);out.write(buf,0,length);
                    long now=android.os.SystemClock.elapsedRealtime();
                    if(now-lastEvent>180) {
                        synchronized(lock){bytes=count;}
                        notifyChanged();lastEvent=now;
                    }
                }
                out.getFD().sync();
            }
            if(cancelRequested)throw new InterruptedException("Cancelled");
            if(count!=target.size || !hex(hash.digest()).equals(target.sha))
                throw new IOException("APK checksum or size mismatch");
            // Do not expose a ready APK until both the Android package and signer match.
            verifyPackage(tmp,target.code);
            if(destination.exists()&&!destination.delete())throw new IOException("Cannot replace cached APK");
            if(!tmp.renameTo(destination))throw new IOException("Cannot finalize APK");
            synchronized(lock){readyFile=destination;stage="ready";bytes=count;error="";}
        } catch(InterruptedException cancelled) {
            synchronized(lock){stage="idle";bytes=0;error="";}
            Thread.currentThread().interrupt();
        } catch(Exception failed) {
            synchronized(lock){stage="failed";error="下载或校验失败，请重试："+failed.getMessage();bytes=0;}
        } finally {
            if(connection!=null)connection.disconnect();
            if(tmp!=null&&tmp.exists())tmp.delete();
            notifyChanged();
        }
    }

    JSONObject cancel() {
        cancelRequested=true;
        return state();
    }

    JSONObject install() throws Exception {
        final File file;
        final Release target;
        synchronized(lock) {
            if(!"ready".equals(stage)||readyFile==null||release==null)
                throw new IOException("No verified APK ready for installation");
            file=readyFile;target=release;
        }
        verify(file,target);
        if(!activity.getPackageManager().canRequestPackageInstalls()) {
            activity.runOnUiThread(()->{
                Intent intent=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:"+activity.getPackageName()));
                try {activity.startActivity(intent);}
                catch(Exception e){ synchronized(lock){error="请到系统设置允许 Easybook 安装应用";}notifyChanged();}
            });
            return new JSONObject().put("needsPermission",true);
        }
        activity.runOnUiThread(()->{
            try {
                Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".files",file);
                Intent intent=new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri,"application/vnd.android.package-archive");
                intent.setClipData(ClipData.newRawUri("Easybook APK",uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(intent);
            } catch(Exception e) {
                synchronized(lock){error="无法打开系统安装器："+e.getClass().getSimpleName();}
                notifyChanged();
            }
        });
        return new JSONObject().put("installStarted",true);
    }

    private static String hex(byte[] bytes) {
        char[] chars="0123456789abcdef".toCharArray();
        StringBuilder result=new StringBuilder(bytes.length*2);
        for(byte b:bytes){int i=b&255;result.append(chars[i>>>4]).append(chars[i&15]);}
        return result.toString();
    }

    private void verify(File file, Release target) throws Exception {
        if(!file.isFile()||file.length()!=target.size)throw new IOException("Incorrect APK size");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){
            byte[] buffer=new byte[32768];int count;
            while((count=in.read(buffer))!=-1)digest.update(buffer,0,count);
        }
        if(!target.sha.equals(hex(digest.digest())))throw new IOException("APK checksum mismatch");
        verifyPackage(file,target.code);
    }

    private static Signature[] signatures(PackageInfo info) {
        if(Build.VERSION.SDK_INT>=28 && info.signingInfo!=null) {
            return info.signingInfo.hasMultipleSigners()
                ? info.signingInfo.getApkContentsSigners()
                : info.signingInfo.getSigningCertificateHistory();
        }
        return info.signatures;
    }

    private void verifyPackage(File file,int expectedCode) throws Exception {
        PackageManager pm=activity.getPackageManager();
        int flags=Build.VERSION.SDK_INT>=28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo apk=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        PackageInfo installed=pm.getPackageInfo(activity.getPackageName(),flags);
        if(apk==null || !activity.getPackageName().equals(apk.packageName))
            throw new SecurityException("APK package name mismatch");
        long code=Build.VERSION.SDK_INT>=28?apk.getLongVersionCode():apk.versionCode;
        if(code!=expectedCode || code<=BuildConfig.VERSION_CODE)
            throw new SecurityException("APK versionCode does not match release");
        Signature[] a=signatures(apk),b=signatures(installed);
        if(a==null||b==null||a.length==0||a.length!=b.length)
            throw new SecurityException("APK signer missing or different");
        boolean[] matched=new boolean[b.length];
        for(Signature sign:a) {
            boolean found=false;
            for(int i=0;i<b.length;i++)
                if(!matched[i]&&Arrays.equals(sign.toByteArray(),b[i].toByteArray())) {
                    matched[i]=true;found=true;break;
                }
            if(!found)throw new SecurityException("APK signer mismatch");
        }
    }

    void shutdown() { cancelRequested=true; downloads.shutdownNow(); }
}
