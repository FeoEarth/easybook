package com.feoearth.easybook;
import android.content.Context;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Private, content-addressed files. Note references and metadata never contain local paths. */
final class AttachmentStore {
 static final int MAX=5*1024*1024;
 private final Context context;private final NoteRepository db;
 AttachmentStore(Context c,NoteRepository d){context=c.getApplicationContext();db=d;}
 static void validId(String id){if(id==null||!id.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid attachment");}
 static String digest(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 private File file(String key,String id){NoteRepository.key(key);validId(id);return new File(new File(context.getFilesDir(),"attachments/"+NoteRepository.spaceId(key)),id);}
 static byte[] read(InputStream in)throws Exception{try(ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>MAX)throw new IOException("Attachment exceeds 5 MB");out.write(b,0,n);}return out.toByteArray();}}
 JSONObject save(String key,String name,String mime,byte[] bytes,boolean dirty)throws Exception{
  if(bytes.length>MAX)throw new IOException("Attachment exceeds 5 MB");String id=digest(bytes);File target=file(key,id);target.getParentFile().mkdirs();
  boolean valid=false;if(target.exists())try(InputStream cached=new FileInputStream(target)){valid=digest(read(cached)).equals(id);}catch(IOException ignored){}
  if(!valid){File tmp=new File(target.getParentFile(),id+"."+UUID.randomUUID()+".tmp");try{try(FileOutputStream out=new FileOutputStream(tmp)){out.write(bytes);out.getFD().sync();}Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}finally{tmp.delete();}}
  try(InputStream in=new FileInputStream(target)){if(!digest(read(in)).equals(id))throw new IOException("Attachment verification failed");}
  JSONObject old=db.row(key,"attachment",id);JSONObject meta=new JSONObject().put("id",id).put("name",cleanName(name)).put("mime",mime!=null&&mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream").put("size",bytes.length).put("dirty",(dirty&&old==null)||(old!=null&&old.optBoolean("dirty")));
  db.saveAttachment(key,meta);return meta;
 }
 static String cleanName(String name){if(name==null)name="附件";name=name.replaceAll("[\\p{Cntrl}/\\\\]","_");if(name.trim().isEmpty()||name.equals(".")||name.equals(".."))name="附件";return name.substring(0,Math.min(name.length(),180));}
 JSONObject payload(String key,String id)throws Exception{JSONObject meta=db.row(key,"attachment",id);if(meta==null)throw new IOException("Attachment missing");try(InputStream in=new FileInputStream(file(key,id))){byte[] bytes=read(in);if(!digest(bytes).equals(id)||bytes.length!=meta.optLong("size",-1))throw new IOException("Attachment corrupted");return new JSONObject(meta.toString()).put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));}}
 JSONObject accept(String key,String id,JSONObject remote)throws Exception{validId(id);byte[] bytes=Base64.decode(remote.getString("data"),Base64.NO_WRAP);if(!id.equals(digest(bytes))||remote.getLong("size")!=bytes.length)throw new IOException("Attachment hash mismatch");return save(key,remote.getString("name"),remote.getString("mime"),bytes,false);}
 JSONObject get(String key,String id)throws Exception{try{return payload(key,id);}catch(FileNotFoundException e){}catch(IOException e){if(db.row(key,"attachment",id)!=null&&db.row(key,"attachment",id).optBoolean("dirty"))throw e;}
  SyncJournal journal=new SyncJournal(db,key);try{JSONObject remote=journal.request(new NativeSync.HttpsTransport(new DataProtection.Plaintext()),"/api/attachments/"+id,null,db.credential(key));accept(key,id,remote);journal.complete(remote.optString("_activityId"),"done");return payload(key,id);}catch(Exception e){journal.failRunning();throw e;}
 }
}

