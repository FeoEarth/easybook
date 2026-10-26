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
        static final class HttpFailure extends IOException {final int status;HttpFailure(int value){super("Sync HTTP "+value);status=value;}}
        interface Progress {void update(long loaded,long total);}
        Progress progress;long deadline=Long.MAX_VALUE;private final DataProtection protection;
        public HttpsTransport(DataProtection p){protection=p;}
        public JSONObject request(String path,JSONObject body,String key)throws Exception{
            if(Thread.currentThread().isInterrupted()||System.nanoTime()>deadline)throw new java.io.InterruptedIOException("Sync cancelled or deadline reached");
            if(!path.equals("/api/workspaces")&&!path.matches("/api/notes\\?cursor=[0-9]{1,15}&scope=(?:none|[a-f0-9%,-]+)")&&!path.equals("/api/management")&&!path.matches("/api/attachments/[a-f0-9]{64}(\\?part=[0-9]{1,2})?")&&!path.matches("/api/(notes|folders)(/[a-f0-9-]{36})?(\\?(after=[a-f0-9-]{36}|cursor=[0-9]{1,15}))?"))throw new IllegalArgumentException("Invalid API path");
            HttpsURLConnection c=(HttpsURLConnection)new URL("https://easybook.loonxy.com"+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestMethod(body==null?"GET":"PUT");c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Content-Type","application/json");
            try{if(body!=null){byte[] b=protection.encodeTransport(body.toString()).getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){for(int pos=0;pos<b.length;pos+=8192){int count=Math.min(8192,b.length-pos);out.write(b,pos,count);if(progress!=null)progress.update(pos+count,b.length);}}}
                int status=c.getResponseCode();if(status!=200&&status!=409&&!(path.equals("/api/management")&&body!=null&&(status==400||status==413||status==422)))throw new HttpFailure(status);
                try(InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    if(in==null)throw new IOException("Missing response");byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>32*1024*1024)throw new IOException("Response too large");out.write(b,0,n);if(progress!=null&&body==null)progress.update(out.size(),c.getContentLengthLong());}if(Thread.currentThread().isInterrupted()||System.nanoTime()>deadline)throw new java.io.InterruptedIOException("Sync cancelled or deadline reached");return new JSONObject(protection.decodeTransport(out.toString("UTF-8"))).put("httpStatus",status);
                }
            }finally{c.disconnect();}
        }
    }
    static JSONObject lookupWorkspace(String credential)throws Exception{
        try{JSONObject response=new HttpsTransport(new DataProtection.Plaintext()).request("/api/workspaces",null,credential);JSONArray entries=response.getJSONArray("workspaces");if(entries.length()!=1)throw new SecurityException("Invalid workspace identity");JSONObject identity=entries.getJSONObject(0);if(!identity.optString("id").matches("[a-f0-9]{64}")||!identity.optString("mode").equals("personal"))throw new SecurityException("Invalid key workspace");return identity;}
        catch(HttpsTransport.HttpFailure e){if(e.status==404)return null;throw e;}
    }
    private final NoteRepository db;private final Transport transport;
    public NativeSync(NoteRepository db,Transport transport){this.db=db;this.transport=transport;}
    public JSONObject run(String key)throws Exception{return run(key,false);}
    private static final Set<String> RUNNING=new HashSet<>();
    public static boolean isRunning(String key){synchronized(RUNNING){return RUNNING.contains(NoteRepository.spaceId(key));}}
    static JSONObject configure(NoteRepository db,String key,JSONObject policy)throws Exception{synchronized(RUNNING){if(isRunning(key))throw new IllegalStateException("Sync running");return SyncPolicy.save(db,key,policy);}}
    public JSONObject run(String key,boolean manual)throws Exception{
        String ref=NoteRepository.spaceId(key),runtime="sync-runtime:"+ref;JSONObject state;
        synchronized(RUNNING){
            if(RUNNING.contains(ref))return db.snapshot(key).put("coalesced",true);
            JSONObject policy=SyncPolicy.read(db,key);state=new JSONObject(db.setting(runtime,"{}"));
            String paused=!SyncPolicy.network(policy)?"network":!manual&&(policy.optBoolean("paused")||!policy.optBoolean("autoChange")&&policy.optLong("interval")==0)?"paused":!manual&&state.optLong("retryAt")>System.currentTimeMillis()?"retry":"";
            if(!paused.isEmpty())return db.snapshot(key).put("syncPaused",paused);
            if(!manual&&System.currentTimeMillis()-state.optLong("finished")<2000)return db.snapshot(key).put("coalesced",true);RUNNING.add(ref);
        }
        SyncJournal journal=new SyncJournal(db,key);
        try{if(transport instanceof HttpsTransport){JSONObject identity=lookupWorkspace(key.startsWith("space:")?db.credential(key):key);if(identity!=null)db.bindWorkspaceIdentity(key,identity);}state.put("state","running").put("started",System.currentTimeMillis());db.setSetting(runtime,state.toString());if(transport instanceof HttpsTransport)((HttpsTransport)transport).deadline=System.nanoTime()+1800000000000L;if(manual)db.retryPlacements(key);JSONObject result=runInternal(key,journal);journal.finishRunning("done");state.put("state","idle").put("failures",0).put("retryAt",0).put("success",System.currentTimeMillis());return result;}
        catch(Exception e){journal.failRunning();int count=state.optInt("failures")+1;state.put("state","retry").put("failures",count).put("retryAt",System.currentTimeMillis()+Math.min(21600000,15000L*(1L<<Math.min(10,count))));throw e;}
        finally{try{state.put("finished",System.currentTimeMillis());db.setSetting(runtime,state.toString());}finally{synchronized(RUNNING){RUNNING.remove(ref);}}}
    }
    private JSONObject runInternal(String key,SyncJournal journal)throws Exception{
        JSONObject policy=SyncPolicy.read(db,key),origins=new JSONObject(db.setting("sync-origins:"+NoteRepository.spaceId(key),"{}"));
        NoteRepository.key(key);String credential=key.startsWith("space:")?db.credential(key):key;int conflicts=0;JSONObject mappings=new JSONObject();
        JSONArray fs=db.rows(key,"folder");for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);if(f.optBoolean("dirty")){JSONObject ack=journal.request(transport,"/api/folders/"+f.getString("id"),new JSONObject().put("name",f.getString("name")).put("updated",f.optLong("updated")).put("deleted",f.optInt("deleted")),credential);db.acknowledgeFolder(key,ack.getJSONObject("folder"));journal.complete(ack.optString("_activityId"),"done");}}
        String after="";Set<String> seen=new HashSet<>();do{JSONObject res=journal.request(transport,"/api/folders"+(after.isEmpty()?"":"?after="+after),null,credential);JSONArray rows=res.getJSONArray("folders");for(int i=0;i<rows.length();i++)db.mergeFolder(key,rows.getJSONObject(i));after=res.isNull("next")?"":res.optString("next","");if(!after.isEmpty()&&!seen.add(after))throw new IOException("Invalid folder pagination");journal.complete(res.optString("_activityId"),"done");}while(!after.isEmpty());
        JSONObject remoteLayout=transport.request("/api/management",null,credential);db.mergeManagement(key,remoteLayout.getJSONObject("management"),"","");
        // Bound retries per run; pending operations survive offline/failure/CAS conflicts.
        JSONArray placementQueue=db.management(key).getJSONArray("pending");for(int i=0;i<placementQueue.length();i++){JSONObject op=placementQueue.getJSONObject(i);if(op.optBoolean("blocked")||op.optLong("retryAfter")>System.currentTimeMillis())continue;for(int attempt=0;attempt<2;attempt++){try{JSONObject sent=new JSONObject().put("version",db.management(key).getLong("version")).put("op",FolderPlacement.wire(op));JSONObject ack=transport.request("/api/management",sent,credential);int status=ack.optInt("httpStatus",200);boolean accepted=ack.optBoolean("accepted"),rejected=ack.optBoolean("rejected")||status==400||status==413||status==422;db.mergeManagement(key,ack.optJSONObject("management"),accepted?op.getString("id"):"",rejected?op.getString("id"):"",status==409?"conflict":"invalid");if(accepted||rejected)break;if(attempt==1)db.placementFailure(key,op.getString("id"));}catch(Exception failure){db.placementFailure(key,op.getString("id"));break;}}}
        JSONObject items=SyncPolicy.items(db.management(key));if(!policy.optBoolean("all")){String name="sync-scope-layout:"+NoteRepository.spaceId(key),layout=items.toString();if(!db.setting(name,"").equals(layout)){db.setSetting("cursor:"+NoteRepository.spaceId(key),"0");db.setSetting(name,layout);}}Set<String> eligibleAssets=new HashSet<>();JSONArray initialNotes=db.rows(key,"note");for(int i=0;i<initialNotes.length();i++){JSONObject n=initialNotes.getJSONObject(i);if(!n.optBoolean("dirty")&&n.optLong("version")>0&&n.optInt("purged")==0)origins.put(n.getString("id"),n.optString("folder_id"));if(SyncPolicy.note(n,policy,items,origins))eligibleAssets.addAll(DocumentModel.assets(n.getJSONObject("document")));}db.setSetting("sync-origins:"+NoteRepository.spaceId(key),origins.toString());
        JSONArray files=db.rows(key,"attachment");for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);if(f.optBoolean("dirty")&&eligibleAssets.contains(f.getString("id"))){String taskId="asset:"+f.getString("id")+":up";journal.state(taskId,f.optString("name"),"attachment","up","running","",-1,0);try{JSONObject saved=db.attachments.upload(key,f,transport,credential);journal.complete(taskId,"done");}catch(Exception failure){journal.state(taskId,f.optString("name"),"attachment","up","failed","附件传输失败，可重试",-1,0);throw failure;}}}
        JSONArray ns=db.rows(key,"note");for(int i=0;i<ns.length();i++){JSONObject n=ns.getJSONObject(i);if(!n.optBoolean("dirty")||!SyncPolicy.note(n,policy,items,origins))continue;JSONObject sent=db.pending(key,n);if(!SyncPolicy.note(sent,policy,items,origins))continue;JSONObject res=journal.request(transport,"/api/notes/"+n.getString("id"),sent,credential);int status=res.optInt("httpStatus",200);if(res.optJSONObject("note")!=null&&res.getJSONObject("note").optInt("purged")==0)origins.put(n.getString("id"),res.getJSONObject("note").optString("folder_id"));if(status==409)conflicts++;String copy=db.syncResult(key,sent,res,status);if(!copy.isEmpty())mappings.put(sent.getString("id"),copy);journal.complete(res.optString("_activityId"),status==409?"conflict":"done");}
        long cursor=db.cursor(key);boolean more;do{JSONObject res=journal.request(transport,"/api/notes?cursor="+cursor+SyncPolicy.query(policy),null,credential);if(!policy.optBoolean("all")&&res.optInt("scopeApplied")!=1)throw new IOException("Server does not support safe folder scope");long next=res.getLong("cursor");more=res.getBoolean("hasMore");if(next<cursor||(more&&next==cursor))throw new IOException("Invalid cursor");JSONArray received=new JSONArray(),raw=res.getJSONArray("notes");for(int i=0;i<raw.length();i++){JSONObject n=raw.getJSONObject(i),local=db.row(key,"note",n.getString("id"));if(n.optInt("purged")==1){if(local!=null&&SyncPolicy.note(local,policy,items,origins))received.put(n);}else if(SyncPolicy.folder(n.optString("folder_id"),policy,items)){received.put(n);origins.put(n.getString("id"),n.optString("folder_id"));}}int downloaded=0;for(int i=0;i<received.length();i++){JSONObject remote=received.getJSONObject(i),local=db.row(key,"note",remote.getString("id"));if(local==null||!local.optBoolean("dirty")&&remote.getLong("version")>local.optLong("version"))downloaded++;}db.mergePage(key,received,next);cursor=next;journal.completeCheck(res.optString("_activityId"),downloaded);}while(more);
        Set<String> refs=new HashSet<>();JSONArray all=db.rows(key,"note");for(int i=0;i<all.length();i++)if(SyncPolicy.note(all.getJSONObject(i),policy,items,origins))refs.addAll(DocumentModel.assets(all.getJSONObject(i).getJSONObject("document")));for(String id:refs)if(db.row(key,"attachment",id)==null){db.attachments.download(key,id,transport,credential);}
        db.setSetting("sync-origins:"+NoteRepository.spaceId(key),origins.toString());return db.snapshot(key).put("conflicts",conflicts).put("mappings",mappings);
    }
}






