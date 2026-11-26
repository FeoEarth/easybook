package com.feoearth.easybook;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebView;
import com.feoearth.easybook.glass.GlassSurface;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

public class GlassInstrumentation extends PhaseTwoInstrumentation {
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
