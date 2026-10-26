package com.feoearth.easybook;

import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Select only fixed first-party HTTPS origins using a credential-free probe.
 * Never replay a token exchange or write merely because its response was lost. */
final class NativeTransport {
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
