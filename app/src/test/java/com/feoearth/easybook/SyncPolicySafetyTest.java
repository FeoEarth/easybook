package com.feoearth.easybook;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
public class SyncPolicySafetyTest {
 private final String a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
 @Test public void scopeNeverMeansDelete()throws Exception{
  JSONObject p=SyncPolicy.clean(new JSONObject().put("all",false).put("roots",new JSONArray().put(a))),items=new JSONObject().put("f:"+b,new JSONObject().put("parent",a));
  assertTrue(SyncPolicy.folder(b,p,items));assertFalse(SyncPolicy.folder("",p,items));
  JSONObject unclassified=SyncPolicy.clean(new JSONObject().put("all",false).put("roots",new JSONArray().put("")));
  assertTrue(SyncPolicy.folder("",unclassified,items));assertFalse(SyncPolicy.folder(a,unclassified,items));
  JSONObject held=new JSONObject().put("id","n").put("folder_id",b).put("dirty",true).put("mutation","unchanged"),none=SyncPolicy.clean(new JSONObject().put("all",false));String before=held.toString();
  assertFalse(SyncPolicy.note(held,none,items,new JSONObject()));assertEquals(before,held.toString());assertTrue(SyncPolicy.note(held,p,items,new JSONObject()));
  JSONObject purge=new JSONObject().put("id","n").put("purged",1);assertFalse(SyncPolicy.note(purge,p,items,new JSONObject()));assertTrue(SyncPolicy.note(purge,p,items,new JSONObject().put("n",b)));
  assertEquals("&scope=none",SyncPolicy.query(none));assertEquals("&scope=0",SyncPolicy.query(unclassified));assertEquals(30,SyncPolicy.clean(new JSONObject()).getInt("retention"));
  assertFalse(SyncJournal.terminal(new JSONObject().put("state","running")));assertFalse(SyncJournal.terminal(new JSONObject().put("state","queued")));assertTrue(SyncJournal.terminal(new JSONObject().put("state","failed")));
 }
}
