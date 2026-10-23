package com.feoearth.easybook;

import org.json.*;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** HTTP runs off the UI/database executor. No caller may supply a host, URL or headers. */
public final class NativeSync {
    public interface Transport { JSONObject request(String path,JSONObject body,String key)throws Exception; }
    public static final class HttpsTransport implements Transport {
        private final DataProtection protection;
        public HttpsTransport(DataProtection p){protection=p;}
        public JSONObject request(String path,JSONObject body,String key)throws Exception{
            if(!path.matches("/api/(notes|folders)(/[a-f0-9-]{36})?(\\?after=[a-f0-9-]{36})?"))throw new IllegalArgumentException("Invalid API path");
            HttpsURLConnection c=(HttpsURLConnection)new URL("https://easybook-sync.1902521952.workers.dev"+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestMethod(body==null?"GET":"PUT");c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Content-Type","application/json");
            try{if(body!=null){byte[] b=protection.encodeTransport(body.toString()).getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){out.write(b);}}
                int status=c.getResponseCode();if(status!=200&&status!=409)throw new IOException("Sync HTTP "+status);
                try(InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    if(in==null)throw new IOException("Missing response");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>32*1024*1024)throw new IOException("Response too large");out.write(b,0,n);}return new JSONObject(protection.decodeTransport(out.toString("UTF-8"))).put("httpStatus",status);
                }
            }finally{c.disconnect();}
        }
    }
    private final NoteRepository db;private final Transport transport;
    public NativeSync(NoteRepository db,Transport transport){this.db=db;this.transport=transport;}
    public JSONObject run(String key)throws Exception{
        NoteRepository.key(key);int conflicts=0;JSONObject mappings=new JSONObject();
        JSONArray fs=db.rows(key,"folder");for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);if(f.optBoolean("dirty"))db.acknowledgeFolder(key,transport.request("/api/folders/"+f.getString("id"),new JSONObject().put("name",f.getString("name")),key).getJSONObject("folder"));}
        String after="";Set<String> seen=new HashSet<>();do{JSONObject res=transport.request("/api/folders"+(after.isEmpty()?"":"?after="+after),null,key);JSONArray rows=res.getJSONArray("folders");for(int i=0;i<rows.length();i++)db.mergeFolder(key,rows.getJSONObject(i));after=res.isNull("next")?"":res.optString("next","");if(!after.isEmpty()&&!seen.add(after))throw new IOException("Invalid folder pagination");}while(!after.isEmpty());
        JSONArray ns=db.rows(key,"note");for(int i=0;i<ns.length();i++){JSONObject n=ns.getJSONObject(i);if(!n.optBoolean("dirty"))continue;JSONObject sent=NoteRepository.copy(n);sent.remove("_rev");JSONObject res=transport.request("/api/notes/"+n.getString("id"),sent,key);int status=res.optInt("httpStatus",200);if(status==409)conflicts++;String copy=db.syncResult(key,sent,res,status);if(!copy.isEmpty())mappings.put(sent.getString("id"),copy);}
        after="";seen.clear();do{JSONObject res=transport.request("/api/notes"+(after.isEmpty()?"":"?after="+after),null,key);JSONArray rows=res.getJSONArray("notes");for(int i=0;i<rows.length();i++)db.mergeNote(key,rows.getJSONObject(i));after=res.isNull("next")?"":res.optString("next","");if(!after.isEmpty()&&!seen.add(after))throw new IOException("Invalid note pagination");}while(!after.isEmpty());
        return db.snapshot(key).put("conflicts",conflicts).put("mappings",mappings);
    }
}
