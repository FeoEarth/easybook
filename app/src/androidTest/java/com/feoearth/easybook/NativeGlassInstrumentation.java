package com.feoearth.easybook;

import android.app.*;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.webkit.WebView;
import com.feoearth.easybook.glass.*;
import java.io.*;
import java.util.concurrent.*;
import org.json.*;

/** Fresh emulator profile only. Screenshot readback is evidence, never the rendering path. */
public final class NativeGlassInstrumentation extends Instrumentation {
    private MainActivity activity;
    private WebView web;
    private File evidence;
    private final JSONObject result=new JSONObject();
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    private void ui(Runnable r){runOnMainSync(r);}
    private String js(String code)throws Exception{
        CountDownLatch latch=new CountDownLatch(1);String[] out={null};ui(()->web.evaluateJavascript(code,v->{out[0]=v;latch.countDown();}));check(latch.await(10,TimeUnit.SECONDS),"JS response");return out[0];
    }
    private void until(String code)throws Exception{long end=SystemClock.uptimeMillis()+15000;while(SystemClock.uptimeMillis()<end){if("true".equals(js(code)))return;Thread.sleep(150);}throw new AssertionError("Timed out: "+code);}
    private void waitMenu()throws Exception{long end=SystemClock.uptimeMillis()+5000;while(SystemClock.uptimeMillis()<end){boolean[] ok={false};ui(()->ok[0]=activity.nativeGlass!=null&&activity.nativeGlass.isShowing()&&activity.nativeGlass.surface!=null&&activity.nativeGlass.surface.frames>0);if(ok[0]){Thread.sleep(350);return;}Thread.sleep(100);}throw new AssertionError("No sampled native menu");}
    private Bitmap screenshot(String name)throws Exception{waitForIdleSync();Bitmap b=getUiAutomation().takeScreenshot();check(b!=null,"screenshot");try(FileOutputStream out=new FileOutputStream(new File(evidence,name+".png"))){b.compress(Bitmap.CompressFormat.PNG,100,out);}return b;}
    private Rect rect(){Rect r=new Rect();ui(()->activity.nativeGlass.surface.getGlobalVisibleRect(r));return r;}
    private void click(String tag){ui(()->{View view=activity.getWindow().getDecorView().findViewWithTag(tag);check(view!=null,"native control "+tag);view.performClick();});}
    private double difference(Bitmap a,Bitmap b,Rect region,boolean edge){double sum=0;int n=0;for(int y=region.top+10;y<region.bottom-10;y+=3)for(int x=region.left+5;x<region.right-5;x+=3){if(edge&&x>region.left+30&&x<region.right-30)continue;int c=a.getPixel(x,y),d=b.getPixel(x,y);sum+=Math.abs(Color.red(c)-Color.red(d))+Math.abs(Color.green(c)-Color.green(d))+Math.abs(Color.blue(c)-Color.blue(d));n++;}return n==0?0:sum/(n*3);}
    @Override public void onStart(){Bundle status=new Bundle();try{
        evidence=new File(getTargetContext().getExternalFilesDir(null),"native-glass-evidence");evidence.mkdirs();
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        ui(()->web=activity.getWindow().getDecorView().findViewWithTag("notes-webview"));
        until("!!window.easybookRich && !!document.getElementById('listMore').onclick");
        js("document.getElementById('newTop').click();document.getElementById('title').value='原生玻璃验证';document.getElementById('title').dispatchEvent(new Event('input'));window.easybookRich.editor.commands.insertContent('WebView 内容采样、搜索和多选保持原有实现');document.getElementById('back').click()");
        Thread.sleep(600);js("document.getElementById('listMore').click()");
        if(Build.VERSION.SDK_INT<33){
            until("!document.getElementById('listDialog').hidden");check(activity.nativeGlass==null,"lower API uses Web menu");screenshot("api"+Build.VERSION.SDK_INT+"-web-fallback").recycle();js("handleBack()");result.put("fallback",true);
        }else{
            waitMenu();check(!activity.nativeGlass.surface.isBroken(),"AGSL compiled");Rect region=rect();
            // Deterministic HTML canvas-equivalent CSS bars remain inside the real WebView.
            js("var probe=document.createElement('div');probe.id='glass-probe';probe.style='position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:repeating-linear-gradient(110deg,#f02030 0px,#f02030 12px,#2060f0 12px,#2060f0 24px)';document.body.append(probe)");Thread.sleep(500);
            ui(()->activity.nativeGlass.surface.setRefractionForProbe(0));Thread.sleep(250);Bitmap plain=screenshot("api33plus-no-refraction");
            ui(()->activity.nativeGlass.surface.setRefractionForProbe(GlassMaterial.REFRACTION));Thread.sleep(250);Bitmap refracted=screenshot("api33plus-refraction-light");double edgeDifference=difference(plain,refracted,region,true);check(edgeDifference>1,"edge refraction changes actual WebView pixels: "+edgeDifference);result.put("edgeRefractionDifference",edgeDifference);
            long[] idle={0,0};ui(()->idle[0]=activity.nativeGlass.backdrop.recordings);Thread.sleep(700);ui(()->idle[1]=activity.nativeGlass.backdrop.recordings);check(idle[1]-idle[0]<12,"no self-invalidating backdrop loop");result.put("idleRecordings700ms",idle[1]-idle[0]);
            js("document.getElementById('glass-probe').style.background='repeating-linear-gradient(110deg,#10df60 0px,#10df60 12px,#ffde30 12px,#ffde30 24px)'");Thread.sleep(500);Bitmap changed=screenshot("api33plus-live-webview-change");double live=difference(refracted,changed,region,false);check(live>8,"live WebView sampling changes with content: "+live);result.put("liveBackdropDifference",live);plain.recycle();refracted.recycle();changed.recycle();
            // Scroll the WebView while the native overlay remains visible; no CPU capture.
            long[] before={0};ui(()->before[0]=activity.nativeGlass.backdrop.recordings);
            js("document.getElementById('glass-probe').remove();var tall=document.createElement('div');tall.id='scroll-probe';tall.style='height:3000px;background:linear-gradient(#fb4444,#3344ff)';document.getElementById('home').append(tall);window.scrollTo(0,250)");Thread.sleep(500);
            check(activity.nativeGlass.isShowing(),"scroll retains menu");check(activity.nativeGlass.backdrop.recordings>before[0],"scroll updates provider");result.put("scrollUpdates",true);
            click("native-glass-sort");click("native-glass-title");Thread.sleep(300);until("localStorage.getItem('easybook-note-sort')==='title'");
            js("window.scrollTo(0,0);document.getElementById('scroll-probe').remove();document.documentElement.dataset.theme='dark';document.getElementById('listMore').click()");waitMenu();screenshot("api33plus-refraction-dark").recycle();
            ui(()->activity.onBackPressed());Thread.sleep(300);check(!activity.nativeGlass.isShowing(),"Android back closes native menu");
            js("document.getElementById('listMore').click()");waitMenu();click("native-glass-select");Thread.sleep(350);until("document.body.classList.contains('selecting')");js("document.getElementById('cancelSelection').click();document.getElementById('listMore').click()");waitMenu();
            click("native-glass-checklist");Thread.sleep(350);until("document.body.classList.contains('editing') && document.getElementById('title').value==='今日待办'");
            js("document.getElementById('title').focus()");ui(()->((android.view.inputmethod.InputMethodManager)activity.getSystemService(Activity.INPUT_METHOD_SERVICE)).showSoftInput(web,0));Thread.sleep(1400);check(!activity.nativeGlass.isShowing(),"no native menu over editing/keyboard");
            boolean[] ime={false};ui(()->ime[0]=web.getRootWindowInsets()!=null && web.getRootWindowInsets().isVisible(WindowInsets.Type.ime()));check(ime[0],"real IME visible");screenshot("api33plus-keyboard-editor").recycle();result.put("keyboardVisible",true);
            result.put("interaction",true);result.put("api",Build.VERSION.SDK_INT);result.put("realDevicePerformance","not verified");
        }
        try(FileOutputStream out=new FileOutputStream(new File(evidence,"result.json"))){out.write(result.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        status.putString("results","passed=true "+result);finish(Activity.RESULT_OK,status);
    }catch(Throwable failure){try{if(evidence!=null)screenshot("failure").recycle();}catch(Exception ignored){}status.putString("results","passed=false "+android.util.Log.getStackTraceString(failure));finish(Activity.RESULT_CANCELED,status);}}
}
