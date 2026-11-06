package com.feoearth.easybook;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** User-initiated, version-pinned native runtime. Never executes unverified downloads. */
final class LocalAiRuntime {
    private static final String ABI="arm64-v8a";
    private static final String FILE="liblitertlm_jni.so";
    private static final String ASSET="Easybook-LiteRT-LM-arm64-v8a.so";
    // Exact bytes from Google's LiteRT-LM 0.18.0 Android AAR (not a mutable URL digest).
    private static final String SHA256="4a94a3f955ad7c58cbcdfc5cb4ff566187bb9e8c5bc2c4056b4e226646c7e8fd";
    private static final long BYTES=22155680L;
    private final Context context;
    private final SharedPreferences prefs;
    private final DownloadManager downloads;
    private final File directory, temporary;
    private final ExecutorService verifier=Executors.newSingleThreadExecutor();
    private final AtomicBoolean verifying=new AtomicBoolean();
    private volatile boolean loaded;
    LocalAiRuntime(Context context){
        this.context=context.getApplicationContext();
        prefs=this.context.getSharedPreferences("easybook-ai-runtime-v1",Context.MODE_PRIVATE);
        downloads=(DownloadManager)this.context.getSystemService(Context.DOWNLOAD_SERVICE);
        directory=this.context.getDir("ai_runtime",Context.MODE_PRIVATE);
        File external=this.context.getExternalFilesDir(null);
        temporary=external==null?null:new File(external,"litertlm-runtime.download");
    }
    private File installedFile(){return new File(directory,FILE);}
    private boolean supported(){for(String abi:Build.SUPPORTED_ABIS)if(ABI.equals(abi))return true;return false;}
    private long downloadId(){return prefs.getLong("download",-1);}
    boolean installed(){File file=installedFile();return file.isFile()&&file.length()==BYTES&&SHA256.equals(prefs.getString("verified",""))&&!file.canWrite();}
    JSONObject status()throws Exception{
        JSONObject result=new JSONObject().put("supported",supported()).put("installed",installed())
            .put("estimatedBytes",BYTES).put("version","LiteRT-LM 0.18.0")
            .put("availableBytes",new StatFs(directory.getPath()).getAvailableBytes());
        if(loaded&&!installed())return result.put("state","missing").put("restartRequired",true);
        if(loaded)return result.put("state","installed");
        if(installed())return result.put("state","installed");
        if(verifying.get())return result.put("state","verifying");
        String error=prefs.getString("failure","");
        long id=downloadId();
        if(id>=0)try(Cursor c=downloads.query(new DownloadManager.Query().setFilterById(id))){
            if(c!=null&&c.moveToFirst()){
                int state=c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if(state==DownloadManager.STATUS_SUCCESSFUL){verifyAsync();return result.put("state","verifying");}
                if(state==DownloadManager.STATUS_FAILED)return result.put("state","failed").put("error","下载失败（"+c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))+"）");
                if(state==DownloadManager.STATUS_PAUSED&&c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))==DownloadManager.PAUSED_QUEUED_FOR_WIFI)
                    return result.put("state","wifiOnly");
                return result.put("state","downloading")
                    .put("bytes",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    .put("totalBytes",c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            }
        }
        return result.put("state",error.isEmpty()?"missing":"failed").put("error",error);
    }
    JSONObject install()throws Exception{
        if(!supported())throw new IllegalStateException("端侧推理组件需要 ARM64 设备");
        if(installed())return status();
        if(temporary==null)throw new IOException("组件下载目录不可用");
        if(BuildConfig.LOCAL_AI_RUNTIME_TAG.isEmpty())throw new IllegalStateException("请使用正式发行版安装端侧 AI 运行组件");
        if(verifying.get())return status();
        long existing=downloadId();
        if(existing>=0)try(Cursor c=downloads.query(new DownloadManager.Query().setFilterById(existing))){
            if(c!=null&&c.moveToFirst()){
                int state=c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                boolean wifiOnly=state==DownloadManager.STATUS_PAUSED&&c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))==DownloadManager.PAUSED_QUEUED_FOR_WIFI;
                if(state!=DownloadManager.STATUS_FAILED&&!wifiOnly)return status();
            }
        }
        if(new StatFs(directory.getPath()).getAvailableBytes()<BYTES*3)throw new IOException("存储空间不足，请至少预留 65 MB");
        cancel();
        String url="https://github.com/FeoEarth/easybook/releases/download/"+BuildConfig.LOCAL_AI_RUNTIME_TAG+"/"+ASSET;
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url));
        request.setTitle("Easybook · 本地 AI 运行组件").setDescription("LiteRT-LM 0.18.0 · ARM64")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            // Explicit user action permits cellular/metered downloads; roaming stays blocked.
            .setAllowedOverMetered(true).setAllowedOverRoaming(false)
            .setDestinationUri(Uri.fromFile(temporary));
        prefs.edit().putLong("download",downloads.enqueue(request)).remove("failure").apply();
        return status();
    }
    void cancel()throws IOException{
        long id=downloadId();if(id>=0)downloads.remove(id);
        prefs.edit().remove("download").apply();
        if(temporary!=null&&temporary.exists()&&!temporary.delete())throw new IOException("下载临时文件无法删除");
    }
    void delete()throws IOException{
        if(verifying.get())throw new IllegalStateException("运行组件正在校验");
        cancel();
        File file=installedFile();if(file.exists()&&!file.delete())throw new IOException("运行组件删除失败");
        prefs.edit().remove("verified").remove("failure").apply();
        // Already mapped native code stays resident until the process exits.
    }
    private void verifyAsync(){
        if(!verifying.compareAndSet(false,true))return;
        verifier.execute(()->{
            File staging=new File(directory,"runtime.tmp");
            try{
                if(temporary==null||!temporary.isFile()||temporary.length()!=BYTES||!SHA256.equals(sha256(temporary)))throw new IOException("运行组件 SHA-256 校验失败");
                // Copy into private internal storage, fsync, then make read-only before exposing it.
                try(FileInputStream in=new FileInputStream(temporary);FileOutputStream out=new FileOutputStream(staging)){
                    byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);out.getFD().sync();
                }
                if(!SHA256.equals(sha256(staging)))throw new IOException("运行组件安装校验失败");
                if(!staging.setReadable(true,true)||!staging.setExecutable(true,true)||!staging.setWritable(false,false))throw new IOException("运行组件权限设置失败");
                File target=installedFile();if(target.exists()&&!target.delete())throw new IOException("旧运行组件无法替换");
                if(!staging.renameTo(target))throw new IOException("运行组件安装失败");
                prefs.edit().putString("verified",SHA256).remove("download").remove("failure").apply();
                temporary.delete();
            }catch(Exception e){
                prefs.edit().remove("verified").remove("download").putString("failure",e.getMessage()==null?"组件校验失败":e.getMessage()).apply();
                if(temporary!=null)temporary.delete();
            }finally{staging.delete();verifying.set(false);}
        });
    }
    synchronized void load(){
        if(loaded)return;
        if(!installed())throw new IllegalStateException("请先安装本地 AI 运行组件");
        try{
            if(!SHA256.equals(sha256(installedFile())))throw new IOException("运行组件内容已变化，请删除后重新安装");
            System.load(installedFile().getAbsolutePath());
            loaded=true;
        }catch(IOException|UnsatisfiedLinkError|SecurityException e){
            throw new IllegalStateException("本地推理组件无法加载（可能受 Android 安全限制）："+e.getMessage(),e);
        }
    }
    private static String sha256(File file)throws IOException{
        try{
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            try(FileInputStream in=new FileInputStream(file)){byte[] buffer=new byte[1024*1024];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));return hash.toString();
        }catch(java.security.NoSuchAlgorithmException e){throw new IOException(e);}
    }
    void shutdown(){verifier.shutdown();}
}
