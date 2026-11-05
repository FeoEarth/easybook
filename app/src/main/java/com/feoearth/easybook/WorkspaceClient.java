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
 static JSONObject lookup(JSONArray items,String id)throws JSONException{for(int i=0;i<items.length();i++){JSONObject row=items.getJSONObject(i);if(id.equals(row.optString("id")))return row;}return null;}
 static JSONObject ensure(NoteRepository db)throws Exception{return ensure(db,null);}
 static JSONObject ensure(NoteRepository db,String turnstileToken)throws Exception{
  String local=db.activeSpace();if(!db.setting("account-workspace:"+local,"").isEmpty())return new JSONObject().put("id",db.setting("account-workspace:"+local,""));
  String credential=db.credential(local);JSONObject identity;
  try{identity=request("/api/workspaces",null,credential,false).getJSONArray("workspaces").getJSONObject(0);}
  catch(NativeSync.HttpsTransport.HttpFailure error){if(error.status==404)return null;if(error.status!=401)throw error;if(turnstileToken==null)throw error;JSONObject cached=db.cachedActiveWorkspace();if(cached==null){cached=new JSONObject().put("id",NoteRepository.newKey()).put("name","我的工作区").put("mode","personal").put("role","manager");db.bindWorkspaceIdentity(local,cached);db.setSetting("workspace-pending:"+cached.getString("id"),"1");}try{identity=request("/api/workspaces",new JSONObject().put("name",cached.getString("name")).put("workspaceId",cached.getString("id")).put("bootstrapKey",credential).put("turnstileToken",turnstileToken),null,false).getJSONObject("workspace");}catch(Exception failure){throw error;}}
  db.bindWorkspaceIdentity(local,identity);db.setSetting("workspace-pending:"+identity.getString("id"),"");return identity;
 }
 static JSONObject perform(NoteRepository db,String action,JSONObject args)throws Exception{
  if(action.equals("bootstrap")){try{ensure(db,args.optString("turnstileToken",null));return new JSONObject().put("ready",true);}catch(NativeSync.HttpsTransport.HttpFailure error){if(error.status==401&&!args.has("turnstileToken"))return new JSONObject().put("turnstileRequired",true);throw error;}}
  if(action.equals("register")){
   String id=args.getString("id"),token=args.optString("turnstileToken",null);if(!id.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid workspace");
   if(db.setting("workspace-pending:"+id,"").isEmpty())return new JSONObject().put("ready",true);
   if(token==null)return new JSONObject().put("turnstileRequired",true);
   String credential=db.localKeyCredential(id);JSONObject local=lookup(db.localKeyWorkspaces(),id);if(credential==null||local==null)throw new SecurityException("Local workspace credential unavailable");
   JSONObject registered=request("/api/workspaces",new JSONObject().put("name",local.getString("name")).put("workspaceId",id).put("bootstrapKey",credential).put("turnstileToken",token),null,false).getJSONObject("workspace");
   if(!id.equals(registered.getString("id")))throw new SecurityException("Workspace identity changed");
   db.updateWorkspaceMetadata(registered);db.setSetting("workspace-pending:"+id,"");return new JSONObject().put("ready",true).put("workspace",registered);
  }
  if(action.equals("listCached")){
   JSONObject current=db.cachedActiveWorkspace();if(current==null)throw new IOException("Workspace unavailable");
   JSONArray list=db.cachedWorkspaces();if(lookup(list,current.getString("id"))==null)merge(list,new JSONArray().put(current));
   return new JSONObject().put("workspaces",list).put("current",current.getString("id")).put("cached",true).put("currentUnavailable",false).put("accountAccess",!db.setting("account-workspace:"+db.activeSpace(),"").isEmpty());
  }
  if(action.equals("list")){
   JSONObject current=db.cachedActiveWorkspace();JSONArray list=db.cachedWorkspaces();boolean cached=false,authoritative=false,activeKeyVerified=false,currentDenied=false;
   try{JSONObject refreshed=ensure(db);if(refreshed!=null&&refreshed.has("name")){current=refreshed;activeKeyVerified=true;}else if(refreshed==null&&current!=null){boolean local=db.hasLocalPersonalWorkspace(current.getString("id"));currentDenied=!local;if(!local)db.markWorkspaceUnavailable(current.getString("id"));list=db.cachedWorkspaces();if(local)merge(list,new JSONArray().put(new JSONObject(current.toString()).put("localOnly",true)));}}
   catch(NativeSync.HttpsTransport.HttpFailure denied){
    boolean pending=current!=null&&!db.setting("workspace-pending:"+current.optString("id"),"").isEmpty();
    if((denied.status==401&&pending)){cached=true;list=db.cachedWorkspaces();}
    else if(denied.status==401||denied.status==403||denied.status==404){boolean local=current!=null&&db.hasLocalPersonalWorkspace(current.getString("id"));currentDenied=!local;if(current!=null&&!local)db.markWorkspaceUnavailable(current.getString("id"));list=db.cachedWorkspaces();if(local)merge(list,new JSONArray().put(new JSONObject(current.toString()).put("localOnly",true)));}
    else cached=true;
    if(current==null)throw denied;
   }catch(Exception unavailable){if(current==null)throw unavailable;cached=true;}
   try{
    JSONArray remote=request("/api/workspaces",null,NativeAccount.token(db),true).getJSONArray("workspaces");
    db.cacheWorkspaces(remote);list=new JSONArray();merge(list,remote);authoritative=true;
    // Personal-key workspaces need not belong to the signed-in account.
    // Verify those keys online; an explicit revoked/denied result removes only the
    // catalog entry, never the local notes or encrypted credential.
    JSONArray personal=db.localKeyWorkspaces();
    for(int i=0;i<personal.length();i++){
     JSONObject local=personal.getJSONObject(i);String id=local.getString("id");
     if(lookup(list,id)!=null)continue;
     if(local.optBoolean("pendingRegistration")){cached=true;merge(list,new JSONArray().put(local));continue;}
     if(activeKeyVerified&&current!=null&&id.equals(current.optString("id"))){merge(list,new JSONArray().put(current));continue;}
     try{
      String key=db.localKeyCredential(id);if(key==null)continue;
      JSONArray verified=request("/api/workspaces",null,key,false).getJSONArray("workspaces");
      JSONObject match=lookup(verified,id);
      if(match!=null){db.updateWorkspaceMetadata(match);merge(list,new JSONArray().put(match));}
     }catch(NativeSync.HttpsTransport.HttpFailure denied){
      cached=true;merge(list,new JSONArray().put(new JSONObject(local.toString()).put("localOnly",true)));
     }catch(IOException offline){cached=true;merge(list,new JSONArray().put(local));}
    }
    if(current==null&&list.length()>0){current=list.getJSONObject(0);db.activateAccountWorkspace(current);}
    JSONObject newest=current==null?null:lookup(list,current.optString("id"));
    if(newest!=null){current=newest;currentDenied=false;}
   }catch(CredentialVault.KeyUnavailable unavailable){cached=!activeKeyVerified;}catch(Exception unavailable){cached=true;}
   if(current==null)throw new IOException("Workspace unavailable");
   if(!authoritative&&!currentDenied&&current!=null)merge(list,new JSONArray().put(current));
   boolean currentUnavailable=currentDenied||authoritative&&lookup(list,current.getString("id"))==null;
   return new JSONObject().put("workspaces",list).put("current",current.getString("id")).put("cached",cached).put("currentUnavailable",currentUnavailable).put("accountAccess",!db.setting("account-workspace:"+db.activeSpace(),"").isEmpty());
  }
  if(action.equals("select")){
   String id=args.getString("id");
   if(!id.matches("[a-f0-9]{64}"))throw new SecurityException("Invalid workspace");
   String accountToken=null;try{accountToken=NativeAccount.token(db);}catch(CredentialVault.KeyUnavailable ignored){}
   NativeSync.HttpsTransport.HttpFailure denied=null;IOException offline=null;boolean keyDenied=false;
   if(accountToken!=null){
    try{JSONObject w=request("/api/workspaces/"+id,null,accountToken,true).getJSONObject("workspace");db.activateAccountWorkspace(w);return new JSONObject().put("selected",true).put("cached",false);}
    catch(NativeSync.HttpsTransport.HttpFailure e){denied=e;}
    catch(IOException e){offline=e;}
   }
   String personalKey=db.localKeyCredential(id);boolean pendingRegistration=!db.setting("workspace-pending:"+id,"").isEmpty();
   if(personalKey!=null){
    try{
     JSONObject w=lookup(request("/api/workspaces",null,personalKey,false).getJSONArray("workspaces"),id);
     if(w==null)throw new SecurityException("Workspace key mismatch");
     db.updateWorkspaceMetadata(w);
     if(!db.activateCachedWorkspace(id))throw new IOException("Local workspace unavailable");
     db.bindWorkspaceIdentity(db.activeSpace(),w);
     return new JSONObject().put("selected",true).put("cached",false);
    }catch(NativeSync.HttpsTransport.HttpFailure e){denied=e;offline=null;keyDenied=true;}
    catch(IOException e){offline=e;}
   }
   if(pendingRegistration&&personalKey!=null&&keyDenied&&denied!=null&&denied.status==401&&db.activateCachedWorkspace(id))return new JSONObject().put("selected",true).put("cached",true).put("pendingRegistration",true);
   if(personalKey!=null&&keyDenied&&denied!=null&&(denied.status==401||denied.status==403||denied.status==404)&&db.activateCachedWorkspace(id))return new JSONObject().put("selected",true).put("cached",true).put("localOnly",true);
   // Offline access is available only when a credential exists and the server
   // could not be reached. A definite 401/403/404 is never treated as offline.
   if(offline!=null&&(accountToken!=null||personalKey!=null)&&db.activateCachedWorkspace(id))return new JSONObject().put("selected",true).put("cached",true);
   if(denied!=null){if(denied.status==403||denied.status==404||keyDenied&&denied.status==401)db.markWorkspaceUnavailable(id);throw denied;}
   if(offline!=null)throw offline;
   throw new SecurityException("Workspace authorization required");
  }
  if(action.equals("create")){JSONObject result=db.createLocalWorkspace(args.getString("name"));return new JSONObject().put("created",true).put("pendingRegistration",true).put("workspace",result.getJSONObject("workspace"));}
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
  if(action.equals("rename")){JSONObject local=db.cachedActiveWorkspace();if(local!=null&&!db.setting("workspace-pending:"+local.getString("id"),"").isEmpty()){local.put("name",args.getString("name"));db.updateWorkspaceMetadata(local);return new JSONObject().put("workspace",local).put("local",true);}}
  JSONObject w=ensure(db);String id=w.getString("id");boolean account=!db.setting("account-workspace:"+db.activeSpace(),"").isEmpty();String credential=account?NativeAccount.token(db):db.credential(db.activeSpace());
  if(action.equals("rename")){JSONObject result=request("/api/workspaces/"+id,new JSONObject().put("name",args.getString("name")),credential,account);db.updateWorkspaceMetadata(result.getJSONObject("workspace"));return result;}
  if(action.equals("associate")){JSONObject result=request("/api/workspaces/"+id+"/associate",new JSONObject().put("key",db.credential(db.activeSpace())),NativeAccount.token(db),true);return result;}
  if(action.equals("rotate")){JSONObject result=request("/api/workspaces/"+id+"/key",new JSONObject().put("confirm",true),credential,account);db.pairWorkspace(result.getString("key"),result.getJSONObject("workspace"),false);db.setSetting("account-workspace:"+db.activeSpace(),"");return new JSONObject().put("rotated",true);}
  throw new SecurityException("Workspace action denied");
 }
}

