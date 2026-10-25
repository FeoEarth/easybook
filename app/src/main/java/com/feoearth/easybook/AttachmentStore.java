package com.feoearth.easybook;
import android.content.Context;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Original files are streamed to private disk; only bounded chunks cross the bridge/network. */
final class AttachmentStore {
 static final int MAX=1024*1024*1024,CLOUD=50*1024*1024,CHUNK=4*1024*1024;
 private final Context context;private final NoteRepository db;
 AttachmentStore(Context c,NoteRepository d){context=c.getApplicationContext();db=d;}
 static void validId(String id){if(id==null||!id.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid attachment");}
 static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 static String digest(byte[] bytes)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(bytes));}
 static String digest(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();d.update(b,0,n);}}return hex(d.digest());}
 File file(String key,String id){NoteRepository.key(key);validId(id);return new File(new File(context.getFilesDir(),"attachments/"+NoteRepository.spaceId(key)),id);}
 static long copy(InputStream in,OutputStream out,long limit)throws IOException{byte[] b=new byte[65536];long size=0;int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();size+=n;if(size>limit)throw new IOException("Attachment size limit exceeded");out.write(b,0,n);}return size;}
 // Retained for old JSON backup imports only, never used by the new picker or sync.
 static byte[] read(InputStream in)throws Exception{try(ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,5*1024*1024);return out.toByteArray();}}
 JSONObject save(String key,String name,String mime,byte[] bytes,boolean dirty)throws Exception{return saveStream(key,name,mime,new ByteArrayInputStream(bytes),dirty,null,-1);}
 JSONObject saveStream(String key,String name,String mime,InputStream in,boolean dirty,String expected,long expectedSize)throws Exception{
  File dir=file(key,"0000000000000000000000000000000000000000000000000000000000000000").getParentFile();if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("Storage unavailable");File tmp=File.createTempFile("import-",".tmp",dir);
  try{long size;try(FileOutputStream out=new FileOutputStream(tmp)){size=copy(in,out,MAX);out.getFD().sync();}String id=digest(tmp);if(expected!=null&&(!expected.equals(id)||size!=expectedSize))throw new IOException("Attachment integrity mismatch");File target=file(key,id);
   if(!target.exists()||target.length()!=size||!digest(target).equals(id))Files.move(tmp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
   JSONObject old=db.row(key,"attachment",id),meta=new JSONObject().put("id",id).put("name",cleanName(name)).put("mime",mime!=null&&mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream").put("size",size).put("available",true).put("dirty",dirty&&(old==null||!old.optBoolean("available",true))||old!=null&&old.optBoolean("dirty"));
   db.saveAttachment(key,meta);return meta;
  }finally{tmp.delete();}
 }
 static String cleanName(String name){if(name==null)name="附件";name=name.replaceAll("[\\p{Cntrl}/\\\\]","_");if(name.trim().isEmpty()||name.equals(".")||name.equals(".."))name="附件";return name.substring(0,Math.min(name.length(),180));}
 JSONObject payload(String key,String id)throws Exception{JSONObject meta=db.row(key,"attachment",id);if(meta==null)throw new IOException("Attachment missing");try(InputStream in=new FileInputStream(file(key,id))){byte[] bytes=read(in);if(!digest(bytes).equals(id))throw new IOException("Attachment corrupted");return new JSONObject(meta.toString()).put("data",Base64.encodeToString(bytes,Base64.NO_WRAP));}}
 JSONObject accept(String key,String id,JSONObject remote)throws Exception{validId(id);byte[] bytes=Base64.decode(remote.getString("data"),Base64.NO_WRAP);return saveStream(key,remote.getString("name"),remote.getString("mime"),new ByteArrayInputStream(bytes),false,id,remote.getLong("size"));}
 JSONObject get(String key,String id)throws Exception{
  JSONObject meta=db.row(key,"attachment",id);if(meta==null||!file(key,id).isFile()&&!meta.optBoolean("localOnly"))meta=download(key,id,new NativeSync.HttpsTransport(new DataProtection.Plaintext()),db.credential(key));
  if(meta==null)throw new IOException("Attachment missing");boolean available=file(key,id).isFile();return new JSONObject(meta.toString()).put("available",available).put("url",available?"https://appassets.androidplatform.net/attachment/"+id:"");
 }
 JSONObject prepare(String key,JSONObject meta)throws Exception{
  String id=meta.getString("id");File original=file(key,id),wire=original,gz=new File(original.getParentFile(),id+".gzip");if(!original.isFile()||original.length()!=meta.getLong("size")||!digest(original).equals(id))throw new IOException("Original attachment corrupted");
  boolean compress=SyncPolicy.read(db,key).optBoolean("compression",true);String encoding="identity";
  if(compress){File tmp=File.createTempFile("compress-",".tmp",original.getParentFile());try{
   try(InputStream in=new FileInputStream(original);OutputStream raw=new FileOutputStream(tmp);OutputStream bounded=new FilterOutputStream(raw){long count;@Override public void write(byte[] b,int off,int len)throws IOException{count+=len;if(count>CLOUD)throw new IOException("Compression exceeds cloud limit");out.write(b,off,len);}@Override public void write(int b)throws IOException{count++;if(count>CLOUD)throw new IOException("Compression exceeds cloud limit");out.write(b);}};GZIPOutputStream out=new GZIPOutputStream(bounded,65536)){copy(in,out,MAX);}
   if(tmp.length()+Math.max(64,original.length()/20)<original.length()){Files.move(tmp.toPath(),gz.toPath(),StandardCopyOption.REPLACE_EXISTING);wire=gz;encoding="gzip";}
  }catch(IOException compressionFailure){if(Thread.currentThread().isInterrupted())throw compressionFailure;}finally{tmp.delete();}}
  JSONObject m=new JSONObject().put("v",2).put("id",id).put("name",meta.getString("name")).put("mime",meta.getString("mime")).put("size",original.length()).put("localOnly",wire.length()>CLOUD).put("encoding",encoding).put("wireSize",wire.length()>CLOUD?0:wire.length()).put("wireId",wire.length()>CLOUD?id:digest(wire));return m;
 }
 JSONObject upload(String key,JSONObject meta,NativeSync.Transport transport,String credential)throws Exception{
  JSONObject m=prepare(key,meta);JSONArray parts=new JSONArray();String id=meta.getString("id");
  if(!m.getBoolean("localOnly")){File wire=m.getString("encoding").equals("gzip")?new File(file(key,id).getParentFile(),id+".gzip"):file(key,id);try(InputStream in=new FileInputStream(wire)){byte[] b=new byte[CHUNK];int index=0;while(true){int n=0,r;while(n<b.length&&(r=in.read(b,n,b.length-n))!=-1)n+=r;if(n==0)break;byte[] chunk=Arrays.copyOf(b,n);String hash=digest(chunk);JSONObject ack=transport.request("/api/attachments/"+id,new JSONObject().put("op","part").put("wireId",m.getString("wireId")).put("index",index++).put("hash",hash).put("data",Base64.encodeToString(chunk,Base64.NO_WRAP)),credential);if(!hash.equals(ack.optString("hash"))||ack.optInt("size")!=n)throw new IOException("Chunk acknowledgement mismatch");parts.put(new JSONObject().put("hash",hash).put("size",n));}}}
  m.put("parts",parts);JSONObject ack=transport.request("/api/attachments/"+id,new JSONObject().put("op","commit").put("manifest",m),credential);if(!id.equals(ack.optString("id"))||ack.optLong("size",-1)!=meta.getLong("size"))throw new IOException("Manifest acknowledgement mismatch");JSONObject saved=new JSONObject(meta.toString()).put("dirty",false).put("localOnly",ack.optBoolean("localOnly")).put("encoding",m.getString("encoding")).put("wireSize",m.getLong("wireSize"));db.saveAttachment(key,saved);return saved;
 }
 JSONObject download(String key,String id,NativeSync.Transport transport,String credential)throws Exception{
  validId(id);JSONObject m=transport.request("/api/attachments/"+id,null,credential);if(m.optInt("v")!=2||!id.equals(m.optString("id"))||m.getLong("size")<0||m.getLong("size")>MAX)throw new IOException("Invalid attachment manifest");
  if(m.getBoolean("localOnly")){JSONObject placeholder=new JSONObject(m.toString()).put("dirty",false).put("available",false);db.saveAttachment(key,placeholder);return placeholder;}
  if(!m.getString("encoding").matches("identity|gzip")||m.getLong("wireSize")<0||m.getLong("wireSize")>CLOUD)throw new IOException("Invalid wire format");File dir=file(key,id).getParentFile();dir.mkdirs();File tmp=File.createTempFile("download-",".tmp",dir);
  try{JSONArray parts=m.getJSONArray("parts");if(parts.length()>13)throw new IOException("Too many chunks");long count=0;try(FileOutputStream out=new FileOutputStream(tmp)){for(int i=0;i<parts.length();i++){JSONObject p=parts.getJSONObject(i),r=transport.request("/api/attachments/"+id+"?part="+i,null,credential);byte[] b=Base64.decode(r.getString("data"),Base64.NO_WRAP);count+=b.length;if(b.length>CHUNK+1024*1024||count>CLOUD||b.length!=p.getLong("size")||!digest(b).equals(p.getString("hash")))throw new IOException("Chunk integrity mismatch");out.write(b);}out.getFD().sync();}if(count!=m.getLong("wireSize")||!digest(tmp).equals(m.getString("wireId")))throw new IOException("Wire integrity mismatch");
   try(InputStream raw=new FileInputStream(tmp);InputStream original=m.getString("encoding").equals("gzip")?new GZIPInputStream(raw,65536):raw){return saveStream(key,m.getString("name"),m.getString("mime"),original,false,id,m.getLong("size"));}
  }finally{tmp.delete();}
 }
}
