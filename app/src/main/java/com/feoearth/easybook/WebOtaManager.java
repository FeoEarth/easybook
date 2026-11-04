package com.feoearth.easybook;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Transactional, allowlisted Web-only updates; never replaces the native bridge. */
final class WebOtaManager {
    private static final String ORIGIN="https://easybook.loonxy.com";
    private static final String[] FILES={"index.html","editor.js","native_update.js"};
    private static final String REVISION="[a-f0-9]{16}-[a-f0-9]{16}-[a-f0-9]{16}";
    static final class OtaException extends IOException {
        final String code;
        OtaException(String code,String message){super(message);this.code=code;}
        OtaException(String code,String message,Throwable cause){super(message,cause);this.code=code;}
    }
    private final Context context;
    private final File root;
    private final SharedPreferences prefs;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private volatile File current;
    private String[] bundledHashes;
    WebOtaManager(Context context){
        this.context=context.getApplicationContext();
        root=new File(context.getFilesDir(),"web-ota");
        prefs=context.getSharedPreferences("web-ota",Context.MODE_PRIVATE);
        String revision=prefs.getString("active","");
        // Pre-v2 slots have no updater UI asset. Return to the APK's complete
        // fallback bundle without deleting user data or the old slot on disk.
        if(revision.matches("[a-f0-9]{16}-[a-f0-9]{16}")){
            prefs.edit().remove("active").remove("previous").putBoolean("bootPending",false).commit();
            revision="";
        }
        File slot=new File(root,revision);
        current=revision.matches(REVISION)&&complete(slot)?slot:null;
        // A failed startup must not repeatedly load a broken Web bundle.
        boolean failedBoot=prefs.getBoolean("bootPending",false);
        if(failedBoot)rollback();
        // Restoring a previously working slot must not trigger a second rollback.
        if(current!=null&&!failedBoot)prefs.edit().putBoolean("bootPending",true).apply();
    }
    private static boolean complete(File dir){if(!dir.isDirectory())return false;for(String name:FILES)if(!new File(dir,name).isFile())return false;return true;}
    synchronized String read(String name)throws IOException {
        boolean eligible=false;for(String file:FILES)if(name.equals(file)){eligible=true;break;}
        if(!eligible)throw new IOException("Not OTA eligible");
        File dir=current;
        if(dir==null)return null;
        File file=new File(dir,name);
        if(!file.isFile())throw new IOException("OTA asset missing");
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
            return out.toString("UTF-8");
        }
    }
    void ready(){prefs.edit().putBoolean("bootPending",false).apply();}
    synchronized void rollback(){
        String failed=prefs.getString("active","");
        String previous=prefs.getString("previous","");
        File slot=new File(root,previous);
        current=previous.matches(REVISION)&&complete(slot)?slot:null;
        prefs.edit().putString("active",current==null?"":previous).putString("rejected",failed).remove("previous").putBoolean("bootPending",false).apply();
    }
    void checkAsync(){executor.execute(()->{try{install();}catch(Exception e){android.util.Log.w("EasybookWebOTA","Automatic update skipped",e);}});}
    JSONObject status()throws Exception {
        JSONObject manifest=manifest();return statusFor(manifest);
    }
    private synchronized String[] bundledHashes()throws Exception {
        if(bundledHashes==null){
            String[] hashes=new String[FILES.length];
            for(int i=0;i<FILES.length;i++){
                MessageDigest digest=MessageDigest.getInstance("SHA-256");
                try(InputStream in=FILES[i].equals("native_update.js")
                        ?context.getResources().openRawResource(R.raw.native_update):context.getAssets().open(FILES[i])){
                    byte[] buffer=new byte[8192];int n;
                    while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);
                }
                hashes[i]=hex(digest.digest());
            }
            bundledHashes=hashes;
        }
        return bundledHashes;
    }
    private synchronized JSONObject statusFor(JSONObject manifest)throws Exception {
        String revision=manifest.getString("revision"),active=prefs.getString("active","");
        boolean compatible=manifest.getInt("minNativeVersionCode")<=BuildConfig.VERSION_CODE;
        boolean identical=active.isEmpty()&&bundledMatches(manifest);
        return new JSONObject().put("current",active.isEmpty()?"APK 内置资源":active)
            .put("latest",revision).put("compatible",compatible)
            .put("available",compatible&&!identical&&!revision.equals(active)&&!revision.equals(prefs.getString("rejected","")))
            .put("bundledCurrent",identical)
            .put("pendingRestart",needsRestart());
    }
    synchronized boolean needsRestart(){
        String active=prefs.getString("active","");
        return !active.isEmpty()&&(current==null||!active.equals(current.getName()));
    }
    private boolean bundledMatches(JSONObject manifest)throws Exception {
        String[] hashes=bundledHashes();JSONArray files=manifest.getJSONArray("files");
        for(int i=0;i<FILES.length;i++)if(!hashes[i].equals(files.getJSONObject(i).getString("sha256")))return false;
        return true;
    }
    synchronized JSONObject install()throws Exception {
        JSONObject value=manifest();downloadUpdate(value);
        // Do not turn a successfully committed update into a failure by fetching a second manifest.
        return statusFor(value);
    }
    private static JSONObject manifest()throws Exception {
        JSONObject value=new JSONObject(new String(get("/ota/manifest.json?v=2",4096),StandardCharsets.UTF_8));
        if(value.getInt("schema")!=2||!value.getString("revision").matches(REVISION))throw new OtaException("OTA_MANIFEST","热更新清单格式不正确");
        JSONArray files=value.getJSONArray("files");
        if(files.length()!=FILES.length)throw new OtaException("OTA_MANIFEST","热更新资源清单不完整");
        String[] hashes=new String[FILES.length];
        for(int i=0;i<FILES.length;i++){
            JSONObject entry=files.getJSONObject(i);
            hashes[i]=entry.getString("sha256");
            if(!FILES[i].equals(entry.getString("name"))||!("/ota/"+FILES[i]).equals(entry.getString("url"))||!hashes[i].matches("[a-f0-9]{64}"))
                throw new OtaException("OTA_MANIFEST","热更新资源清单无效");
        }
        if(!value.getString("revision").equals(hashes[0].substring(0,16)+"-"+hashes[1].substring(0,16)+"-"+hashes[2].substring(0,16)))
            throw new OtaException("OTA_MANIFEST","热更新版本指纹不一致");
        return value;
    }
    private static byte[] get(String path,int limit)throws IOException {
        HttpURLConnection c=null;
        try{
            c=(HttpURLConnection)new URL(ORIGIN+path).openConnection();
            c.setConnectTimeout(8000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Accept","application/octet-stream");
            int status=c.getResponseCode();
            if(status!=200)throw new OtaException("OTA_HTTP","热更新服务器返回 HTTP "+status);
            if(c.getContentLengthLong()>limit)throw new OtaException("OTA_SIZE","热更新资源超过大小限制");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new OtaException("OTA_SIZE","热更新资源超过大小限制");out.write(b,0,n);}return out.toByteArray();
            }
        }catch(IOException e){if(e instanceof OtaException)throw e;throw new OtaException("OTA_NETWORK","热更新资源下载中断或超时（"+path+"）",e);}
        finally{if(c!=null)c.disconnect();}
    }
    private static String hex(byte[] digest){StringBuilder b=new StringBuilder(64);
        for(byte value:digest)b.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return b.toString();
    }
    private static String sha256(byte[] bytes)throws Exception {return hex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private void downloadUpdate(JSONObject manifest)throws Exception {
        if(manifest.getInt("schema")!=2||manifest.getInt("minNativeVersionCode")>BuildConfig.VERSION_CODE)return;
        String revision=manifest.getString("revision");
        String active=prefs.getString("active","");
        if((active.isEmpty()&&bundledMatches(manifest))||revision.equals(active)||revision.equals(prefs.getString("rejected","")))return;
        JSONArray entries=manifest.getJSONArray("files");
        Map<String,byte[]> bytes=new HashMap<>();
        for(int i=0;i<entries.length();i++){
            JSONObject entry=entries.getJSONObject(i);String name=entry.getString("name"),path=entry.getString("url");
            byte[] data=get(path,name.equals("index.html")?4_000_000:name.equals("editor.js")?8_000_000:1_000_000);
            if(!sha256(data).equals(entry.getString("sha256")))throw new OtaException("OTA_CHECKSUM","热更新资源 SHA-256 校验失败（"+name+"）");
            bytes.put(name,data);
        }
        File slot=new File(root,revision);
        if(!slot.isDirectory()&&!slot.mkdirs())throw new OtaException("OTA_STORAGE","无法创建热更新存储目录");
        for(String name:FILES){File target=new File(slot,name),tmp=new File(slot,name+".tmp");
            try(FileOutputStream out=new FileOutputStream(tmp)){out.write(bytes.get(name));out.getFD().sync();}
            catch(IOException e){throw new OtaException("OTA_STORAGE","无法保存热更新资源（"+name+"）",e);}
            if(!tmp.renameTo(target))throw new OtaException("OTA_STORAGE","无法完成热更新文件写入（"+name+"）");
        }
        if(!complete(slot))throw new OtaException("OTA_STORAGE","热更新资源保存不完整");
        // Activate on the next process start; never reload an in-progress editor.
        if(!prefs.edit().putString("previous",prefs.getString("active","")).putString("active",revision).commit())
            throw new OtaException("OTA_STORAGE","无法保存热更新激活状态");
    }
}
