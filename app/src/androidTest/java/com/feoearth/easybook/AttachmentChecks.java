package com.feoearth.easybook;
import android.content.Context;
import org.json.*;
import java.nio.charset.StandardCharsets;
final class AttachmentChecks {
 static void require(boolean value,String label){if(!value)throw new AssertionError(label);}
 static void run(Context context)throws Exception{
  String name="attachment-check-"+NoteRepository.id()+".db",key=NoteRepository.newKey();NoteRepository db=new NoteRepository(context,name);
  try{byte[] data="离线附件\u0000data".getBytes(StandardCharsets.UTF_8);JSONObject meta=db.attachments.save(key,"附件.txt","text/plain",data,true);String id=meta.getString("id");require(db.attachments.payload(key,id).getString("data").equals(android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP)),"offline file bytes preserved");require(db.row(NoteRepository.newKey(),"attachment",id)==null,"attachment metadata workspace isolation");
   boolean denied=false;try{db.attachments.accept(key,"b".repeat(64),db.attachments.payload(key,id));}catch(Exception e){denied=true;}require(denied,"attachment digest mismatch denied");
   final int[] uploads={0};NativeSync.Transport mock=(path,body,credential)->{if(path.startsWith("/api/attachments/")){uploads[0]++;return new JSONObject().put("id",id).put("size",data.length);}if(path.equals("/api/folders"))return new JSONObject().put("folders",new JSONArray()).put("next",JSONObject.NULL);if(path.equals("/api/notes"))return new JSONObject().put("notes",new JSONArray()).put("next",JSONObject.NULL);throw new IllegalArgumentException(path);};
   new NativeSync(db,mock).run(key);new NativeSync(db,mock).run(key);require(uploads[0]==1&&!db.row(key,"attachment",id).getBoolean("dirty"),"verified uploads acknowledged once, retry safe");
   JSONObject legacy=DataLayerChecks.note(NoteRepository.id(),"原稿 <b>保留</b>");DataLayerChecks.save(db,key,legacy,"");JSONObject rich=new JSONObject(legacy.toString()).put("body","<!--easybook-rich-v1-->\n<p>正文 <strong>加粗</strong></p>").put("mutation",NoteRepository.id());DataLayerChecks.save(db,key,rich,legacy.getString("mutation"));require(db.row(key,"rich-original",legacy.getString("id")).getString("body").equals(legacy.getString("body")),"original archived before rich conversion");require(db.search(key,"正文 加粗","all",true).length()==1,"rich text searchable without markup");
  }finally{db.close();context.deleteDatabase(name);java.io.File dir=new java.io.File(context.getFilesDir(),"attachments/"+NoteRepository.spaceId(key));java.io.File[] files=dir.listFiles();if(files!=null)for(java.io.File f:files)f.delete();dir.delete();}
 }
}
