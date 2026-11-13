package com.feoearth.easybook;

import java.io.*;
import java.net.URL;
import java.net.HttpURLConnection;
import java.util.*;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** A request remains bound to its captured server. Only the built-in profile may
 * use the existing first-party fallback, selected by a credential-free probe. */
final class NativeTransport {
 private static final Map<String,Set<HttpURLConnection>> connections=new HashMap<>();
 static String origin(NoteRepository db,boolean account)throws IOException{
  db.assertActiveProfile();if(account&&db.profile().httpKeyOnly)throw new IOException("Accounts require HTTPS");
  String value=db.profile().builtin?origin(account):db.profile().origin;db.assertActiveProfile();return value;
 }
 static void reject(NoteRepository db,boolean account,String failed){if(db.profile().builtin)reject(account,failed);}
 static HttpURLConnection open(NoteRepository db,String path,boolean account)throws IOException{
  String value=origin(db,account);HttpURLConnection c=openAt(value,path);register(db,c);
  try{db.assertActiveProfile();return c;}catch(RuntimeException stale){c.disconnect();throw stale;}
 }
 static HttpURLConnection openOfficial(NoteRepository db,String fixedOrigin,String path)throws IOException{
  db.assertActiveProfile();if(!db.profile().builtin||!fixedOrigin.equals(NativeAccount.ORIGIN)&&!fixedOrigin.equals(NativeAccount.IDENTITY_API)&&!fixedOrigin.equals(NativeAccount.SYNC_API))throw new IOException("Official service required");
  HttpURLConnection c=openAt(fixedOrigin,path);register(db,c);try{db.assertActiveProfile();return c;}catch(RuntimeException stale){c.disconnect();throw stale;}
 }
 static HttpURLConnection openProbe(ServerProfiles.Profile profile,String path)throws IOException{return openAt(profile.origin,path);}
 private static HttpURLConnection openAt(String origin,String path)throws IOException{
  if(path==null||!path.startsWith("/")||path.startsWith("//")||path.indexOf('#')>=0||path.indexOf('\\')>=0||path.indexOf('\r')>=0||path.indexOf('\n')>=0)throw new IOException("Invalid server path");
  ServerAddress.checkHttpHost(origin);
  HttpURLConnection c=(HttpURLConnection)new URL(origin+path).openConnection();c.setInstanceFollowRedirects(false);return c;
 }
 private static String session(String profileId,long epoch){return profileId+":"+epoch;}
 private static synchronized void register(NoteRepository db,HttpURLConnection connection){connections.computeIfAbsent(session(db.profileId(),db.profileEpoch()),k->Collections.newSetFromMap(new WeakHashMap<>())).add(connection);}
 static void cancel(NoteRepository db){cancel(db.profileId(),db.profileEpoch());}
 static void cancel(String profileId,long epoch){List<HttpURLConnection> pending;synchronized(NativeTransport.class){Set<HttpURLConnection> entries=connections.remove(session(profileId,epoch));pending=entries==null?Collections.emptyList():new ArrayList<>(entries);}for(HttpURLConnection c:pending)if(c!=null)c.disconnect();}
 static void cancel(String profileId){List<HttpURLConnection> pending=new ArrayList<>();synchronized(NativeTransport.class){Iterator<Map.Entry<String,Set<HttpURLConnection>>> it=connections.entrySet().iterator();while(it.hasNext()){Map.Entry<String,Set<HttpURLConnection>> entry=it.next();if(entry.getKey().startsWith(profileId+":")){pending.addAll(entry.getValue());it.remove();}}}for(HttpURLConnection c:pending)if(c!=null)c.disconnect();}
 static synchronized void release(NoteRepository db,HttpURLConnection connection){String key=session(db.profileId(),db.profileEpoch());Set<HttpURLConnection> entries=connections.get(key);if(entries!=null){entries.remove(connection);if(entries.isEmpty())connections.remove(key);}}
 interface Probe { boolean available(String origin,boolean account); }
 static String select(boolean account,Probe probe)throws IOException{
  String primary=NativeAccount.ORIGIN,secondary=account?NativeAccount.IDENTITY_API:NativeAccount.SYNC_API;
  if(probe.available(primary,account))return primary;
  if(probe.available(secondary,account))return secondary;
  throw new IOException("NATIVE_TRANSPORT_UNAVAILABLE");
 }
 private static String identity,sync;private static long identityUntil,syncUntil,identityPrimaryBlocked,identitySecondaryBlocked,syncPrimaryBlocked,syncSecondaryBlocked;
 static synchronized String origin(boolean account)throws IOException{
  long now=System.nanoTime();String cached=account?identity:sync;long until=account?identityUntil:syncUntil;
  if(cached!=null&&now<until)return cached;
  long primaryBlocked=account?identityPrimaryBlocked:syncPrimaryBlocked,secondaryBlocked=account?identitySecondaryBlocked:syncSecondaryBlocked;String selected=select(account,(candidate,kind)->now>=(candidate.equals(NativeAccount.ORIGIN)?primaryBlocked:secondaryBlocked)&&available(candidate,kind));long expires=System.nanoTime()+300000000000L;
  if(account){identity=selected;identityUntil=expires;}else{sync=selected;syncUntil=expires;}return selected;
 }
 static synchronized void reject(boolean account,String failed){
  long until=System.nanoTime()+30000000000L;boolean primary=failed.equals(NativeAccount.ORIGIN);
  if(account){identity=null;if(primary)identityPrimaryBlocked=until;else identitySecondaryBlocked=until;}
  else{sync=null;if(primary)syncPrimaryBlocked=until;else syncSecondaryBlocked=until;}
 }
 private static boolean available(String origin,boolean account){
  HttpsURLConnection c=null;try{
   c=(HttpsURLConnection)new URL(origin+(account?"/account/native/session":"/health")).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(4000);c.setReadTimeout(4000);c.setRequestProperty("Accept","application/json");c.setRequestProperty("X-Easybook-Native","1");
   int status=c.getResponseCode();String type=c.getContentType();if(type==null||!type.startsWith("application/json")||"challenge".equals(c.getHeaderField("cf-mitigated")))return false;
   try(InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
    if(in==null)return false;byte[] bytes=new byte[1024];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>8192)return false;out.write(bytes,0,n);}JSONObject data=new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
    return account?status==401&&data.optString("error").equals("unauthorized"):status==200&&data.optBoolean("ok")&&data.optString("app").equals("Easybook");
   }
  }catch(Exception ignored){return false;}finally{if(c!=null)c.disconnect();}
 }
}
