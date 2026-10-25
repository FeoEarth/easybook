package com.feoearth.easybook;
import android.content.*;
import android.net.*;
import android.app.job.*;
import org.json.*;
import java.util.*;

/** Device/workspace settings only. Never writes note rows or outbox operations. */
final class SyncPolicy {
 static android.content.Context context;
 static void initialize(Context c){context=c.getApplicationContext();}
 static String name(String key){return "sync-policy:"+NoteRepository.spaceId(key);}
 static JSONObject read(NoteRepository db,String key)throws Exception{return clean(new JSONObject(db.setting(name(key),"{}")));}
 static JSONObject clean(JSONObject raw)throws Exception{
  JSONObject p=new JSONObject().put("autoChange",raw.optBoolean("autoChange",true)).put("paused",raw.optBoolean("paused",false)).put("all",raw.optBoolean("all",true));
  long interval=raw.optLong("interval",900000);boolean found=false;for(long value:new long[]{0,300000,900000,1800000,3600000,21600000,43200000,86400000})found|=value==interval;if(!found)throw new IllegalArgumentException("Invalid interval");p.put("interval",interval);
  String network=raw.optString("network","any");if(!network.matches("any|wifi|unmetered"))throw new IllegalArgumentException();p.put("network",network);
  int retention=raw.optInt("retention",30);if(retention!=0&&retention!=7&&retention!=30&&retention!=90)throw new IllegalArgumentException();p.put("retention",retention);
  JSONArray roots=raw.optJSONArray("roots"),out=new JSONArray();Set<String> seen=new HashSet<>();if(roots!=null){if(roots.length()>256)throw new IllegalArgumentException();for(int i=0;i<roots.length();i++){String id=roots.getString(i);if(!id.isEmpty()&&!id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))throw new IllegalArgumentException();if(seen.add(id))out.put(id);}}p.put("roots",out);return p;
 }
 static boolean folder(String id,JSONObject p,JSONObject items){if(p.optBoolean("all",true))return true;id=id==null?"":id;Set<String> roots=new HashSet<>();JSONArray a=p.optJSONArray("roots");if(a!=null)for(int i=0;i<a.length();i++)roots.add(a.optString(i));if(id.isEmpty())return roots.contains("");Set<String> seen=new HashSet<>();while(!id.isEmpty()&&seen.add(id)){if(roots.contains(id))return true;JSONObject item=items.optJSONObject("f:"+id);id=item==null?"":item.optString("parent");}return false;}
 static boolean note(JSONObject n,JSONObject p,JSONObject items,JSONObject origins){if(p.optBoolean("all",true))return true;if(n.optInt("purged")==1)return origins.has(n.optString("id"))&&folder(origins.optString(n.optString("id")),p,items);return folder(n.optString("folder_id"),p,items);}
 static JSONObject items(JSONObject management)throws Exception{JSONObject result=new JSONObject(management.getJSONObject("items").toString());JSONArray pending=management.getJSONArray("pending");for(int i=0;i<pending.length();i++){JSONObject op=pending.getJSONObject(i);if(op.optBoolean("blocked"))continue;String key=op.optString("key");if(!key.startsWith("f:"))continue;Set<String> seen=new HashSet<>();seen.add(key.substring(2));String parent=op.optString("parent");boolean cycle=false;while(!parent.isEmpty()){if(!seen.add(parent)){cycle=true;break;}JSONObject item=result.optJSONObject("f:"+parent);parent=item==null?"":item.optString("parent");}if(!cycle)result.put(key,new JSONObject().put("parent",op.optString("parent")).put("rank",op.optDouble("rank")));}return result;}

 static String query(JSONObject p){if(p.optBoolean("all",true))return "";JSONArray a=p.optJSONArray("roots");List<String> ids=new ArrayList<>();if(a!=null)for(int i=0;i<a.length();i++){String id=a.optString(i);ids.add(id.isEmpty()?"0":id);}return "&scope="+(ids.isEmpty()?"none":String.join(",",ids));}
 static boolean network(JSONObject p){if(context==null)return p.optString("network","any").equals("any");ConnectivityManager cm=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);NetworkCapabilities caps=cm.getNetworkCapabilities(cm.getActiveNetwork());if(caps==null||!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))return false;String n=p.optString("network","any");return n.equals("any")||n.equals("wifi")&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)||n.equals("unmetered")&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);}
 static JSONObject save(NoteRepository db,String key,JSONObject raw)throws Exception{JSONObject old=read(db,key),p=clean(raw);if(old.optBoolean("all")!=p.optBoolean("all")||!old.getJSONArray("roots").toString().equals(p.getJSONArray("roots").toString()))db.setSetting("cursor:"+NoteRepository.spaceId(key),"0");db.setSetting(name(key),p.toString());schedule(p);return p;}
 static void schedule(JSONObject p){if(context==null)return;JobScheduler jobs=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);jobs.cancel(8030);long interval=p.optLong("interval");if(p.optBoolean("paused")||interval==0)return;JobInfo.Builder b=new JobInfo.Builder(8030,new ComponentName(context,SyncJobService.class)).setPeriodic(Math.max(900000,interval)).setRequiredNetworkType(p.optString("network").equals("unmetered")?JobInfo.NETWORK_TYPE_UNMETERED:JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL);jobs.schedule(b.build());}
}
