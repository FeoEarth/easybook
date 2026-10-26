package com.feoearth.easybook;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.os.PersistableBundle;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.ExecutorService;

/** Permissions are per-document and per-operation. Secrets are exclusively rendered
 * by native dialogs and are never returned in a bridge response or callback. */
public final class SecurityManager {
    private final Activity activity;private final NoteRepository db;private final ExecutorService io;
    private volatile long initialized=-1;
    SecurityManager(Activity a,NoteRepository d,ExecutorService e){activity=a;db=d;io=e;}
    private static Set<String> fields(String... names){return new HashSet<>(Arrays.asList(names));}
    synchronized void authorize(String method,JSONObject args,long generation)throws Exception{
        Set<String> fields;
        switch(method){
            case "bootstrap":if(initialized==generation)throw new SecurityException("Already initialized");fields=fields("legacy");break;
            case "commit":fields=fields("key","changes");break;
            case "search":fields=fields("key","query","category","everywhere");break;
            case "sync.activity":fields=fields("key","action","policy","ids");break;
            case "sync":fields=fields("key","manual");break;
            case "attachment.restore":fields=fields("key","files");break;
            case "attachment.pick":fields=fields("key","noteId","kind");break;
            case "attachment.open":case "attachment.share":case "attachment.get":case "attachment.export":fields=fields("key","id");break;
            case "ui.glass.pdf":case "ui.glass.dock":fields=fields("slot","visible","left","top","width","height","viewportWidth","dark","opacity","corner","mounted","revision","content");break;
            case "ui.glass.sync":case "ui.glass.move":fields=fields("visible","left","top","width","height","viewportWidth","dark","opacity","corner","bottomCorner","mounted","revision","content","scrollTop");break;
            case "ui.glass.toolbar":case "ui.glass.format":fields=fields("visible","left","top","width","height","viewportWidth","dark","opacity","corner","mounted","revision","content","scrollLeft");break;
            case "ui.glass.palette":fields=fields("color");break;
            case "ui.glass.anchor":fields=fields("anchorLeft","anchorTop","anchorRight","anchorBottom","viewportWidth","viewportHeight");break;
            case "ui.glass.dismiss":case "ui.glass.invalidate":fields=Collections.emptySet();break;
            case "ui.glass.menu":fields=fields("right","bottom","viewportWidth","dark","layout","sort","kind","title","items","value","anchorLeft","anchorTop","anchorRight","anchorBottom","viewportHeight","placement");break;
            case "ui.performance":fields=fields("enabled");break;
            case "device.theme":fields=fields("value");break;
            case "device.copy":fields=fields("value");break;
            case "device.share":fields=fields("title","text");break;
            case "snapshot":case "security.pair":case "security.status":case "migration.status":case "migration.retry":case "migration.rollback":case "migration.cleaned":case "ui.ready":case "device.haptic":case "device.exportNotes":case "device.importNotes":fields=Collections.emptySet();break;
            default:throw new SecurityException("Operation denied");
        }
        Iterator<String> names=args.keys();while(names.hasNext())if(!fields.contains(names.next()))throw new SecurityException("Unexpected parameter");
        if(!method.equals("bootstrap")&&!method.equals("device.theme")&&!method.equals("device.haptic")&&!method.equals("migration.status")&&initialized!=generation)throw new SecurityException("Bootstrap required");
        if(args.has("key")&&(!(args.get("key") instanceof String)||!args.getString("key").equals(db.activeSpace())))throw new SecurityException("Workspace changed");
        if(method.equals("commit"))FolderPlacement.validateCommit(args.getJSONObject("changes"));
        if(method.equals("sync")&&args.has("manual")&&!(args.get("manual") instanceof Boolean))throw new SecurityException("Invalid retry flag");
    }
    synchronized void initialized(long generation){initialized=generation;}
    private ConnectionSheet connectionSheet;
    private boolean dark;
    void setDark(boolean value){dark=value;}
    boolean back(){return connectionSheet!=null&&connectionSheet.back();}
    void dismissConnection(){if(connectionSheet!=null)connectionSheet.close();}
    void pairing(Runnable changed){activity.runOnUiThread(()->{
        if(connectionSheet!=null)return;
        connectionSheet=new ConnectionSheet(activity,dark, k->io.execute(()->{
            try{boolean rotate=false;try{db.vault.seal("check","health");}catch(Exception e){rotate=true;}db.pair(k,rotate);activity.runOnUiThread(()->{if(activity.isDestroyed())return;dismissConnection();changed.run();});}
            catch(Exception e){activity.runOnUiThread(()->{if(connectionSheet!=null)connectionSheet.error("连接未完成，本机笔记已保留，请重试");});}
        }),this::showCredential,()->connectionSheet=null);
        connectionSheet.show();
    });}
    private void showCredential(){io.execute(()->{try{String k=db.credential(db.activeSpace());activity.runOnUiThread(()->{if(connectionSheet==null||activity.isDestroyed())return;connectionSheet.credential(k,()->{ClipData clip=ClipData.newPlainText("Easybook 同步密钥",k);if(Build.VERSION.SDK_INT>=24){PersistableBundle extras=new PersistableBundle();extras.putBoolean("android.content.extra.IS_SENSITIVE",true);clip.getDescription().setExtras(extras);}((ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(clip);});});}catch(Exception e){activity.runOnUiThread(()->{if(connectionSheet!=null)connectionSheet.error("本机凭据不可用。请输入原同步密钥重新配对；离线笔记仍可编辑和导出。");});}});}
    private void message(String value){activity.runOnUiThread(()->Toast.makeText(activity,value,Toast.LENGTH_LONG).show());}
}






