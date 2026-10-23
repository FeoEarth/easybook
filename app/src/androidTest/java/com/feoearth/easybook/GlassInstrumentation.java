package com.feoearth.easybook;

import android.app.*;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.graphics.Bitmap;
import org.json.*;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs in the actual Android WebView without depending on the emulator's accessibility bridge. */
public class GlassInstrumentation extends Instrumentation {
    private boolean offlineChecks;
    private Activity activity;
    private WebView web;
    @Override public void onCreate(Bundle args) {super.onCreate(args);offlineChecks=args!=null&&"true".equals(args.getString("offlineChecks"));start();}
    private void launch() throws Exception {
        Intent i=new Intent(getTargetContext(),MainActivity.class);i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity=startActivitySync(i);
        runOnMainSync(()->web=(WebView)activity.findViewById(android.R.id.content).findViewWithTag("notes-webview"));
        for(int x=0;x<50;x++){if("true".equals(js("!!document.getElementById('heading') && typeof window.handleBack==='function'")))return;Thread.sleep(200);}
        throw new AssertionError("WebView page did not initialize");
    }
    private String js(String script) throws Exception {
        if(web==null)throw new IllegalStateException("WebView not yet launched");
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,v->{value.set(v);latch.countDown();}));
        if(!latch.await(15,TimeUnit.SECONDS))throw new AssertionError("JavaScript evaluation timed out");
        return value.get();
    }
    private void check(String script,String label) throws Exception {
        for(int i=0;i<100;i++){if("true".equals(js(script)))return;Thread.sleep(100);}
        throw new AssertionError(label+": "+js("document.body.innerText.slice(0,300)"));
    }
    private void flush()throws Exception{js("window.__flushed=false;window.flushNative().then(()=>window.__flushed=true)");check("window.__flushed===true","Native transaction acknowledged");}
    private void checkNative(String expression,String label)throws Exception{flush();js("window.__nativeCheck=false;window.NativeStore.call('snapshot').then(s=>window.__nativeCheck=("+expression+"))");check("window.__nativeCheck===true",label);}
    private void seedLegacy()throws Exception{
        String k=NoteRepository.newKey(),other=NoteRepository.newKey(),folderId=NoteRepository.id();JSONObject folder=new JSONObject().put("id",folderId).put("name","历史").put("updated",1).put("dirty",true);
        JSONObject n=DataLayerChecks.note(NoteRepository.id(),"从 localStorage 迁移的正文").put("title","旧版笔记").put("folder_id",folderId).put("updated",1);
        JSONObject data=DataLayerChecks.source(k,new JSONArray().put(n),new JSONArray().put(folder));data.getJSONObject("storage").put("easybook-"+other,new JSONArray().put(DataLayerChecks.note(NoteRepository.id(),"非活动空间旧笔记")).toString());
        js("(()=>{const s="+data.toString()+";for(const [name,value]of Object.entries(s.storage))localStorage.setItem(name,value);localStorage.setItem('easybook-key',s.active)})()");
        NoteRepository.get(getTargetContext()).activate(k);runOnMainSync(()->activity.finish());Thread.sleep(300);launch();
        checkNative("s.notes.some(n=>n.body==='从 localStorage 迁移的正文') && s.folders.some(f=>f.name==='历史')","Actual WebView legacy notes and folders migrated");
        check("!localStorage.getItem('easybook-key') && !Object.keys(localStorage).some(k=>/^easybook-(?:folders-)?[a-f0-9]{64}$/.test(k))","Legacy credentials and key-bearing names removed after verification");
        checkNative("s.key.startsWith('space:') && !JSON.stringify(s).includes('"+k+"')", "No credential in native response");
        // Native data must survive loss of the renderer's storage cache.
        js("localStorage.clear()");runOnMainSync(()->activity.finish());Thread.sleep(300);launch();
        checkNative("s.notes.some(n=>n.title==='旧版笔记')","SQLite survives WebView storage clearing");
        js("window.__rolled=false;window.rollbackNativeMigration().then(()=>window.__rolled=true)");
        check("window.__rolled===true && !localStorage.getItem('easybook-key')", "Native encrypted rollback never restores renderer credentials");
        js("window.retryNativeMigration()");Thread.sleep(500);
        check("typeof window.handleBack==='function'", "Retry remains native");
        checkNative("s.notes.filter(n=>n.title==='旧版笔记').length===1", "Rollback/retry does not duplicate or lose records");
    }
    private void bridgeSecurity()throws Exception{
        js("window.__denied=false;window.NativeStore.call('executeSql',{sql:'DROP TABLE records'}).catch(()=>window.__denied=true)");check("window.__denied===true","Bridge method allowlist");
        for(String method:new String[]{"activate","migration.enableLegacy","device.exportLegacy","credential.get"}){js("window.__denied=false;window.NativeStore.call("+JSONObject.quote(method)+").catch(()=>window.__denied=true)");check("window.__denied===true","Secret/legacy operation denied");}
        js("window.__denied=false;window.NativeStore.call('snapshot',{unexpected:true}).catch(()=>window.__denied=true)");check("window.__denied===true","Unexpected parameters denied");
        js("window.__denied=false;window.NativeStore.call('sync',{key:'wrong'}).catch(()=>window.__denied=true)");check("window.__denied===true","Wrong workspace denied");
        check("!document.getElementById('pairKey') && !localStorage.getItem('easybook-key')", "Native pairing has no renderer secret field");
        js("window.__blocked=false;fetch('https://easybook-sync.1902521952.workers.dev/health').catch(()=>window.__blocked=true)");check("window.__blocked===true","Android UI cannot perform sync HTTP");
        runOnMainSync(()->web.loadDataWithBaseURL("https://untrusted.invalid/","<html><body>Untrusted origin</body></html>","text/html","UTF-8",null));Thread.sleep(500);
        check("typeof window.EasybookNative==='undefined'","Native bridge absent on foreign origin");
        runOnMainSync(()->activity.finish());Thread.sleep(300);launch();
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
    private void checkKeyboard() throws Exception {checkKeyboard("title");}
    private void checkKeyboard(String input) throws Exception {
        js("document.getElementById('"+input+"').focus()");Thread.sleep(250);
        double viewport=Double.parseDouble(js("window.innerWidth")),cssY=Double.parseDouble(js("document.getElementById('"+input+"').getBoundingClientRect().top+20"));
        int[] point=new int[2];runOnMainSync(()->{int[] origin=new int[2];web.getLocationOnScreen(origin);point[0]=origin[0]+web.getWidth()/2;point[1]=origin[1]+(int)(cssY*web.getWidth()/viewport);});
        long now=android.os.SystemClock.uptimeMillis();android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,point[0],point[1],0),up=android.view.MotionEvent.obtain(now,now+80,android.view.MotionEvent.ACTION_UP,point[0],point[1],0);down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);sendPointerSync(down);sendPointerSync(up);down.recycle();up.recycle();
        Thread.sleep(250);
        runOnMainSync(() -> {
            web.requestFocus();
            ((android.view.inputmethod.InputMethodManager)activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });
        boolean visible=false;
        for(int i=0;i<80;i++){
            AtomicReference<Boolean> shown=new AtomicReference<>(false);
            runOnMainSync(() -> shown.set(web.getRootWindowInsets().isVisible(android.view.WindowInsets.Type.ime())));
            if(shown.get()){visible=true;break;}Thread.sleep(100);
        }
        if(!visible)throw new AssertionError("Keyboard did not open for "+input+"; focused="+js("document.activeElement.id"));
        Thread.sleep(400);checkSafeArea();
        if(input.equals("folderName")){
            check("(()=>{const d=document.getElementById('newFolderDialog').getBoundingClientRect();return d.top>=0&&d.bottom<=innerHeight})()", "Folder sheet remains above Android keyboard");shot("new-folder-keyboard.png");
        } else {
        check("getComputedStyle(document.getElementById('title')).outlineStyle==='none'", "Focused title has no input frame");
        js("document.getElementById('body').focus()");
        check("getComputedStyle(document.getElementById('body')).outlineStyle==='none'", "Focused body has no input frame");
        shot("keyboard.png");
        }
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
            SecurityChecks.run(getTargetContext());AttachmentChecks.run(getTargetContext());
            DataLayerChecks.run(getTargetContext(),!offlineChecks);
            getUiAutomation().executeShellCommand("cmd connectivity airplane-mode enable").close();
            launch();seedLegacy();bridgeSecurity();checkSafeArea();check("document.getElementById('heading').textContent==='全部备忘录'","Home");shot("home.png");
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
            checkNative("s.notes.some(n=>n.title==='周末采购')","Native SQLite save");
            check("(()=>{const h=document.querySelector('.editor-header'),d=document.getElementById('done'),b=document.getElementById('back');return h.getBoundingClientRect().height<=66&&getComputedStyle(d).whiteSpace==='nowrap'&&getComputedStyle(b.querySelector('span')).whiteSpace==='nowrap'&&!h.contains(document.getElementById('editorStatus'))})()","Editor header single-line layout and separate sync status");
            js("document.getElementById('back').querySelector('span').textContent='很长很长的文件夹名称测试导航宽度';document.querySelector('.editor-header').style.width='320px'");
            check("(()=>{const h=document.querySelector('.editor-header').getBoundingClientRect(),a=document.getElementById('back').getBoundingClientRect(),b=document.getElementById('editorShare').getBoundingClientRect(),d=document.getElementById('done').getBoundingClientRect();return a.right<=b.left&&d.right<=h.right&&d.height===44&&document.documentElement.scrollWidth===innerWidth})()","320px header controls do not collide or overflow");
            shot("header-narrow.png");js("document.querySelector('.editor-header').style.width='';document.getElementById('back').querySelector('span').textContent='全部备忘录'");
            check("!document.getElementById('meta') && document.querySelector('#richEditor .tiptap')!==null", "Date removed and rich editor active");
            checkKeyboard();
            js("document.getElementById('previewButton').click()");
            check("document.querySelectorAll('#preview [role=checkbox]').length===2","Todo rendering");shot("editor.png");
            js("document.querySelector('#preview [role=checkbox]').click()");
            check("document.querySelector('#preview [role=checkbox]').getAttribute('aria-checked')==='true'","Todo toggle");
            js("document.getElementById('previewButton').click();window.easybookRich.editor.commands.selectAll();window.easybookRich.editor.commands.toggleBold()");
            check("document.getElementById('body').value.startsWith('<!--easybook-rich-v1-->') && document.getElementById('body').value.includes('<strong>')", "Rich formatting persists canonical content");
            shot("rich-editor.png");
            js("document.getElementById('moreButton').click();document.getElementById('favoriteButton').click();window.persistNow();window.goHome()");
            check("!document.body.classList.contains('editing')","Back navigation");
            flush();runOnMainSync(()->activity.finish());Thread.sleep(500);launch();
            check("document.getElementById('cards').innerText.includes('周末采购')","Activity restart persistence");shot("notes.png");
            js("document.getElementById('foldersButton').click();document.getElementById('createFolder').click()");
            check("document.getElementById('newFolderDialog').getBoundingClientRect().width<=422&&getComputedStyle(document.getElementById('folderName')).outlineStyle==='none'&&document.getElementById('createFolderSubmit').disabled","Folder sheet, no yellow focus frame, empty-name guard");shot("new-folder.png");checkKeyboard("folderName");
            check("(()=>{const d=document.getElementById('newFolderDialog').getBoundingClientRect(),a=document.querySelector('#newFolderDialog [data-close]').getBoundingClientRect(),b=document.getElementById('createFolderSubmit').getBoundingClientRect();return d.bottom<=innerHeight&&d.top>=0&&a.width>=44&&b.width>=44&&Math.abs(a.top-b.top)<1})()", "Folder sheet visible and top actions reachable");
            js("document.documentElement.dataset.theme='dark'");shot("new-folder-dark.png");
            js("document.documentElement.dataset.glass='reduced'");check("getComputedStyle(document.getElementById('newFolderDialog')).backdropFilter==='none'", "Reduced transparency respected");
            js("document.documentElement.dataset.glass='normal';document.documentElement.dataset.theme='light';document.querySelector('#newFolderDialog [data-close]').click()");check("!document.getElementById('newFolderDialog').open", "Cancel folder creation");
            js("document.getElementById('createFolder').click()");
            js("document.getElementById('folderName').value='工作';document.getElementById('folderName').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('newFolderForm').requestSubmit()");
            check("document.getElementById('customFolders').innerText.includes('工作')", "Create folder");
            js("document.getElementById('createFolder').click();document.getElementById('folderName').value='工作';document.getElementById('newFolderForm').requestSubmit()");
            check("document.getElementById('folderError').textContent.includes('同名')", "Duplicate folder validation");
            js("document.getElementById('newFolderDialog').close();document.querySelector('[data-tab=all]').click()");
            check("document.querySelector('#cards [data-id]')!==null", "Notes list rendered");
            js("document.querySelector('#cards [data-id]').click();document.getElementById('moreButton').click();document.getElementById('moveButton').click();[...document.querySelectorAll('#moveFolders [data-move-folder]')].find(b=>b.textContent.trim()==='工作').click();window.goHome();document.getElementById('foldersButton').click()");
            checkNative("s.notes.find(n=>n.title==='周末采购').folder_id.length===36", "Move note persists assignment");shot("folders.png");
            js("document.querySelector('[data-tab=all]').click();window.receiveSharedText('咖啡 收据');document.getElementById('title').value='ＡＢＣ 报销';document.getElementById('title').dispatchEvent(new Event('input',{bubbles:true}));window.persistNow();window.goHome();document.getElementById('foldersButton').click();[...document.querySelectorAll('#customFolders [data-folder-tab]')].find(b=>b.textContent.startsWith('工作')).click()");
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
            flush();runOnMainSync(()->activity.finish());Thread.sleep(500);launch();
            checkNative("s.folders.some(f=>f.name==='工作') && s.notes.find(n=>n.title==='周末采购').folder_id.length===36", "Folder and assignment survive Activity restart");
            js("document.getElementById('foldersButton').click();document.getElementById('folderSettings').click();document.querySelector('button[data-theme=dark]').click()");
            check("document.documentElement.dataset.theme==='dark'","Dark appearance");
            check("typeof EasybookDevice.copy==='function' && typeof EasybookDevice.share==='function' && typeof EasybookDevice.exportNotes==='function' && typeof EasybookDevice.importNotes==='function'","Native actions");
            shot("settings.png");result.putString("passed","true");result.putString("checks","Keystore AES256-GCM tamper/AAD/IV, plaintext credential migration/retry/rollback, invalidated-key offline and re-pair, no bridge secrets, backup exclusions, SQLite transactional migration, retry, collision, rollback archive, Worker protocol (live cross-device covered by 0.6.0; UI run may skip live), folder material sheet, narrow single-line header, bridge origin/allowlist/CSP, folder creation, duplicate validation, move, scoped/global/CJK/multiple-keyword search, persistence, native status/navigation/cutout bounds, launch, editor, local save, todo toggle, favorite, back, restart persistence, dark appearance, native actions");
            getUiAutomation().executeShellCommand("cmd connectivity airplane-mode disable").close();finish(Activity.RESULT_OK,result);
        }catch(Throwable e){try{getUiAutomation().executeShellCommand("cmd connectivity airplane-mode disable").close();}catch(Exception ignored){}result.putString("passed","false");result.putString("failure",e.toString());e.printStackTrace();try{result.putString("diagnostics","nativeLegacy="+NoteRepository.get(getTargetContext()).setting("legacyMode","false")+"; page="+js("JSON.stringify({legacy:!!window.EasybookRollbackMode,bridge:typeof window.NativeStore,rollbackFailed:!!window.__rollbackFailed,ready:typeof window.handleBack})"));}catch(Exception ignored){}finish(Activity.RESULT_CANCELED,result);}
    }
}
