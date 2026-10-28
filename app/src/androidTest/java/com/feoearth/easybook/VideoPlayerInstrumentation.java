package com.feoearth.easybook;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import org.json.*;
import java.io.*;
import java.util.concurrent.*;

/** Real WebView/native fullscreen evidence, on a fresh isolated emulator only. */
public final class VideoPlayerInstrumentation extends Instrumentation {
 private MainActivity activity;private WebView web;private File evidence;private final JSONObject report=new JSONObject();
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 private void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 private void ui(Runnable code){runOnMainSync(code);}
 private String js(String code)throws Exception{CountDownLatch latch=new CountDownLatch(1);String[] value={null};ui(()->web.evaluateJavascript(code,v->{value[0]=v;latch.countDown();}));check(latch.await(10,TimeUnit.SECONDS),"JS response timed out");return value[0];}
 private void until(String code,long timeout)throws Exception{long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){if("true".equals(js(code)))return;Thread.sleep(100);}throw new AssertionError("Timeout: "+code);}
 private JSONObject object(String code)throws Exception{String encoded=js("JSON.stringify("+code+")");return new JSONObject(new JSONArray("["+encoded+"]").getString(0));}
 private void screenshot(String name)throws Exception{waitForIdleSync();Bitmap b=getUiAutomation().takeScreenshot();check(b!=null,"Screenshot unavailable");try(FileOutputStream out=new FileOutputStream(new File(evidence,name+".png"))){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();}
 private void tap(String selector)throws Exception{
  JSONObject rect=object("(()=>{const r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");int[] location=new int[2];ui(()->web.getLocationOnScreen(location));float density=activity.getResources().getDisplayMetrics().density;
  float x=location[0]+(float)rect.getDouble("x")*density,y=location[1]+(float)rect.getDouble("y")*density;long now=SystemClock.uptimeMillis();
  MotionEvent down=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,x,y,0);try{sendPointerSync(down);sendPointerSync(up);}finally{down.recycle();up.recycle();}
 }
 private void fixture(String file,String name)throws Exception{
  NoteRepository repository=NoteRepository.get(getTargetContext());String space=repository.activeSpace();JSONObject meta;
  try(InputStream in=getContext().getAssets().open(file)){meta=repository.attachments.saveStream(space,name,"video/mp4",in,true,null,-1);}
  js("document.getElementById('newTop').click();document.getElementById('title').value='播放器像素验收';document.getElementById('title').dispatchEvent(new Event('input'));window.easybookRich.attachment("+JSONObject.quote(meta.getString("id"))+","+JSONObject.quote(name)+",'video/mp4',"+meta.getLong("size")+");document.activeElement?.blur()");
  ui(()->((InputMethodManager)activity.getSystemService(Activity.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0));
  until("document.querySelector('.eb-video video')?.readyState>=2",20000);
  js("window.probeVideo=document.querySelector('.eb-video video');probeVideo.loop=true;probeVideo.playbackRate=.5;probeVideo.currentTime=1");until("!probeVideo.seeking",10000);Thread.sleep(400);
 }
 @Override public void onStart(){Bundle status=new Bundle();try{
  evidence=new File(getTargetContext().getExternalFilesDir(null),"video-player-evidence");check(evidence.mkdirs()||evidence.isDirectory(),"Evidence directory");
  activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));ui(()->web=activity.getWindow().getDecorView().findViewWithTag("notes-webview"));check(web!=null,"WebView missing");
  until("!!window.easybookRich && document.documentElement.dataset.platform==='android'",45000);
  report.put("api",Build.VERSION.SDK_INT).put("webView",android.webkit.WebView.getCurrentWebViewPackage().versionName).put("physicalDevice",false);
  fixture("video-probe.mp4","横屏视频.mp4");screenshot("01-inline-paused");tap(".eb-video-play");until("!probeVideo.paused && probeVideo.getVideoPlaybackQuality().totalVideoFrames>0",10000);screenshot("02-inline-playing");
  until("getComputedStyle(document.querySelector('.eb-video-controls')).opacity==='0'",6000);screenshot("03-inline-hidden");tap(".eb-video video");until("getComputedStyle(document.querySelector('.eb-video-controls')).opacity==='1'",2000);tap(".eb-video-play");until("probeVideo.paused",5000);
  tap(".media-open");until("document.getElementById('attachmentDialog').open && document.querySelector('#previewStage video')===probeVideo",5000);Thread.sleep(400);screenshot("04-preview-paused");
  double before=Double.parseDouble(js("probeVideo.currentTime"));tap(".eb-video-top>button");until("!!document.fullscreenElement && innerWidth>innerHeight",10000);Thread.sleep(600);
  check(Math.abs(Double.parseDouble(js("probeVideo.currentTime"))-before)<.1,"Fullscreen reset position");
  JSONObject geometry=object("(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}},p=document.fullscreenElement;return{viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},root:r('.eb-video'),video:r('.eb-video video'),play:r('.eb-video-play'),back:r('.eb-video-skip'),close:r('.eb-video-top>button'),volume:r('.eb-video-sound'),fit:getComputedStyle(probeVideo).objectFit}})()");
  double width=geometry.getJSONObject("viewport").getDouble("w"),height=geometry.getJSONObject("viewport").getDouble("h"),unit=width/874.0,tolerance=1.0/geometry.getJSONObject("viewport").getDouble("dpr");
  check(Math.abs(geometry.getJSONObject("play").getDouble("w")-88*unit)<=tolerance,"Play diameter differs by >1 physical pixel");check(Math.abs(geometry.getJSONObject("back").getDouble("w")-64*unit)<=tolerance,"Skip diameter differs by >1 physical pixel");check(Math.abs(geometry.getJSONObject("close").getDouble("x")-62*unit)<=tolerance,"Close x differs by >1 physical pixel");check(Math.abs(geometry.getJSONObject("root").getDouble("w")-width)<=tolerance&&Math.abs(geometry.getJSONObject("video").getDouble("h")-height)<=tolerance,"Video must fill fullscreen");check("contain".equals(geometry.getString("fit")),"Uncropped contain");
  report.put("fullscreenGeometry",geometry);screenshot("05-fullscreen-paused");tap(".eb-video-play");until("!probeVideo.paused && probeVideo.readyState>=2 && probeVideo.currentTime>"+(before+.25),15000);screenshot("06-fullscreen-playing");until("getComputedStyle(document.querySelector('.eb-video-controls')).opacity==='0'",6000);screenshot("07-fullscreen-hidden");tap(".eb-video video");
  ui(()->activity.onBackPressed());until("!document.fullscreenElement && innerHeight>innerWidth",10000);check(Double.parseDouble(js("probeVideo.currentTime"))>0,"Back lost playback position");Thread.sleep(400);screenshot("08-native-back-restored");
  js("probeVideo.pause();document.querySelector('[data-close=attachmentDialog]').click();document.getElementById('back').click()");Thread.sleep(400);
  fixture("video-portrait-probe.mp4","竖屏视频.mp4");screenshot("09-portrait-inline");tap(".media-open");until("document.getElementById('attachmentDialog').open",5000);Thread.sleep(400);screenshot("10-portrait-preview");
  report.put("passed",true).put("limits","Actual Android emulator captures; not physical-device or Apple optical-material pixel equivalence.");save();status.putString("results","passed=true "+report);finish(Activity.RESULT_OK,status);
 }catch(Throwable failure){try{report.put("failure",android.util.Log.getStackTraceString(failure));if(web!=null)report.put("diagnostic",object("(()=>{const p=window.probeVideo,r=p?.closest('.eb-video');return{time:p?.currentTime,paused:p?.paused,readyState:p?.readyState,hidden:document.hidden,fullscreen:!!document.fullscreenElement,controls:r?.className,state:r?.dataset.state,focusVisible:!!r?.querySelector(':focus-visible')||!!r?.matches(':focus-visible'),focused:document.activeElement?.tagName,message:r?.querySelector('.eb-video-message')?.textContent}})()"));if(evidence!=null){screenshot("failure");save();}}catch(Throwable ignored){}status.putString("results","passed=false "+android.util.Log.getStackTraceString(failure));finish(Activity.RESULT_CANCELED,status);}}
 private void save()throws Exception{try(FileOutputStream out=new FileOutputStream(new File(evidence,"result.json"))){out.write(report.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
}
