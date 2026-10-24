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
            case "sync.activity":fields=fields("key");break;
            case "sync":fields=fields("key","manual");break;
            case "attachment.restore":fields=fields("key","files");break;
            case "attachment.pick":fields=fields("key","noteId");break;
            case "attachment.open":case "attachment.share":case "attachment.get":case "attachment.export":fields=fields("key","id");break;
            case "ui.glass.invalidate":fields=Collections.emptySet();break;
            case "ui.glass.menu":fields=fields("right","bottom","viewportWidth","dark","layout","sort");break;
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
    void pairing(Runnable changed){activity.runOnUiThread(()->{
        EditText input=new EditText(activity);input.setSingleLine(false);input.setMinLines(2);input.setHint("输入另一设备的 64 位同步密钥");input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        LinearLayout content=new LinearLayout(activity);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(24,12,24,0);TextView description=new TextView(activity);description.setText("同步密钥由 Android Keystore 加密保存。重新输入原密钥可修复失效凭据；输入其他密钥将连接其他空间，原笔记保留。电脑：easybook.loonxy.com");content.addView(description);content.addView(input);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("连接其他设备").setView(content).setNegativeButton("取消",null).setNeutralButton("查看本机密钥",null).setPositiveButton("连接空间",null).create();dialog.setOnDismissListener(v->input.setText(""));dialog.setOnShowListener(v->{dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(b->showCredential());dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(b->{String k=input.getText().toString().trim().toLowerCase(Locale.ROOT);if(!k.matches("[a-f0-9]{64}")){input.setError("请输入完整的 64 位同步密钥");return;}
            new AlertDialog.Builder(activity).setTitle("确认连接空间？").setMessage("已有本机笔记将保留。失效凭据会重新加密保存，不会自动清空或覆盖笔记。").setNegativeButton("取消",null).setPositiveButton("连接",(d,w)->{input.setText("");io.execute(()->{try{boolean rotate=false;try{db.vault.seal("check","health");}catch(Exception e){rotate=true;}db.pair(k,rotate);activity.runOnUiThread(()->{dialog.dismiss();changed.run();});}catch(Exception e){message("连接未完成，本机笔记已保留，请重试");}});}).show();});});dialog.show();
    });}
    private void showCredential(){io.execute(()->{try{String k=db.credential(db.activeSpace());activity.runOnUiThread(()->{TextView text=new TextView(activity);text.setText(k);text.setPadding(28,18,28,18);text.setTextIsSelectable(false);AlertDialog d=new AlertDialog.Builder(activity).setTitle("同步密钥（仅在原生窗口显示）").setView(text).setNegativeButton("关闭",(a,b)->text.setText("")).setPositiveButton("复制密钥",(a,b)->{ClipData clip=ClipData.newPlainText("Easybook 同步密钥",k);if(Build.VERSION.SDK_INT>=24){PersistableBundle extras=new PersistableBundle();extras.putBoolean("android.content.extra.IS_SENSITIVE",true);clip.getDescription().setExtras(extras);}((ClipboardManager)activity.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(clip);text.setText("");message("密钥已复制，请仅提供给自己的设备");}).create();d.setOnShowListener(v->d.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE));d.setOnDismissListener(v->text.setText(""));d.show();});}catch(Exception e){message("本机凭据不可用。请输入原同步密钥重新配对；离线笔记仍可编辑和导出。");}});}
    private void message(String value){activity.runOnUiThread(()->Toast.makeText(activity,value,Toast.LENGTH_LONG).show());}
}



