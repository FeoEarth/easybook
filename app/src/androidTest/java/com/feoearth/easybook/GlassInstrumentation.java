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
        runOnMainSync(()->web=(WebView)activity.findViewById(android.R.id.content).findViewWithTag("notes-webview"));
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
    private void checkSafeArea() throws Exception {
        AtomicReference<String> error = new AtomicReference<>();
        runOnMainSync(() -> {
            android.view.WindowInsets insets=web.getRootWindowInsets();
            if(insets==null){error.set("Missing Android window insets");return;}
            android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
            android.graphics.Insets ime=insets.getInsets(android.view.WindowInsets.Type.ime());
            int[] position=new int[2];web.getLocationInWindow(position);
            android.view.View decor=activity.getWindow().getDecorView();
            if(bars.top==0)error.set("Status bar must be visible during this test");
            if(position[1]<bars.top)error.set("WebView overlaps status bar");
            if(position[0]<bars.left || position[0]+web.getWidth()>decor.getWidth()-bars.right)error.set("WebView overlaps cutout");
            if(position[1]+web.getHeight()>decor.getHeight()-Math.max(bars.bottom,ime.bottom))error.set("WebView overlaps navigation bar or keyboard");
        });
        if(error.get()!=null)throw new AssertionError(error.get());
    }
    private void checkKeyboard() throws Exception {
        js("document.getElementById('title').focus()");
        runOnMainSync(() -> {
            web.requestFocus();
            ((android.view.inputmethod.InputMethodManager)activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });
        boolean visible=false;
        for(int i=0;i<30;i++){
            AtomicReference<Boolean> shown=new AtomicReference<>(false);
            runOnMainSync(() -> shown.set(web.getRootWindowInsets().isVisible(android.view.WindowInsets.Type.ime())));
            if(shown.get()){visible=true;break;}Thread.sleep(100);
        }
        if(!visible)throw new AssertionError("Keyboard did not open");
        Thread.sleep(400);checkSafeArea();
        check("getComputedStyle(document.getElementById('title')).outlineStyle==='none'", "Focused title has no input frame");
        js("document.getElementById('body').focus()");
        check("getComputedStyle(document.getElementById('body')).outlineStyle==='none'", "Focused body has no input frame");
        shot("keyboard.png");
        runOnMainSync(() -> ((android.view.inputmethod.InputMethodManager)activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(web.getWindowToken(),0));
        js("document.activeElement.blur()");Thread.sleep(500);checkSafeArea();
    }
    private void shot(String name) throws Exception {
        CountDownLatch frame = new CountDownLatch(1);
        runOnMainSync(() -> {
            web.postVisualStateCallback(android.os.SystemClock.uptimeMillis(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long id) {frame.countDown();}
            });
            web.invalidate();
        });
        if(!frame.await(10,TimeUnit.SECONDS))throw new AssertionError("WebView visual frame timed out");
        Thread.sleep(500);
        AtomicReference<Bitmap> capture=new AtomicReference<>();
        runOnMainSync(() -> {
            Bitmap bitmap=Bitmap.createBitmap(((android.view.View)web.getParent()).getWidth(),((android.view.View)web.getParent()).getHeight(),Bitmap.Config.ARGB_8888);
            ((android.view.View)web.getParent()).draw(new android.graphics.Canvas(bitmap));
            capture.set(bitmap);
        });
        Bitmap image=capture.get();
        if(image==null)throw new AssertionError("Android screenshot unavailable");
        java.util.HashSet<Integer> colors=new java.util.HashSet<>();
        for(int y=110;y<image.getHeight()-110 && colors.size()<30;y+=6)
            for(int x=15;x<image.getWidth()-15 && colors.size()<30;x+=6)colors.add(image.getPixel(x,y));
        if(colors.size()<12)throw new AssertionError("App content has not been painted: "+name);
        File dir=new File(getTargetContext().getExternalFilesDir(null),"smoke");dir.mkdirs();
        try(FileOutputStream out=new FileOutputStream(new File(dir,name))){image.compress(Bitmap.CompressFormat.PNG,100,out);}image.recycle();
    }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            launch();checkSafeArea();check("document.getElementById('heading').textContent==='全部备忘录'","Home");shot("home.png");
            js("document.getElementById('foldersButton').click()");
            check("document.body.dataset.page==='folders' && !document.getElementById('folders').hidden && !document.querySelector('dialog[open]')", "Folders is a page, not a dialog");shot("folders.png");
            js("document.querySelector('[data-tab=all]').click()");
            check("document.body.dataset.page==='all' && document.getElementById('folders').hidden", "Folder opens notes list");
            js("window.handleBack()");check("document.body.dataset.page==='folders'", "Android back goes to folders");
            check("window.handleBack()===false", "Folders is navigation root");
            js("document.querySelector('[data-tab=all]').click()");
            js("window.receiveSharedText('## 清单\\n- [ ] 牛奶\\n- [ ] 鸡蛋')");
            check("!document.getElementById('editor').hidden","Editor navigation");
            js("document.getElementById('title').value='周末采购';document.getElementById('title').dispatchEvent(new Event('input',{bubbles:true}));window.persistNow()");
            check("JSON.parse(localStorage.getItem('easybook-'+localStorage.getItem('easybook-key'))).some(n=>n.title==='周末采购')","Local save");
            checkKeyboard();
            js("document.getElementById('previewButton').click()");
            check("document.querySelectorAll('#preview [role=checkbox]').length===2","Todo rendering");shot("editor.png");
            js("document.querySelector('#preview [role=checkbox]').click()");
            check("document.querySelector('#preview [role=checkbox]').getAttribute('aria-checked')==='true'","Todo toggle");
            js("document.getElementById('moreButton').click();document.getElementById('favoriteButton').click();window.persistNow();window.goHome()");
            check("!document.body.classList.contains('editing')","Back navigation");
            runOnMainSync(()->activity.finish());Thread.sleep(500);launch();
            check("document.getElementById('cards').innerText.includes('周末采购')","Activity restart persistence");shot("notes.png");
            js("document.getElementById('foldersButton').click();document.getElementById('createFolder').click();document.getElementById('folderName').value='工作';document.getElementById('newFolderForm').requestSubmit()");
            check("document.getElementById('customFolders').innerText.includes('工作')", "Create folder");
            js("document.getElementById('createFolder').click();document.getElementById('folderName').value='工作';document.getElementById('newFolderForm').requestSubmit()");
            check("document.getElementById('folderError').textContent.includes('同名')", "Duplicate folder validation");
            js("document.getElementById('newFolderDialog').close();document.querySelector('[data-tab=all]').click();document.querySelector('#cards [data-id]').click();document.getElementById('moreButton').click();document.getElementById('moveButton').click();document.querySelector('#moveFolders [data-move-folder]:not([data-move-folder=\"\"])').click();window.goHome();document.getElementById('foldersButton').click()");
            check("JSON.parse(localStorage.getItem('easybook-'+localStorage.getItem('easybook-key'))).find(n=>n.title==='周末采购').folder_id.length===36", "Move note persists assignment");shot("folders.png");
            js("document.querySelector('[data-tab=all]').click();window.receiveSharedText('咖啡 收据');document.getElementById('title').value='ＡＢＣ 报销';document.getElementById('title').dispatchEvent(new Event('input',{bubbles:true}));window.persistNow();window.goHome();document.getElementById('foldersButton').click();document.querySelector('#customFolders [data-folder-tab^=folder]').click()");
            js("document.getElementById('search').value='报销';document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}))");
            check("document.querySelectorAll('#cards [data-id]').length===0", "Current folder search excludes other folder");
            js("document.getElementById('scopeAll').click()");
            check("document.querySelectorAll('#cards [data-id]').length===1", "Global scope includes other folder");
            js("document.getElementById('search').value='abc  咖啡';document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}))");
            check("document.querySelectorAll('#cards [data-id]').length===1", "Full-width, case and multiple keywords");
            js("document.querySelector('#cards [data-id]').click();window.goHome()");
            check("document.getElementById('search').value==='abc  咖啡' && document.querySelectorAll('#cards [data-id]').length===1", "Search survives editor round trip");shot("search.png");
            js("document.getElementById('foldersButton').click();document.getElementById('search').value='牛奶';document.getElementById('search').dispatchEvent(new Event('compositionend',{bubbles:true}))");
            check("document.getElementById('folders').hidden && document.querySelectorAll('#cards [data-id]').length===1", "Folder root searches note body");
            js("document.getElementById('clearSearch').click()");check("!document.getElementById('folders').hidden && document.getElementById('home').hidden", "Clear root search restores folders");
            runOnMainSync(()->activity.finish());Thread.sleep(500);launch();
            check("JSON.parse(localStorage.getItem('easybook-folders-'+localStorage.getItem('easybook-key'))).some(f=>f.name==='工作') && JSON.parse(localStorage.getItem('easybook-'+localStorage.getItem('easybook-key'))).find(n=>n.title==='周末采购').folder_id.length===36", "Folder and assignment survive Activity restart");
            js("document.getElementById('foldersButton').click();document.getElementById('folderSettings').click();document.querySelector('button[data-theme=dark]').click()");
            check("document.documentElement.dataset.theme==='dark'","Dark appearance");
            check("typeof EasybookDevice.copy==='function' && typeof EasybookDevice.share==='function' && typeof EasybookDevice.exportNotes==='function' && typeof EasybookDevice.importNotes==='function'","Native actions");
            shot("settings.png");result.putString("passed","true");result.putString("checks","folder creation, duplicate validation, move, scoped/global/CJK/multiple-keyword search, persistence, native status/navigation/cutout bounds, launch, editor, local save, todo toggle, favorite, back, restart persistence, dark appearance, native actions");
            finish(Activity.RESULT_OK,result);
        }catch(Throwable e){result.putString("passed","false");result.putString("failure",e.toString());finish(Activity.RESULT_CANCELED,result);}
    }
}
