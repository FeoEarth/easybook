package com.feoearth.easybook;
import android.app.Instrumentation;
import android.os.Bundle;
import org.json.*;
public class PhaseTwoInstrumentation extends Instrumentation {
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle out=new Bundle();try{
  DocumentModel.initialize(getTargetContext());
  java.io.InputStream in=getContext().getAssets().open("document-fixtures.json");java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);in.close();JSONObject fixtures=new JSONObject(bytes.toString("UTF-8"));JSONArray valid=fixtures.getJSONArray("valid"),invalid=fixtures.getJSONArray("invalid");
  for(int i=0;i<valid.length();i++){JSONObject v=valid.getJSONObject(i);DocumentModel.validate(v);DocumentModel.validate(new JSONObject(v.toString()));}
  for(int i=0;i<invalid.length();i++){boolean rejected=false;try{DocumentModel.validate(invalid.getJSONObject(i));}catch(Exception expected){rejected=true;}DataLayerChecks.require(rejected,"shared invalid fixture rejected");}
  DataLayerChecks.run(getTargetContext());AttachmentChecks.run(getTargetContext());SecurityChecks.run(getTargetContext());out.putString("passed","true");finish(-1,out);
 }catch(Throwable e){out.putString("passed","false");out.putString("error",android.util.Log.getStackTraceString(e));finish(0,out);}}
}
