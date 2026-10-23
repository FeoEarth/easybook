package com.feoearth.easybook;

import android.content.Context;
import org.json.*;
import java.util.*;

/** Runs against real Android SQLite; only the deterministic conflict transport is fake. */
final class DataLayerChecks {
    static void require(boolean b,String label){if(!b)throw new AssertionError(label);}
    static JSONObject note(String id,String text)throws Exception{return new JSONObject().put("id",id).put("title","测试").put("body",text).put("icon","📄").put("favorite",0).put("deleted",0).put("version",0).put("mutation",NoteRepository.id()).put("updated",System.currentTimeMillis()).put("dirty",true).put("folder_id","");}
    static JSONObject source(String key,JSONArray notes,JSONArray folders)throws Exception{return new JSONObject().put("active",key).put("storage",new JSONObject().put("easybook-"+key,notes.toString()).put("easybook-folders-"+key,folders.toString()));}
    static void save(NoteRepository db,String k,JSONObject n,String base)throws Exception{db.commit(k,new JSONObject().put("notes",new JSONArray().put(new JSONObject().put("note",n).put("baseMutation",base))).put("folders",new JSONArray()));}
    static JSONObject findBody(JSONArray a,String body)throws Exception{for(int i=0;i<a.length();i++)if(a.getJSONObject(i).optString("body").equals(body))return a.getJSONObject(i);return null;}
    static void run(Context context)throws Exception{
        String name="native-data-tests-"+NoteRepository.id()+".db";NoteRepository db=new NoteRepository(context,name);
        try{
            String key=NoteRepository.newKey(),other=NoteRepository.newKey(),empty=NoteRepository.newKey(),folderId=NoteRepository.id();JSONObject f=new JSONObject().put("id",folderId).put("name","历史").put("dirty",true).put("updated",1);JSONObject old=note(NoteRepository.id(),"保留正文").put("folder_id",folderId).put("favorite",1);JSONObject deleted=note(NoteRepository.id(),"回收站").put("deleted",1);
            JSONObject src=source(key,new JSONArray().put(old).put(deleted),new JSONArray().put(f));src.getJSONObject("storage").put("easybook-"+other,new JSONArray().put(note(NoteRepository.id(),"另一空间")).toString());
            src.getJSONObject("storage").put("easybook-"+empty,"[]");
            JSONObject report=db.migrate(src);require(report.getInt("notes")==3&&report.getInt("spaces")==3,"all legacy workspaces migrate");require(db.active().equals(key),"legacy active workspace preserved");require(db.row(key,"note",old.getString("id")).optBoolean("dirty"),"pending offline edits preserved");require(db.rows(key,"folder").length()==1,"folder migrated");require(db.migrate(src).optBoolean("replayed")&&db.rows(key,"note").length()==2,"retry is idempotent");
            JSONObject changed=NoteRepository.copy(old).put("body","另一版本");JSONObject src2=source(key,new JSONArray().put(changed),new JSONArray().put(f));db.migrate(src2);require(findBody(db.rows(key,"note"),"保留正文")!=null&&findBody(db.rows(key,"note"),"另一版本")!=null,"migration collision preserves both versions");int count=db.rows(key,"note").length();db.migrate(src2);require(db.rows(key,"note").length()==count,"collision retry creates no additional copies");
            JSONObject invalidSource=source(key,new JSONArray().put(note(NoteRepository.id(),"应回滚")).put(new JSONObject().put("id","bad")),new JSONArray());int journalCount=db.migrationReports().length();try{db.migrate(invalidSource);throw new AssertionError("invalid migration accepted");}catch(IllegalArgumentException|JSONException expected){}require(db.rows(key,"note").length()==count&&db.migrationReports().length()==journalCount,"partial migration and journal transaction rolled back");
            JSONObject archive=db.rollbackArchive();require(new JSONArray(archive.getJSONObject("storage").getString("easybook-"+key)).length()==count,"rollback archive includes post-migration copies");require(archive.getJSONObject("storage").has("easybook-"+other),"rollback includes inactive workspaces");require(archive.getJSONObject("storage").has("easybook-"+empty),"rollback preserves empty inactive workspace keys");
            JSONObject local=note(NoteRepository.id(),"离线新内容").put("title","ＡＢＣ 报销 咖啡");save(db,key,local,"");require(db.search(key,"abc 咖啡","all",false).length()==1,"native full-width multiple keyword search");require(db.search(key,"回收站","all",false).length()==0&&db.search(key,"回收站","trash",false).length()==1,"native trash isolation");
            // A stale UI save cannot clobber another writer.
            JSONObject winner=NoteRepository.copy(local).put("body","数据库新版本").put("mutation",NoteRepository.id());save(db,key,winner,local.getString("mutation"));JSONObject stale=NoteRepository.copy(local).put("body","旧编辑器新输入").put("mutation",NoteRepository.id());save(db,key,stale,local.getString("mutation"));require(findBody(db.rows(key,"note"),"数据库新版本")!=null&&findBody(db.rows(key,"note"),"旧编辑器新输入")!=null,"optimistic native write preserves both");
            // A successful upload that races a local edit must keep the local edit dirty.
            JSONObject sent=db.row(key,"note",winner.getString("id"));JSONObject during=NoteRepository.copy(sent).put("body","上传时继续编辑").put("mutation",NoteRepository.id());save(db,key,during,sent.getString("mutation"));JSONObject ack=NoteRepository.copy(sent).put("version",1).put("dirty",false);db.syncResult(key,sent,new JSONObject().put("note",ack),200);JSONObject after=db.row(key,"note",sent.getString("id"));require(after.getString("body").equals("上传时继续编辑")&&after.optBoolean("dirty")&&after.getInt("version")==1,"network acknowledgement does not overwrite in-flight edit");
            JSONObject remote=NoteRepository.copy(sent).put("body","远端版本").put("mutation",NoteRepository.id()).put("version",2);db.syncResult(key,after,new JSONObject().put("note",remote),409);require(findBody(db.rows(key,"note"),"远端版本")!=null&&findBody(db.rows(key,"note"),"上传时继续编辑")!=null,"sync conflict preserves remote and latest local");
            require(new DataProtection.Plaintext().encodeLocal("plain").equals("plain"),"stage one does not claim encryption");
        }finally{db.close();context.deleteDatabase(name);}
        liveSync(context);
    }
    private static void liveSync(Context context)throws Exception{
        String aName="native-live-a-"+NoteRepository.id()+".db",bName="native-live-b-"+NoteRepository.id()+".db";NoteRepository a=new NoteRepository(context,aName),b=new NoteRepository(context,bName);
        try{String key=NoteRepository.newKey(),folderId=NoteRepository.id();JSONObject folder=new JSONObject().put("id",folderId).put("name","原生跨设备测试").put("updated",1).put("dirty",true);a.commit(key,new JSONObject().put("folders",new JSONArray().put(folder)));
            a.activate(key);b.activate(key);JSONObject n=note(NoteRepository.id(),"设备 A 的离线笔记").put("folder_id",folderId);save(a,key,n,"");NativeSync.Transport transport=new NativeSync.HttpsTransport(new DataProtection.Plaintext());NativeSync sa=new NativeSync(a,transport),sb=new NativeSync(b,transport);sa.run(a.activeSpace());sb.run(b.activeSpace());require(findBody(b.rows(key,"note"),"设备 A 的离线笔记")!=null&&b.rows(key,"folder").length()==1,"live Worker/D1 cross-device notes and folders");
            JSONObject na=a.row(key,"note",n.getString("id")),nb=b.row(key,"note",n.getString("id"));String aBase=na.getString("mutation"),bBase=nb.getString("mutation");na.put("body","设备 A 冲突版本").put("mutation",NoteRepository.id());nb.put("body","设备 B 冲突版本").put("mutation",NoteRepository.id());save(a,key,na,aBase);save(b,key,nb,bBase);sa.run(a.activeSpace());JSONObject conflict=sb.run(b.activeSpace());require(conflict.getInt("conflicts")==1,"live CAS conflict detected");sb.run(b.activeSpace());sa.run(a.activeSpace());require(findBody(a.rows(key,"note"),"设备 A 冲突版本")!=null&&findBody(a.rows(key,"note"),"设备 B 冲突版本")!=null,"live conflict converges without data loss");
            // Existing browser wire format: omitted folder_id must not reset assignment.
            JSONObject wire=NoteRepository.copy(a.row(key,"note",n.getString("id")));wire.remove("folder_id");wire.put("mutation",NoteRepository.id()).put("body","网页版兼容写入");JSONObject result=transport.request("/api/notes/"+n.getString("id"),wire,key);require(result.getJSONObject("note").getString("folder_id").equals(folderId),"legacy browser protocol preserves folder");sa.run(a.activeSpace());require(findBody(a.rows(key,"note"),"网页版兼容写入")!=null,"native reads browser protocol writes");
        }finally{a.close();b.close();context.deleteDatabase(aName);context.deleteDatabase(bName);}
    }
}
