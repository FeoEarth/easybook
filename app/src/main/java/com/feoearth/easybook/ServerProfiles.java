package com.feoearth.easybook;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.job.JobScheduler;
import org.json.*;
import java.util.*;

/** Non-secret server registry. Removing a profile only hides it; its data stays on disk. */
final class ServerProfiles {
 static final String OFFICIAL="official";
 private static ServerProfiles instance;
 static synchronized ServerProfiles get(Context context){if(instance==null)instance=new ServerProfiles(context.getApplicationContext());return instance;}
 static final class Profile {
  final String id,origin,name;final boolean builtin,http,httpKeyOnly,verified;final long epoch;private final String capabilities;
  Profile(String id,String origin,String name,boolean builtin,boolean verified,JSONObject capabilities,long epoch){this.id=id;this.origin=origin;this.name=name;this.builtin=builtin;this.verified=builtin||verified;this.http=ServerAddress.isHttp(origin);this.httpKeyOnly=http;this.epoch=epoch;this.capabilities=capabilities==null?"{}":capabilities.toString();}
  JSONObject toJSON(){try{return new JSONObject().put("id",id).put("origin",origin).put("name",name).put("builtin",builtin).put("http",http).put("httpKeyOnly",httpKeyOnly).put("verified",verified).put("epoch",epoch).put("capabilities",new JSONObject(capabilities));}catch(JSONException e){throw new IllegalStateException(e);}}
 }
 private final Context context;private final SharedPreferences prefs;
 private ServerProfiles(Context context){this.context=context;prefs=context.getSharedPreferences("easybook-server-profiles",Context.MODE_PRIVATE);}
 synchronized long epoch(){return prefs.getLong("epoch",1);}
 private JSONObject records(){try{return new JSONObject(prefs.getString("profiles","{}"));}catch(JSONException e){throw new IllegalStateException("Server registry is unreadable",e);}}
 private static String name(String value){String clean=value==null?"":value.trim();if(clean.isEmpty()||clean.length()>60)throw new IllegalArgumentException("Server name must contain 1–60 characters");return clean;}
 private Profile profile(String id,long epoch,JSONObject records,boolean hidden){
  if(OFFICIAL.equals(id))return new Profile(OFFICIAL,NativeAccount.ORIGIN,"Easybook",true,true,null,epoch);
  JSONObject row=records.optJSONObject(id);if(row==null||!hidden&&row.optBoolean("hidden"))throw new IllegalArgumentException("Unknown server");String origin=ServerAddress.normalize(row.optString("origin"));if(!ServerAddress.id(origin).equals(id))throw new IllegalStateException("Server identity mismatch");
  return new Profile(id,origin,name(row.optString("name")),false,row.optBoolean("verified"),row.optJSONObject("capabilities"),epoch);
 }
 synchronized Profile active(){return profile(prefs.getString("active",OFFICIAL),epoch(),records(),false);}
 synchronized Profile profile(String id){return profile(id,epoch(),records(),false);}
 synchronized boolean isActive(String id,long epoch){return this.epoch()==epoch&&prefs.getString("active",OFFICIAL).equals(id);}
 synchronized JSONArray list(){JSONObject rows=records();JSONArray out=new JSONArray().put(profile(OFFICIAL,epoch(),rows,false).toJSON());Iterator<String> ids=rows.keys();while(ids.hasNext()){String id=ids.next();JSONObject row=rows.optJSONObject(id);if(row!=null&&!row.optBoolean("hidden"))out.put(profile(id,epoch(),rows,false).toJSON());}return out;}
 synchronized Profile add(String origin,String displayName,boolean acknowledgeHttp){
  origin=ServerAddress.normalize(origin);if(origin.equals(NativeAccount.ORIGIN))return profile(OFFICIAL,epoch(),records(),false);if(ServerAddress.isHttp(origin)&&!acknowledgeHttp)throw new IllegalArgumentException("Private HTTP requires acknowledgement");String id=ServerAddress.id(origin);JSONObject rows=records();JSONObject row=rows.optJSONObject(id);
  try{if(row==null)row=new JSONObject().put("origin",origin).put("verified",false);row.put("name",name(displayName)).put("hidden",false);rows.put(id,row);write(prefs.edit().putString("profiles",rows.toString()));return profile(id,epoch(),rows,false);}catch(JSONException e){throw new IllegalStateException(e);}
 }
 synchronized Profile rename(String id,String displayName){if(OFFICIAL.equals(id))throw new IllegalArgumentException("Official server cannot be renamed");JSONObject rows=records();profile(id,epoch(),rows,false);try{rows.getJSONObject(id).put("name",name(displayName));write(prefs.edit().putString("profiles",rows.toString()));return profile(id,epoch(),rows,false);}catch(JSONException e){throw new IllegalStateException(e);}}
 synchronized void remove(String id){if(OFFICIAL.equals(id))throw new IllegalArgumentException("Official server cannot be removed");if(prefs.getString("active",OFFICIAL).equals(id))throw new IllegalStateException("Switch servers before removing the current server");JSONObject rows=records();profile(id,epoch(),rows,false);try{rows.getJSONObject(id).put("hidden",true);write(prefs.edit().putString("profiles",rows.toString()));}catch(JSONException e){throw new IllegalStateException(e);}}
 synchronized Profile markVerified(String id,JSONObject capabilities){if(OFFICIAL.equals(id))return profile(OFFICIAL,epoch(),records(),false);JSONObject rows=records();profile(id,epoch(),rows,false);try{rows.getJSONObject(id).put("verified",true).put("capabilities",capabilities==null?new JSONObject():new JSONObject(capabilities.toString()));write(prefs.edit().putString("profiles",rows.toString()));return profile(id,epoch(),rows,false);}catch(JSONException e){throw new IllegalStateException(e);}}
 Profile select(String id){Profile previous,next;synchronized(this){JSONObject rows=records();next=profile(id,epoch(),rows,false);if(!next.verified)throw new IllegalStateException("Test the server connection first");previous=active();if(previous.id.equals(id))return previous;long updated=epoch()+1;if(updated<=0)throw new IllegalStateException("Server epoch exhausted");write(prefs.edit().putString("active",id).putLong("epoch",updated));next=profile(id,updated,rows,false);}NativeTransport.cancel(previous.id,previous.epoch);JobScheduler jobs=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(jobs!=null)jobs.cancel(8030);return next;}
 Profile activate(String id){return select(id);}
 private static void write(SharedPreferences.Editor edit){if(!edit.commit())throw new IllegalStateException("Server registry write failed");}
}
