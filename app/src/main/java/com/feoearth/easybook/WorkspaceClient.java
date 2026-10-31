package com.feoearth.easybook;

import org.json.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Fixed workspace API only; account tokens and key proofs never enter WebView. */
final class WorkspaceClient {
 static JSONObject request(String path,JSONObject body,String credential,boolean account)throws Exception{
  if(!path.matches("/api/workspaces(?:/invitations(?:/(?:preview\\?token=[a-f0-9]{64}|respond))?|/[a-f0-9]{64}(?:/(?:key|associate|mode|members|manager|leave|delete|invitations(?:/revoke)?))?)?"))throw new SecurityException("Workspace path denied");
  HttpsURLConnection c=(HttpsURLConnection)new URL(NativeTransport.origin(false)+path).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestMethod(body==null?"GET":"POST");c.setRequestProperty("Content-Type","application/json");
  if(credential!=null)c.setRequestProperty("Authorization",(account?"Easybook-Session ":"Bearer ")+credential);
  try{if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream o=c.getOutputStream()){o.write(bytes);}}
   int status=c.getResponseCode();if(status!=200&&status!=201)throw new NativeSync.HttpsTransport.HttpFailure(status);
   try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>262144)throw new IOException("Workspace response too large");out.write(b,0,n);}return new JSONObject(out.toString("UTF-8"));}
  }finally{c.disconnect();}
 }
 static void merge(JSONArray target,JSONArray source)throws Exception{
  for(int i=0;i<source.length();i++){JSONObject candidate=source.getJSONObject(i);boolean found=false;for(int j=0;j<target.length();j++)if(target.getJSONObject(j).getString("id").equals(candidate.getString("id"))){target.put(j,candidate);found=true;break;}if(!found)target.put(candidate);}
 }
 static JSONObject ensure(NoteRepository db)throws Exception{return ensure(db,null);}
 static JSONObject ensure(NoteRepository db,String turnstileToken)throws Exception{
  String local=db.activeSpace();if(!db.setting("account-workspace:"+local,"").isEmpty())return new JSONObject().put("id",db.setting("account-workspace:"+local,""));
  String credential=db.credential(local);JSONObject identity;
  try{identity=request("/api/workspaces",null,credential,false).getJSONArray("workspaces").getJSONObject(0);}
  catch(NativeSync.HttpsTransport.HttpFailure error){if(error.status==404)return null;if(error.status!=401)throw error;if(turnstileToken==null)throw error;try{identity=request("/api/workspaces",new JSONObject().put("name","我的工作区").put("bootstrapKey",credential).put("turnstileToken",turnstileToken),null,false).getJSONObject("workspace");}catch(Exception failure){throw error;}}
  db.bindWorkspaceIdentity(local,identity);return identity;
 }
 static JSONObject perform(NoteRepository db,String action,JSONObject args)throws Exception{
  if(action.equals("bootstrap")){try{ensure(db,args.optString("turnstileToken",null));return new JSONObject().put("ready",true);}catch(NativeSync.HttpsTransport.HttpFailure error){if(error.status==401&&!args.has("turnstileToken"))return new JSONObject().put("turnstileRequired",true);throw error;}}
  if(action.equals("list")){JSONObject current=db.cachedActiveWorkspace();JSONArray list=db.cachedWorkspaces();boolean cached=false;
   try{JSONObject refreshed=ensure(db);if(refreshed!=null&&refreshed.has("name"))current=refreshed;}catch(Exception unavailable){if(current==null)throw unavailable;cached=true;}
   try{JSONArray remote=request("/api/workspaces",null,NativeAccount.token(db),true).getJSONArray("workspaces");db.cacheWorkspaces(remote);merge(list,remote);}catch(CredentialVault.KeyUnavailable ignored){}catch(Exception unavailable){cached=true;}
   if(current==null)throw new IOException("Workspace unavailable");merge(list,new JSONArray().put(current));return new JSONObject().put("workspaces",list).put("current",current.getString("id")).put("cached",cached).put("accountAccess",!db.setting("account-workspace:"+db.activeSpace(),"").isEmpty());}
  if(action.equals("select")){String id=args.getString("id");if(db.activateCachedWorkspace(id))return new JSONObject().put("selected",true).put("cached",true);JSONObject w=request("/api/workspaces/"+id,null,NativeAccount.token(db),true).getJSONObject("workspace");db.activateAccountWorkspace(w);return new JSONObject().put("selected",true).put("cached",false);}
  if(action.equals("create")){boolean account=args.optBoolean("account");JSONObject body=new JSONObject().put("name",args.getString("name"));if(!account)body.put("turnstileToken",args.getString("turnstileToken"));JSONObject result=request("/api/workspaces",body,account?NativeAccount.token(db):null,account);db.pairWorkspace(result.getString("key"),result.getJSONObject("workspace"),false);return new JSONObject().put("created",true);}
  if(action.equals("inviteInbox"))return request("/api/workspaces/invitations",null,NativeAccount.token(db),true);
  if(action.equals("invitePreview")){String token=args.getString("token");if(!token.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid invite token");return request("/api/workspaces/invitations/preview?token="+token,null,NativeAccount.token(db),true);}
  if(action.equals("inviteRespond")){JSONObject body=new JSONObject().put("id",args.getString("id")).put("decision",args.getString("decision"));if(args.has("token"))body.put("token",args.getString("token"));return request("/api/workspaces/invitations/respond",body,NativeAccount.token(db),true);}
  if(java.util.Arrays.asList("inviteList","inviteCreate","inviteRevoke").contains(action)){
   String id=ensure(db).getString("id"),token=NativeAccount.token(db),path="/api/workspaces/"+id+"/invitations";
   if(action.equals("inviteList"))return request(path,null,token,true);
   if(action.equals("inviteRevoke"))return request(path+"/revoke",new JSONObject().put("id",args.getString("id")),token,true);
   JSONObject body=new JSONObject().put("kind",args.getString("kind")).put("role",args.getString("role")).put("expiresHours",args.optInt("expiresHours",24));
   if(args.has("accountId"))body.put("accountId",args.getString("accountId"));
   return request(path,body,token,true);
  }
  if(java.util.Arrays.asList("members","member","mode","manager","leave","delete").contains(action)){
   String id=ensure(db).getString("id"),token=NativeAccount.token(db);
   if(action.equals("members"))return request("/api/workspaces/"+id+"/members",null,token,true);
   JSONObject body=new JSONObject().put("confirm",args.optBoolean("confirm"));String suffix=action;
   if(action.equals("delete"))body.put("confirm",args.getString("confirm")).put("version",args.getLong("version"));
   if(action.equals("member")){suffix="members";body.put("accountId",args.getString("accountId")).put("role",args.isNull("role")?JSONObject.NULL:args.getString("role"));}
   if(action.equals("manager"))body.put("accountId",args.getString("accountId"));
   if(action.equals("mode"))body.put("mode",args.getString("mode"));
   JSONObject result=request("/api/workspaces/"+id+"/"+suffix,body,token,true);
   if(action.equals("mode")){if(result.has("key"))db.pairWorkspace(result.getString("key"),result.getJSONObject("workspace"),false);else db.activateAccountWorkspace(result.getJSONObject("workspace"));}
   return result;
  }
  JSONObject w=ensure(db);String id=w.getString("id");boolean account=!db.setting("account-workspace:"+db.activeSpace(),"").isEmpty();String credential=account?NativeAccount.token(db):db.credential(db.activeSpace());
  if(action.equals("rename")){JSONObject result=request("/api/workspaces/"+id,new JSONObject().put("name",args.getString("name")),credential,account);return result;}
  if(action.equals("associate")){JSONObject result=request("/api/workspaces/"+id+"/associate",new JSONObject().put("key",db.credential(db.activeSpace())),NativeAccount.token(db),true);return result;}
  if(action.equals("rotate")){JSONObject result=request("/api/workspaces/"+id+"/key",new JSONObject().put("confirm",true),credential,account);db.pairWorkspace(result.getString("key"),result.getJSONObject("workspace"),false);db.setSetting("account-workspace:"+db.activeSpace(),"");return new JSONObject().put("rotated",true);}
  throw new SecurityException("Workspace action denied");
 }
}

