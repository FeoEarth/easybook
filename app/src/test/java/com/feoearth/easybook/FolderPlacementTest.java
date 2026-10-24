package com.feoearth.easybook;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.UUID;

public class FolderPlacementTest {
    private JSONObject move(String key)throws Exception{return new JSONObject().put("id",UUID.randomUUID().toString()).put("key",key).put("parent","").put("rank",1024);}
    @Test public void bridgeAcceptsFolderPlacementAndRejectsUnknownFields()throws Exception{
        JSONObject changes=new JSONObject().put("notes",new JSONArray()).put("folders",new JSONArray()).put("placements",new JSONArray().put(move("f:"+UUID.randomUUID())));
        FolderPlacement.validateCommit(changes);changes.put("unexpected",true);try{FolderPlacement.validateCommit(changes);fail("Unknown field authorized");}catch(SecurityException expected){}
        changes.remove("unexpected");changes.put("placements",new JSONArray().put(move("n:"+UUID.randomUUID())));try{FolderPlacement.validateCommit(changes);fail("Retired note placement accepted");}catch(IllegalArgumentException expected){}
    }
    @Test public void durableQueueRoundTripAndAcknowledgement()throws Exception{
        String folder=UUID.randomUUID().toString(),parent=UUID.randomUUID().toString();JSONObject op=move("f:"+folder).put("parent",parent);
        JSONObject saved=FolderPlacement.append(null,new JSONArray().put(op));
        // Same JSON payload persisted by NoteRepository; emulate a process restart.
        JSONObject reopened=FolderPlacement.clean(new JSONObject(saved.toString()));assertEquals(op.getString("id"),reopened.getJSONArray("pending").getJSONObject(0).getString("id"));
        JSONObject items=new JSONObject().put(op.getString("key"),new JSONObject().put("parent",parent).put("rank",1024));
        JSONObject ack=FolderPlacement.result(reopened,new JSONObject().put("version",1).put("items",items),op.getString("id"),"","");assertEquals(0,ack.getJSONArray("pending").length());assertEquals(parent,ack.getJSONObject("items").getJSONObject("f:"+folder).getString("parent"));
    }
    @Test public void upgradeRetiresOnlyNoteMetadataAndStopsPoisonRetries()throws Exception{
        JSONObject op=move("f:"+UUID.randomUUID()),note=move("n:"+UUID.randomUUID());JSONObject old=new JSONObject().put("version",2).put("items",new JSONObject().put(note.getString("key"),new JSONObject().put("rank",1)).put(op.getString("key"),new JSONObject().put("parent","").put("rank",2))).put("pending",new JSONArray().put(note).put(op));
        JSONObject m=FolderPlacement.clean(old);assertEquals(1,m.getJSONObject("items").length());assertEquals(1,m.getJSONArray("pending").length());
        for(int i=0;i<3;i++)m=FolderPlacement.failure(m,op.getString("id"),0);JSONObject task=m.getJSONArray("pending").getJSONObject(0);assertTrue(task.getBoolean("blocked"));assertEquals(4,FolderPlacement.wire(task).length());
        assertFalse(FolderPlacement.retry(m).getJSONArray("pending").getJSONObject(0).optBoolean("blocked"));
        m=FolderPlacement.result(m,null,"",op.getString("id"),"invalid");assertTrue(FolderPlacement.retry(m).getJSONArray("pending").getJSONObject(0).getBoolean("blocked"));
    }
}
