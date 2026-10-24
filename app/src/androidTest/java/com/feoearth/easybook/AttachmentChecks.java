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
   final int[] uploads={0};NativeSync.Transport mock=(path,body,credential)->{if(path.startsWith("/api/attachments/")){uploads[0]++;return new JSONObject().put("id",id).put("size",data.length);}if(path.equals("/api/folders"))return new JSONObject().put("folders",new JSONArray()).put("next",JSONObject.NULL);if(path.startsWith("/api/notes?cursor="))return new JSONObject().put("notes",new JSONArray()).put("cursor",0).put("hasMore",false);throw new IllegalArgumentException(path);};
   new NativeSync(db,mock).run(key);new NativeSync(db,mock).run(key);require(uploads[0]==1&&!db.row(key,"attachment",id).getBoolean("dirty"),"verified uploads acknowledged once, retry safe");
   java.io.File cached=new java.io.File(context.getFilesDir(),"attachments/"+NoteRepository.spaceId(key)+"/"+id);java.nio.file.Files.write(cached.toPath(),new byte[]{1,2,3});boolean corrupted=false;try{db.attachments.payload(key,id);}catch(Exception expected){corrupted=true;}require(corrupted,"corrupted cache rejected");JSONObject restored=new JSONObject(meta.toString()).put("data",android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP));db.attachments.accept(key,id,restored);require(db.attachments.payload(key,id).getString("data").equals(restored.getString("data")),"verified re-download atomically repairs cache");require(!db.row(key,"attachment",id).optBoolean("dirty"),"repair does not re-upload synced file");
   JSONObject n=DataLayerChecks.note(NoteRepository.id(),"正文 加粗");DataLayerChecks.save(db,key,n,"");require(db.search(key,"正文 加粗","all",true).length()==1,"JSON plaintext search");
  }finally{db.close();context.deleteDatabase(name);java.io.File dir=new java.io.File(context.getFilesDir(),"attachments/"+NoteRepository.spaceId(key));java.io.File[] files=dir.listFiles();if(files!=null)for(java.io.File f:files)f.delete();dir.delete();}
 }
}


