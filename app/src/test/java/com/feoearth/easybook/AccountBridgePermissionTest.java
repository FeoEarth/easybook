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
  security.authorize("account.browser",new JSONObject(),7);security.authorize("account.resume",new JSONObject(),7);
 }
 @Test public void bridgeStillRejectsUnknownFieldsAndStaleDocuments()throws Exception{
  SecurityManager security=new SecurityManager(null,null,null);security.initialized(7);
  try{security.authorize("workspace.action",new JSONObject().put("action","list").put("token","forged"),7);fail();}catch(SecurityException expected){}
  try{security.authorize("account.manage",new JSONObject().put("action","history"),8);fail();}catch(SecurityException expected){}
 }
 @Test public void dockFocusStateIsAllowedWithoutOpeningOtherGlassEndpoints()throws Exception{
  SecurityManager security=new SecurityManager(null,null,null);security.initialized(7);
  JSONObject dock=new JSONObject().put("slot",0).put("visible",true).put("focused",false);
  security.authorize("ui.glass.dock",dock,7);
  dock.put("focused",true);
  security.authorize("ui.glass.dock",dock,7);
  try{security.authorize("ui.glass.pdf",dock,7);fail("PDF should not accept dock-only focus state");}catch(SecurityException expected){}
  try{security.authorize("ui.glass.dock",dock.put("unexpected",true),7);fail("Unknown dock fields must still be rejected");}catch(SecurityException expected){}
 }
 @Test public void aiPersonalizationAndModelSelectionsCrossTheInitializedBridge()throws Exception{
  SecurityManager security=new SecurityManager(null,null,null);security.initialized(7);
  security.authorize("membership.open",new JSONObject(),7);
  security.authorize("membership.status",new JSONObject(),7);
  try{security.authorize("membership.open",new JSONObject().put("url","https://example.com"),7);fail();}catch(SecurityException expected){}
  security.authorize("ai.preferences",new JSONObject().put("method","GET"),7);
  security.authorize("ai.preferences",new JSONObject().put("method","PUT").put("preferences",new JSONObject().put("version",1)),7);
  security.authorize("ai.models",new JSONObject().put("method","GET").put("credentialId","fixture").put("refresh",true),7);
  security.authorize("ai.select",new JSONObject().put("method","POST").put("credentialId","fixture"),7);
  security.authorize("ai.chat",new JSONObject().put("method","POST").put("credentialId","fixture").put("model","provider/model").put("purpose","memory"),7);
  // The AI UI always sends localSandboxBackend, even when sandbox use is disabled.
  // Both the regular JS backend and the opted-in Linux backend must cross the bridge.
  security.authorize("ai.stream.start",new JSONObject().put("id","fixture").put("credentialId","fixture").put("model","provider/model").put("localSandbox",false).put("localSandboxBackend","javascript"),7);
  security.authorize("ai.stream.start",new JSONObject().put("id","fixture").put("credentialId","fixture").put("model","provider/model").put("localSandbox",true).put("localSandboxBackend","linux"),7);
  try{security.authorize("ai.stream.start",new JSONObject().put("id","fixture").put("localSandboxBackend","javascript").put("unapproved",true),7);fail("Unknown AI stream fields must still be denied");}catch(SecurityException expected){}
  try{security.authorize("ai.preferences",new JSONObject().put("apiKey","forged"),7);fail("Preference requests cannot carry unrelated credential fields");}catch(SecurityException expected){}
  try{security.authorize("ai.preferences",new JSONObject().put("method","GET"),8);fail("Stale documents must remain denied");}catch(SecurityException expected){}
 }
}
