package com.feoearth.easybook;
import android.content.Context;
import org.json.*;
final class DataLayerChecks {
 static void require(boolean b,String s){if(!b)throw new AssertionError(s);}
 static JSONObject document(String text)throws Exception{return new JSONObject().put("schemaVersion",1).put("doc",new JSONObject().put("type","doc").put("content",new JSONArray().put(new JSONObject().put("type","paragraph").put("content",new JSONArray().put(new JSONObject().put("type","text").put("text",text))))));}
 static JSONObject note(String id,String text)throws Exception{return new JSONObject().put("id",id).put("title","测试").put("document",document(text)).put("icon","📄").put("favorite",0).put("pinned",0).put("deleted",0).put("version",0).put("mutation",NoteRepository.id()).put("updated",System.currentTimeMillis()).put("dirty",true).put("folder_id","");}
 static JSONObject source(String key,JSONArray notes,JSONArray folders)throws Exception{return new JSONObject().put("active",key).put("storage",new JSONObject().put("easybook-"+key,notes.toString()).put("easybook-folders-"+key,folders.toString()));}
 static JSONObject save(NoteRepository db,String key,JSONObject n,String base)throws Exception{return db.commit(key,new JSONObject().put("notes",new JSONArray().put(new JSONObject().put("note",n).put("baseMutation",base))));}
 static JSONObject findBody(JSONArray notes,String text)throws Exception{for(int i=0;i<notes.length();i++)if(DocumentModel.plain(notes.getJSONObject(i).getJSONObject("document")).equals(text))return notes.getJSONObject(i);return null;}
 static void run(Context context)throws Exception{
  String name="json-check-"+NoteRepository.id()+".db",key=NoteRepository.newKey();NoteRepository db=new NoteRepository(context,name);try{
   JSONObject n=note(NoteRepository.id(),"离线正文");save(db,key,n,"");JSONObject first=db.row(key,"note",n.getString("id"));db.close();db=new NoteRepository(context,name);require(findBody(db.rows(key,"note"),"离线正文")!=null,"SQLite reopen restores JSON");
   JSONObject pending=db.pending(key,first);JSONObject edit=NoteRepository.copy(first).put("document",document("上传中继续输入")).put("mutation",NoteRepository.id());save(db,key,edit,first.getString("mutation"));require(db.pending(key,edit).getString("mutation").equals(pending.getString("mutation")),"retry payload stays immutable");
   JSONObject ack=NoteRepository.copy(first).put("version",1);db.syncResult(key,pending,new JSONObject().put("note",ack),200);require(findBody(db.rows(key,"note"),"上传中继续输入")!=null,"ack preserves in-flight edits");
   JSONObject current=db.row(key,"note",n.getString("id")),remote=NoteRepository.copy(first).put("version",2).put("document",document("远端修改")).put("mutation",NoteRepository.id());db.syncResult(key,current,new JSONObject().put("note",remote),409);require(findBody(db.rows(key,"note"),"远端修改")!=null&&findBody(db.rows(key,"note"),"上传中继续输入")!=null,"conflict copy preserves both");
   db.mergePage(key,new JSONArray().put(remote),12);require(db.cursor(key)==12,"cursor durable");require(!db.snapshot(key).toString().contains(key),"credential not exposed");
   try{save(db,key,NoteRepository.copy(remote).put("body","<p>bad</p>"),remote.getString("mutation"));throw new AssertionError("HTML accepted");}catch(IllegalArgumentException expected){}
  }finally{db.close();context.deleteDatabase(name);}
 }
 static void live(Context c)throws Exception{throw new IllegalStateException("Live tests must be explicitly invoked separately");}
}
