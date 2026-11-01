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
    private static final String[] FILES={"index.html","editor.js"};
    private final File root;
    private final SharedPreferences prefs;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private volatile File current;
    WebOtaManager(Context context){
        root=new File(context.getFilesDir(),"web-ota");
        prefs=context.getSharedPreferences("web-ota",Context.MODE_PRIVATE);
        String revision=prefs.getString("active","");
        File slot=new File(root,revision);
        current=revision.matches("[a-f0-9]{16}-[a-f0-9]{16}")&&complete(slot)?slot:null;
        // A failed startup must not repeatedly load a broken Web bundle.
        if(prefs.getBoolean("bootPending",false))rollback();
        if(current!=null)prefs.edit().putBoolean("bootPending",true).apply();
    }
    private static boolean complete(File dir){return dir.isDirectory()&&new File(dir,FILES[0]).isFile()&&new File(dir,FILES[1]).isFile();}
    synchronized String read(String name)throws IOException {
        if(!name.equals(FILES[0])&&!name.equals(FILES[1]))throw new IOException("Not OTA eligible");
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
        String previous=prefs.getString("previous","");
        File slot=new File(root,previous);
        current=previous.matches("[a-f0-9]{16}-[a-f0-9]{16}")&&complete(slot)?slot:null;
        prefs.edit().putString("active",current==null?"":previous).remove("previous").putBoolean("bootPending",false).apply();
    }
    void checkAsync(){executor.execute(()->{try{downloadUpdate();}catch(Exception e){android.util.Log.w("EasybookWebOTA","Update skipped: "+e.getClass().getSimpleName());}});}
    private static byte[] get(String path,int limit)throws IOException {
        HttpURLConnection c=(HttpURLConnection)new URL(ORIGIN+path).openConnection();
        c.setConnectTimeout(8000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Accept","application/octet-stream");
        try{
            if(c.getResponseCode()!=200||c.getContentLengthLong()>limit)throw new IOException("OTA HTTP/size");
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("OTA too large");out.write(b,0,n);}return out.toByteArray();
            }
        }finally{c.disconnect();}
    }
    private static String sha256(byte[] bytes)throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder b=new StringBuilder(64);
        for(byte value:digest)b.append(String.format(java.util.Locale.ROOT,"%02x",value&255));return b.toString();
    }
    private void downloadUpdate()throws Exception {
        JSONObject manifest=new JSONObject(new String(get("/ota/manifest.json",4096),StandardCharsets.UTF_8));
        if(manifest.getInt("schema")!=1||manifest.getInt("minNativeVersionCode")>BuildConfig.VERSION_CODE)return;
        String revision=manifest.getString("revision");
        if(!revision.matches("[a-f0-9]{16}-[a-f0-9]{16}")||revision.equals(prefs.getString("active","")))return;
        JSONArray entries=manifest.getJSONArray("files");if(entries.length()!=FILES.length)return;
        Map<String,byte[]> bytes=new HashMap<>();
        for(int i=0;i<entries.length();i++){
            JSONObject entry=entries.getJSONObject(i);String name=entry.getString("name"),path=entry.getString("url");
            if(!name.equals(FILES[i])||!path.equals("/ota/"+name))return;
            byte[] data=get(path,name.equals("index.html")?4_000_000:8_000_000);
            if(!sha256(data).equals(entry.getString("sha256")))throw new IOException("OTA digest mismatch");
            bytes.put(name,data);
        }
        File slot=new File(root,revision);
        if(!slot.isDirectory()&&!slot.mkdirs())throw new IOException("OTA directory");
        for(String name:FILES){File target=new File(slot,name),tmp=new File(slot,name+".tmp");
            try(FileOutputStream out=new FileOutputStream(tmp)){out.write(bytes.get(name));out.getFD().sync();}
            if(!tmp.renameTo(target))throw new IOException("OTA rename");
        }
        if(!complete(slot))throw new IOException("OTA incomplete");
        // Activate on the next process start; never reload an in-progress editor.
        prefs.edit().putString("previous",prefs.getString("active","")).putString("active",revision).apply();
    }
}
