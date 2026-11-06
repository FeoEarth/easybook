package com.feoearth.easybook;

import android.app.ActivityManager;
import android.app.DownloadManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Optional, user-initiated LiteRT-LM downloads. No model bytes are shipped in the APK. */
final class LocalAiModels {
    static final class Model {
        final String id, title, file, repository, sha256, description;
        final long estimatedBytes, recommendedRam;
        Model(String id,String title,String file,String repository,String hash,String description,long size,long ram){
            this.id=id;this.title=title;this.file=file;this.repository=repository;this.sha256=hash;this.description=description;estimatedBytes=size;recommendedRam=ram;
        }
        String url(){return "https://huggingface.co/"+repository+"/resolve/main/"+file;}
    }
    // SHA-256s are the published artifact digests; an upstream replacement fails closed.
    private static final Model[] CATALOG={
        new Model("qwen3-06b","Qwen3 0.6B","Qwen3-0.6B.litertlm","litert-community/Qwen3-0.6B","c5f39b4191926786c3e6668b62af4d6eb15248dfc7a5348252a9b406f33f2108","轻量中文文本 · 约 614 MB",614236160L,6L<<30),
        new Model("gemma4-e2b","Gemma 4 E2B","gemma-4-E2B-it.litertlm","litert-community/gemma-4-E2B-it-litert-lm","181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c","推荐 · 约 2.59 GB",2590000000L,8L<<30),
        new Model("gemma4-e4b","Gemma 4 E4B","gemma-4-E4B-it.litertlm","litert-community/gemma-4-E4B-it-litert-lm","0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0","高性能设备 · 约 3.66 GB",3660000000L,12L<<30)
    };
    private final Context context;
    private final SharedPreferences prefs;
    private final DownloadManager downloads;
    private final ExecutorService verifier=Executors.newSingleThreadExecutor();
    private final File directory;
    private final java.util.Set<String> verifying=java.util.Collections.synchronizedSet(new java.util.HashSet<>());
    LocalAiModels(Context context){
        this.context=context.getApplicationContext();
        prefs=this.context.getSharedPreferences("easybook-local-ai-v1",Context.MODE_PRIVATE);
        downloads=(DownloadManager)this.context.getSystemService(Context.DOWNLOAD_SERVICE);
        File base=this.context.getExternalFilesDir(null);
        directory=base==null?null:new File(base,"models");
    }
    static Model find(String id){for(Model model:CATALOG)if(model.id.equals(id))return model;throw new IllegalArgumentException("Unknown local AI model");}
    private File path(Model m){if(directory==null)throw new IllegalStateException("模型存储目录不可用");return new File(directory,m.id+".litertlm");}
    private File partial(Model m){if(directory==null)throw new IllegalStateException("模型存储目录不可用");return new File(directory,m.id+".download");}
    boolean installed(String id){Model model=find(id);try{return path(model).isFile()&&path(model).length()>model.estimatedBytes*9/10&&model.sha256.equals(prefs.getString("verified:"+id,""));}catch(Exception e){return false;}}
    File installedPath(String id){if(!installed(id))throw new IllegalStateException("请先下载并验证本地模型");return path(find(id));}
    private long downloadId(Model m){return prefs.getLong("download:"+m.id,-1);}
    private JSONObject state(Model model)throws Exception{
        JSONObject item=new JSONObject().put("id",model.id).put("title",model.title).put("description",model.description).put("estimatedBytes",model.estimatedBytes).put("recommendedRam",model.recommendedRam);
        if(installed(model.id))return item.put("state","installed").put("bytes",path(model).length());
        if(verifying.contains(model.id))return item.put("state","verifying");
        long id=downloadId(model);
        if(id<0)return item.put("state","missing");
        try(Cursor cursor=downloads.query(new DownloadManager.Query().setFilterById(id))){
            if(cursor!=null&&cursor.moveToFirst()){
                int status=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if(status==DownloadManager.STATUS_SUCCESSFUL){verifyAsync(model);return item.put("state","verifying");}
                if(status==DownloadManager.STATUS_FAILED)return item.put("state","failed").put("reason",cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));
                if(status==DownloadManager.STATUS_PAUSED&&cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))==DownloadManager.PAUSED_QUEUED_FOR_WIFI)
                    return item.put("state","wifiOnly");
                return item.put("state","downloading")
                    .put("bytes",cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    .put("totalBytes",cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            }
        }
        return item.put("state","missing");
    }
    JSONObject status()throws Exception{
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();
        ((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        boolean arm64=false;for(String abi:Build.SUPPORTED_64_BIT_ABIS)if("arm64-v8a".equals(abi))arm64=true;
        ConnectivityManager connectivity=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        JSONObject result=new JSONObject().put("available",arm64&&directory!=null).put("ramBytes",memory.totalMem)
            .put("freeBytes",directory==null?0:new StatFs(directory.getParent()).getAvailableBytes())
            .put("meteredNetwork",connectivity!=null&&connectivity.isActiveNetworkMetered()).put("cellularDownloads",true);
        JSONArray models=new JSONArray();for(Model model:CATALOG)models.put(state(model));return result.put("models",models);
    }
    JSONObject install(String id)throws Exception{
        Model model=find(id);if(directory==null||!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建模型存储目录");
        if(installed(id))return status();
        long current=downloadId(model);
        if(current>=0){try(Cursor cursor=downloads.query(new DownloadManager.Query().setFilterById(current))){if(cursor!=null&&cursor.moveToFirst()){
            int status=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            boolean wifiOnly=status==DownloadManager.STATUS_PAUSED&&cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))==DownloadManager.PAUSED_QUEUED_FOR_WIFI;
            if(status!=DownloadManager.STATUS_FAILED&&!wifiOnly)return status();
        }}}
        if(new StatFs(directory.getPath()).getAvailableBytes()<model.estimatedBytes+512L*1024*1024)throw new IOException("可用空间不足，请预留模型大小加 512 MB");
        cancel(id);
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(model.url()));
        request.setTitle("Easybook · "+model.title).setDescription("离线 AI 模型，仅在用户确认后下载")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            // Explicit user action permits cellular/metered downloads; roaming stays blocked.
            .setAllowedOverMetered(true).setAllowedOverRoaming(false)
            .setDestinationUri(Uri.fromFile(partial(model)));
        prefs.edit().putLong("download:"+id,downloads.enqueue(request)).remove("failure:"+id).apply();
        return status();
    }
    void cancel(String id)throws Exception{
        Model model=find(id);long download=downloadId(model);if(download>=0)downloads.remove(download);
        prefs.edit().remove("download:"+id).apply();
        File part=partial(model);if(part.exists()&&!part.delete())throw new IOException("未能清除下载中的模型");
    }
    void delete(String id)throws Exception{
        Model model=find(id);if(verifying.contains(id))throw new IllegalStateException("模型正在校验，请稍后重试");
        cancel(id);File file=path(model);
        if(file.exists()&&!file.delete())throw new IOException("模型文件删除失败");
        prefs.edit().remove("verified:"+id).apply();
    }
    private void verifyAsync(Model model){
        if(!verifying.add(model.id))return;
        verifier.execute(()->{
            try{
                File file=partial(model);
                if(!file.isFile()||file.length()<model.estimatedBytes*9/10)throw new IOException("模型文件不完整");
                MessageDigest sha=MessageDigest.getInstance("SHA-256");
                try(FileInputStream in=new FileInputStream(file)){byte[] buffer=new byte[1024*1024];int length;while((length=in.read(buffer))!=-1)sha.update(buffer,0,length);}
                StringBuilder hash=new StringBuilder();for(byte b:sha.digest())hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
                if(!model.sha256.equals(hash.toString()))throw new IOException("SHA-256 校验失败：上游模型文件已变化");
                File finalFile=path(model);
                if(finalFile.exists()&&!finalFile.delete())throw new IOException("模型更新失败");
                if(!file.renameTo(finalFile))throw new IOException("模型安装失败");
                prefs.edit().putString("verified:"+model.id,model.sha256).remove("download:"+model.id).remove("failure:"+model.id).apply();
            }catch(Exception error){
                prefs.edit().putString("failure:"+model.id,error.getMessage()==null?"校验失败":error.getMessage()).remove("download:"+model.id).apply();
                File part=partial(model);if(part.exists())part.delete();
            }finally{verifying.remove(model.id);}
        });
    }
    JSONObject errors()throws Exception{
        JSONObject value=new JSONObject();for(Model model:CATALOG){String error=prefs.getString("failure:"+model.id,"");if(!error.isEmpty())value.put(model.id,error);}return value;
    }
    void shutdown(){verifier.shutdown();}
}
