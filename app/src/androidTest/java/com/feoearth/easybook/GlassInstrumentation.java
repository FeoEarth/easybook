package com.feoearth.easybook;

import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebView;
import com.feoearth.easybook.glass.GlassSurface;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

public class GlassInstrumentation extends PhaseTwoInstrumentation {
    static void checkOtaUpgrade(Context target) throws Exception {
        String fixtureName="ota-test-"+UUID.randomUUID();
        File filesDir=new File(target.getCacheDir(),fixtureName);
        SharedPreferences prefs=target.getSharedPreferences(fixtureName,Context.MODE_PRIVATE);
        Context context=new ContextWrapper(target){
            @Override public Context getApplicationContext(){return this;}
            @Override public File getFilesDir(){return filesDir;}
            @Override public SharedPreferences getSharedPreferences(String name,int mode){return prefs;}
        };
        String active="aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc";
        File slot=new File(new File(filesDir,"web-ota"),active);
        try{
            Files.createDirectories(slot.toPath());
            for(String asset:new String[]{"index.html","editor.js","native_update.js"}){
                Files.write(slot.toPath().resolve(asset),asset.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            prefs.edit().putInt("nativeVersionCode",BuildConfig.VERSION_CODE).putString("active",active).commit();
            WebOtaManager sameVersion=new WebOtaManager(context);
            DataLayerChecks.require("index.html".equals(sameVersion.read("index.html")),"current APK retains its active OTA");
            sameVersion.ready();
            prefs.edit().putInt("nativeVersionCode",BuildConfig.VERSION_CODE-1)
                .putString("previous",active).putString("rejected",active).putBoolean("bootPending",true).commit();
            DataLayerChecks.require(new WebOtaManager(context).read("index.html")==null,"upgraded APK boots with its bundled layout");
            DataLayerChecks.require(!prefs.contains("active")&&!prefs.contains("previous")&&!prefs.contains("rejected")
                &&!prefs.getBoolean("bootPending",false),"old OTA cannot roll back or block a new update");
            prefs.edit().remove("nativeVersionCode").putString("active",active).commit();
            DataLayerChecks.require(new WebOtaManager(context).read("index.html")==null,"pre-upgrade OTA without a version also yields to the APK");
        }finally{
            for(File file:new File[]{new File(slot,"index.html"),new File(slot,"editor.js"),new File(slot,"native_update.js"),slot,slot.getParentFile(),filesDir})file.delete();
            target.deleteSharedPreferences(fixtureName);
        }
    }

    static void checkDock(Instrumentation test) throws Exception {
        MainActivity activity=(MainActivity)test.startActivitySync(new Intent(test.getTargetContext(),MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView web=activity.getWindow().getDecorView().findViewWithTag("notes-webview");
        DataLayerChecks.require(web!=null,"main WebView is missing");
        long deadline=SystemClock.uptimeMillis()+35000;
        while(!"true".equals(evaluate(test,web,"window.EasybookNativeUiReady===true"))){
            DataLayerChecks.require(SystemClock.uptimeMillis()<deadline,"native UI never became ready");
            SystemClock.sleep(150);
        }
        evaluate(test,web,"document.getElementById('foldersButton').click()");
        String[] tags={"DockSearch","DockFolder","DockCompose"};
        awaitDraw(test,()->{
            for(String tag:tags){
                View view=activity.getWindow().getDecorView().findViewWithTag("dock-glass-surface-"+tag);
                if(!(view instanceof GlassSurface)||!view.isShown()||((GlassSurface)view).frames==0)return false;
            }
            return true;
        });
        DataLayerChecks.require("3".equals(evaluate(test,web,"document.querySelectorAll('#navigation .native-dock-mounted').length")),
            "CSS dock controls remained above the native projections");
    }

    private static String evaluate(Instrumentation test,WebView web,String script) throws Exception {
        CompletableFuture<String> result=new CompletableFuture<>();
        test.runOnMainSync(()->web.evaluateJavascript(script,result::complete));
        return result.get(10,TimeUnit.SECONDS);
    }

    private static void awaitDraw(Instrumentation test,BooleanSupplier check) throws Exception {
        long deadline=SystemClock.uptimeMillis()+25000;
        do {
            boolean[] ready={false};
            test.runOnMainSync(()->ready[0]=check.getAsBoolean());
            if(ready[0])return;
            SystemClock.sleep(150);
        } while(SystemClock.uptimeMillis()<deadline);
        throw new AssertionError("all three QWEA0 dock surfaces must draw on Android");
    }
}
