package com.feoearth.easybook;

import org.json.*;
import java.util.*;

/** Folder-only bridge contract and durable outbox repair; no note payloads. */
final class FolderPlacement {
    static final String UUID="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
    static JSONObject wire(JSONObject op)throws Exception{
        if(!(op.get("id") instanceof String)||!op.getString("id").matches(UUID)||!(op.get("key") instanceof String)||!op.getString("key").matches("f:"+UUID)||!(op.get("parent") instanceof String)||!op.getString("parent").matches("(?:"+UUID+")?")||!(op.get("rank") instanceof Number)||!Double.isFinite(op.getDouble("rank"))||Math.abs(op.getDouble("rank"))>1e12||op.getString("key").substring(2).equals(op.getString("parent")))throw new IllegalArgumentException("Invalid folder placement");
        return new JSONObject().put("id",op.getString("id")).put("key",op.getString("key")).put("parent",op.getString("parent")).put("rank",op.getDouble("rank"));
    }
    static void validateCommit(JSONObject changes)throws Exception{
        Set<String> allowed=new HashSet<>(Arrays.asList("notes","folders","placements"));Iterator<String> keys=changes.keys();while(keys.hasNext())if(!allowed.contains(keys.next()))throw new SecurityException("Unexpected commit field");
        for(String name:allowed)if(changes.has(name)){if(!(changes.get(name) instanceof JSONArray))throw new SecurityException("Invalid batch");JSONArray batch=changes.getJSONArray(name);if(batch.length()>5000)throw new SecurityException("Batch too large");if(name.equals("placements"))for(int i=0;i<batch.length();i++)wire(batch.getJSONObject(i));}
    }
    static JSONObject clean(JSONObject raw)throws Exception{
        JSONObject m=raw==null?new JSONObject():new JSONObject(raw.toString());m.put("id","layout");if(m.optLong("version",-1)<0)m.put("version",0);
        JSONObject items=new JSONObject(),source=m.optJSONObject("items");if(source!=null){Iterator<String> keys=source.keys();while(keys.hasNext()){String key=keys.next();if(key.matches("f:"+UUID))items.put(key,source.get(key));}}m.put("items",items);
        JSONArray queue=new JSONArray(),pending=m.optJSONArray("pending");Set<String> ids=new HashSet<>();if(pending!=null)for(int i=0;i<pending.length();i++){JSONObject op=pending.optJSONObject(i);if(op==null||op.optString("key").startsWith("n:"))continue;try{wire(op);}catch(Exception bad){op.put("blocked",true).put("reason","invalid");}if(ids.add(op.optString("id")))queue.put(op);}m.put("pending",queue);return m;
    }
    static JSONObject append(JSONObject raw,JSONArray ops)throws Exception{
        JSONObject m=clean(raw);JSONArray pending=m.getJSONArray("pending");Set<String> ids=new HashSet<>();for(int i=0;i<pending.length();i++)ids.add(pending.getJSONObject(i).optString("id"));
        for(int i=0;i<ops.length();i++){JSONObject op=wire(ops.getJSONObject(i));if(!ids.add(op.getString("id")))continue;JSONArray kept=new JSONArray();for(int j=0;j<pending.length();j++){JSONObject previous=pending.getJSONObject(j);if(!(previous.optBoolean("blocked")&&previous.optString("key").equals(op.getString("key"))))kept.put(previous);}pending=kept;pending.put(op);}m.put("pending",pending);return m;
    }
    static JSONObject result(JSONObject raw,JSONObject remote,String accepted,String rejected,String reason)throws Exception{
        JSONObject m=clean(raw);if(remote!=null&&remote.getLong("version")>=m.optLong("version")){m.put("version",remote.getLong("version")).put("items",remote.getJSONObject("items"));}JSONArray pending=m.getJSONArray("pending"),next=new JSONArray();for(int i=0;i<pending.length();i++){JSONObject op=pending.getJSONObject(i);if(op.optString("id").equals(accepted))continue;if(op.optString("id").equals(rejected))op.put("blocked",true).put("reason",reason);next.put(op);}m.put("pending",next);return clean(m);
    }
    static JSONObject failure(JSONObject raw,String id,long now)throws Exception{
        JSONObject m=clean(raw);JSONArray pending=m.getJSONArray("pending");for(int i=0;i<pending.length();i++){JSONObject op=pending.getJSONObject(i);if(op.optString("id").equals(id)){int failures=op.optInt("failures")+1;op.put("failures",failures).put("retryAfter",now+Math.min(300000L,15000L*(1L<<Math.min(failures,4))));if(failures>=3)op.put("blocked",true).put("reason","retry-exhausted");}}return m;
    }
    static JSONObject retry(JSONObject raw)throws Exception{
        JSONObject m=clean(raw);JSONArray pending=m.getJSONArray("pending");for(int i=0;i<pending.length();i++){JSONObject op=pending.getJSONObject(i);if(op.optString("reason").equals("retry-exhausted")){op.remove("blocked");op.remove("reason");}op.remove("failures");op.remove("retryAfter");}return m;
    }
}
