package com.feoearth.easybook;
import android.content.Context;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
/** Development-only integration: Chromium and the real native sync engine share a random test workspace. */
final class CrossClientChecks {
 static final String DB_NAME="cross-client-test.db";
 static void append(JSONObject note,String text)throws Exception{note.getJSONObject("document").getJSONObject("doc").getJSONArray("content").put(new JSONObject().put("type","paragraph").put("content",new JSONArray().put(new JSONObject().put("type","text").put("text",text))));note.put("mutation",NoteRepository.id());}
 static void run(Context context,String phase)throws Exception{
  JSONObject fixture=new JSONObject(new String(Files.readAllBytes(new java.io.File(context.getExternalFilesDir(null),"cross-client.json").toPath()),StandardCharsets.UTF_8));
  String key=fixture.getString("key"),id=fixture.getString("id");
  if(phase.equals("cleanup")){context.deleteDatabase(DB_NAME);return;}
  if(phase.equals("edit"))context.deleteDatabase(DB_NAME);
  NoteRepository db=new NoteRepository(context,DB_NAME);
  NativeSync.Transport real=new NativeSync.HttpsTransport(new DataProtection.Plaintext());
  NativeSync sync=new NativeSync(db,real);
  try{
   db.activate(key);
   if(phase.equals("edit")){
    sync.run(db.activeSpace());JSONObject n=db.row(key,"note",id);DataLayerChecks.require(n!=null,"native received Chromium note");DataLayerChecks.require(DocumentModel.plain(n.getJSONObject("document")).contains("Chromium origin"),"Chromium document reached Android");
    String base=n.getString("mutation");append(n,"Android online");n.put("pinned",1);DataLayerChecks.save(db,key,n,base);sync.run(db.activeSpace());
   }else if(phase.equals("offline")){
    JSONObject n=db.row(key,"note",id);String base=n.getString("mutation");append(n,"Android offline survives restart");DataLayerChecks.save(db,key,n,base);
    NativeSync.Transport fail=(path,body,credential)->{throw new java.io.IOException("Injected offline transport");};
    try{new NativeSync(db,fail).run(db.activeSpace());throw new AssertionError("offline transport succeeded");}catch(java.io.IOException expected){}
    DataLayerChecks.require(db.row(key,"note",id).getBoolean("dirty"),"offline edit durable");
   }else if(phase.equals("retry")){
    DataLayerChecks.require(DocumentModel.plain(db.row(key,"note",id).getJSONObject("document")).contains("Android offline survives restart"),"offline edit recovered in new instrumentation process");
    JSONObject res=sync.run(db.activeSpace());DataLayerChecks.require(res.getInt("conflicts")==1,"concurrent Chromium edit produced explicit conflict");sync.run(db.activeSpace());
    JSONArray ns=db.rows(key,"note");boolean local=false,remote=false;for(int i=0;i<ns.length();i++){String text=DocumentModel.plain(ns.getJSONObject(i).getJSONObject("document"));local|=text.contains("Android offline survives restart");remote|=text.contains("Chromium concurrent");}DataLayerChecks.require(local&&remote,"both concurrent versions preserved");
   }else if(phase.equals("lostAck")){
    JSONObject n=db.row(key,"note",id);String base=n.getString("mutation");append(n,"Android lost acknowledgement");DataLayerChecks.save(db,key,n,base);long version=n.getLong("version");
    NativeSync.Transport drop=(path,body,credential)->{JSONObject result=real.request(path,body,credential);if(body!=null&&path.startsWith("/api/notes/"))throw new java.io.IOException("Injected lost acknowledgement after server commit");return result;};
    try{new NativeSync(db,drop).run(db.activeSpace());throw new AssertionError("ack loss not injected");}catch(java.io.IOException expected){}
    DataLayerChecks.require(db.row(key,"outbox",id)!=null,"immutable request retained after lost ack");
    db.close();db=new NoteRepository(context,DB_NAME);new NativeSync(db,real).run(db.activeSpace());
    DataLayerChecks.require(db.row(key,"note",id).getLong("version")==version+1,"retry replays receipt without double increment");DataLayerChecks.require(db.row(key,"outbox",id)==null,"ack clears durable request");
   }else if(phase.equals("delete")){
    sync.run(db.activeSpace());JSONObject n=db.row(key,"note",id);String base=n.getString("mutation");n.put("deleted",1).put("mutation",NoteRepository.id());DataLayerChecks.save(db,key,n,base);sync.run(db.activeSpace());
   }else throw new IllegalArgumentException("Unknown cross-client phase");
  }finally{db.close();}
 }
}
