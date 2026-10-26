package com.feoearth.easybook;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;
public class AccountBridgePermissionTest {
 @Test public void workspaceAndAccountActionsCrossTheInitializedBridge()throws Exception{
  SecurityManager security=new SecurityManager(null,null,null);security.initialized(7);
  security.authorize("workspace.action",new JSONObject().put("action","list"),7);
  security.authorize("workspace.action",new JSONObject().put("action","member").put("accountId","fixture").put("role","reader"),7);
  security.authorize("account.manage",new JSONObject().put("action","history"),7);
 }
 @Test public void bridgeStillRejectsUnknownFieldsAndStaleDocuments()throws Exception{
  SecurityManager security=new SecurityManager(null,null,null);security.initialized(7);
  try{security.authorize("workspace.action",new JSONObject().put("action","list").put("token","forged"),7);fail();}catch(SecurityException expected){}
  try{security.authorize("account.manage",new JSONObject().put("action","history"),8);fail();}catch(SecurityException expected){}
 }
}
