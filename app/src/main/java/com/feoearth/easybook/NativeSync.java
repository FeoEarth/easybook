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
        interface Progress {void update(long loaded,long total);}
        Progress progress;private final DataProtection protection;
        public HttpsTransport(DataProtection p){protection=p;}
        public JSONObject request(String path,JSONObject body,String key)throws Exception{
            if(!path.equals("/api/management")&&!path.matches("/api/attachments/[a-f0-9]{64}")&&!path.matches("/api/(notes|folders)(/[a-f0-9-]{36})?(\\?(after=[a-f0-9-]{36}|cursor=[0-9]{1,15}))?"))throw new IllegalArgumentException("Invalid API path");
            HttpsURLConnection c=(HttpsURLConnection)new URL("https://easybook-sync.1902521952.workers.dev"+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestMethod(body==null?"GET":"PUT");c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Content-Type","application/json");
            try{if(body!=null){byte[] b=protection.encodeTransport(body.toString()).getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){for(int pos=0;pos<b.length;pos+=8192){int count=Math.min(8192,b.length-pos);out.write(b,pos,count);if(progress!=null)progress.update(pos+count,b.length);}}}
                int status=c.getResponseCode();if(status!=200&&status!=409&&!(path.equals("/api/management")&&body!=null&&(status==400||status==413||status==422)))throw new IOException("Sync HTTP "+status);
                try(InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    if(in==null)throw new IOException("Missing response");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>32*1024*1024)throw new IOException("Response too large");out.write(b,0,n);if(progress!=null&&body==null)progress.update(out.size(),c.getContentLengthLong());}return new JSONObject(protection.decodeTransport(out.toString("UTF-8"))).put("httpStatus",status);
                }
            }finally{c.disconnect();}
        }
    }
    private final NoteRepository db;private final Transport transport;
    public NativeSync(NoteRepository db,Transport transport){this.db=db;this.transport=transport;}
    public JSONObject run(String key)throws Exception{return run(key,false);}
    public JSONObject run(String key,boolean manual)throws Exception{if(manual)db.retryPlacements(key);SyncJournal journal=new SyncJournal(db,key);try{return runInternal(key,journal);}catch(Exception e){journal.failRunning();throw e;}}
    private JSONObject runInternal(String key,SyncJournal journal)throws Exception{
        NoteRepository.key(key);String credential=key.startsWith("space:")?db.credential(key):key;int conflicts=0;JSONObject mappings=new JSONObject();
        JSONArray fs=db.rows(key,"folder");for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);if(f.optBoolean("dirty")){JSONObject ack=journal.request(transport,"/api/folders/"+f.getString("id"),new JSONObject().put("name",f.getString("name")).put("updated",f.optLong("updated")).put("deleted",f.optInt("deleted")),credential);db.acknowledgeFolder(key,ack.getJSONObject("folder"));journal.complete(ack.optString("_activityId"),"done");}}
        String after="";Set<String> seen=new HashSet<>();do{JSONObject res=journal.request(transport,"/api/folders"+(after.isEmpty()?"":"?after="+after),null,credential);JSONArray rows=res.getJSONArray("folders");for(int i=0;i<rows.length();i++)db.mergeFolder(key,rows.getJSONObject(i));after=res.isNull("next")?"":res.optString("next","");if(!after.isEmpty()&&!seen.add(after))throw new IOException("Invalid folder pagination");journal.complete(res.optString("_activityId"),"done");}while(!after.isEmpty());
        JSONObject remoteLayout=transport.request("/api/management",null,credential);db.mergeManagement(key,remoteLayout.getJSONObject("management"),"","");
        // Bound retries per run; pending operations survive offline/failure/CAS conflicts.
        JSONArray placementQueue=db.management(key).getJSONArray("pending");for(int i=0;i<placementQueue.length();i++){JSONObject op=placementQueue.getJSONObject(i);if(op.optBoolean("blocked")||op.optLong("retryAfter")>System.currentTimeMillis())continue;for(int attempt=0;attempt<2;attempt++){try{JSONObject sent=new JSONObject().put("version",db.management(key).getLong("version")).put("op",FolderPlacement.wire(op));JSONObject ack=transport.request("/api/management",sent,credential);int status=ack.optInt("httpStatus",200);boolean accepted=ack.optBoolean("accepted"),rejected=ack.optBoolean("rejected")||status==400||status==413||status==422;db.mergeManagement(key,ack.optJSONObject("management"),accepted?op.getString("id"):"",rejected?op.getString("id"):"",status==409?"conflict":"invalid");if(accepted||rejected)break;if(attempt==1)db.placementFailure(key,op.getString("id"));}catch(Exception failure){db.placementFailure(key,op.getString("id"));break;}}}
        JSONArray files=db.rows(key,"attachment");for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);if(f.optBoolean("dirty")){JSONObject sent=db.attachments.payload(key,f.getString("id"));JSONObject ack=journal.request(transport,"/api/attachments/"+f.getString("id"),sent,credential);if(!ack.getString("id").equals(f.getString("id"))||ack.getLong("size")!=f.getLong("size"))throw new IOException("Invalid attachment acknowledgement");db.saveAttachment(key,new JSONObject(f.toString()).put("dirty",false));journal.complete(ack.optString("_activityId"),"done");}}
        JSONArray ns=db.rows(key,"note");for(int i=0;i<ns.length();i++){JSONObject n=ns.getJSONObject(i);if(!n.optBoolean("dirty"))continue;JSONObject sent=db.pending(key,n);JSONObject res=journal.request(transport,"/api/notes/"+n.getString("id"),sent,credential);int status=res.optInt("httpStatus",200);if(status==409)conflicts++;String copy=db.syncResult(key,sent,res,status);if(!copy.isEmpty())mappings.put(sent.getString("id"),copy);journal.complete(res.optString("_activityId"),status==409?"conflict":"done");}
        long cursor=db.cursor(key);boolean more;do{JSONObject res=journal.request(transport,"/api/notes?cursor="+cursor,null,credential);long next=res.getLong("cursor");more=res.getBoolean("hasMore");if(next<cursor||(more&&next==cursor))throw new IOException("Invalid cursor");JSONArray received=res.getJSONArray("notes");int downloaded=0;for(int i=0;i<received.length();i++){JSONObject remote=received.getJSONObject(i),local=db.row(key,"note",remote.getString("id"));if(local==null||!local.optBoolean("dirty")&&remote.getLong("version")>local.optLong("version"))downloaded++;}db.mergePage(key,received,next);cursor=next;journal.completeCheck(res.optString("_activityId"),downloaded);}while(more);
        Set<String> refs=new HashSet<>();JSONArray all=db.rows(key,"note");for(int i=0;i<all.length();i++)refs.addAll(DocumentModel.assets(all.getJSONObject(i).getJSONObject("document")));for(String id:refs)if(db.row(key,"attachment",id)==null){JSONObject remote=journal.request(transport,"/api/attachments/"+id,null,credential);db.attachments.accept(key,id,remote);journal.complete(remote.optString("_activityId"),"done");}
        return db.snapshot(key).put("conflicts",conflicts).put("mappings",mappings);
    }
}




