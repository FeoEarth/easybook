package com.feoearth.easybook;

import android.app.*;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.graphics.Bitmap;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs in the actual Android WebView without depending on the emulator's accessibility bridge. */
public class GlassInstrumentation extends Instrumentation {
    private Activity activity;
    private WebView web;
    @Override public void onCreate(Bundle args) {super.onCreate(args);start();}
    private void launch() throws Exception {
        Intent i=new Intent(getTargetContext(),MainActivity.class);i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=startActivitySync(i);
        runOnMainSync(()->web=(WebView)((ViewGroup)activity.findViewById(android.R.id.content)).getChildAt(0));
        for(int x=0;x<50;x++){if("true".equals(js("!!document.getElementById('heading') && typeof window.handleBack==='function'")))return;Thread.sleep(200);}
        throw new AssertionError("WebView page did not initialize");
    }
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,v->{value.set(v);latch.countDown();}));
        if(!latch.await(15,TimeUnit.SECONDS))throw new AssertionError("JavaScript evaluation timed out");
        return value.get();
    }
    private void check(String script,String label) throws Exception {
        if(!"true".equals(js(script)))throw new AssertionError(label+": "+js("document.body.innerText.slice(0,300)"));
    }
    private void shot(String name) {
        try {Bitmap image=getUiAutomation().takeScreenshot();if(image==null)return;
            File dir=new File(getTargetContext().getExternalFilesDir(null),"smoke");dir.mkdirs();
            try(FileOutputStream out=new FileOutputStream(new File(dir,name))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();
        }catch(Exception ignored){}
    }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            launch();check("document.getElementById('heading').textContent==='备忘录'","Home");shot("home.png");
            js("window.receiveSharedText('## 清单\\n- [ ] 牛奶\\n- [ ] 鸡蛋')");
            check("!document.getElementById('editor').hidden","Editor navigation");
            js("document.getElementById('title').value='周末采购';document.getElementById('title').dispatchEvent(new Event('input',{bubbles:true}));window.persistNow()");
            check("JSON.parse(localStorage.getItem('easybook-'+localStorage.getItem('easybook-key'))).some(n=>n.title==='周末采购')","Local save");
            js("document.getElementById('previewButton').click()");
            check("document.querySelectorAll('#preview [role=checkbox]').length===2","Todo rendering");shot("editor.png");
            js("document.querySelector('#preview [role=checkbox]').click()");
            check("document.querySelector('#preview [role=checkbox]').getAttribute('aria-checked')==='true'","Todo toggle");
            js("document.getElementById('moreButton').click();document.getElementById('favoriteButton').click();window.persistNow();window.goHome()");
            check("!document.body.classList.contains('editing')","Back navigation");
            runOnMainSync(()->activity.finish());Thread.sleep(500);launch();
            check("document.getElementById('cards').innerText.includes('周末采购')","Activity restart persistence");shot("notes.png");
            js("document.querySelector('[data-tab=settings]').click();document.querySelector('button[data-theme=dark]').click()");
            check("document.documentElement.dataset.theme==='dark'","Dark appearance");
            check("typeof EasybookDevice.copy==='function' && typeof EasybookDevice.share==='function' && typeof EasybookDevice.exportNotes==='function' && typeof EasybookDevice.importNotes==='function'","Native actions");
            shot("settings.png");result.putString("passed","true");result.putString("checks","launch, editor, local save, todo toggle, favorite, back, restart persistence, dark appearance, native actions");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable e){result.putString("passed","false");result.putString("failure",e.toString());finish(Activity.RESULT_CANCELED,result);}
    }
}
