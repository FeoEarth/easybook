package com.feoearth.easybook;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Optional *QEMU guest* transport through Termux RUN_COMMAND. No model-generated
 * shell/script ever executes in the Termux host. The fixed companion launcher
 * forwards stdin into the guest via pinned SSH, with no shared host filesystem.
 *
 * Requires Termux >=0.109, user's explicit RUN_COMMAND permission grant and
 * setup of docs/android-agent-vm.md; no root or downloaded binaries in Easybook.
 */
final class AgentVmBridge {
    static final String ACTION_RESULT="com.feoearth.easybook.AGENT_VM_RESULT";
    private static final String PREFS="easybook-vm-agent-v1";
    private static final String PERMISSION="com.termux.permission.RUN_COMMAND";
    private static final AtomicInteger IDS=new AtomicInteger(1000);
    private static final SecureRandom RANDOM=new SecureRandom();
    private static final ConcurrentHashMap<Integer, PendingJob> PENDING=new ConcurrentHashMap<>();
    private static final int LIMIT=10000, RESPONSE_MAX=16000;
    private static final class PendingJob {
        final String nonce;
        final ArrayBlockingQueue<Bundle> result=new ArrayBlockingQueue<>(1);
        PendingJob(String nonce){this.nonce=nonce;}
    }
    private AgentVmBridge(){}
    private static boolean installed(Context context) {
        try {context.getPackageManager().getPackageInfo("com.termux",0);return true;}
        catch(Exception ignored){return false;}
    }
    private static boolean permitted(Context context) {
        return installed(context)&&context.checkSelfPermission(PERMISSION)==PackageManager.PERMISSION_GRANTED;
    }
    private static boolean enabled(Context context){
        return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getBoolean("enabled",false);
    }
    /**
     * The UI only sends fixed lifecycle verbs. No AI-generated command can reach
     * a Termux shell; the installer and manager scripts are packaged in the APK.
     */
    private static String asset(Context context,String name)throws Exception {
        try(java.io.InputStream in=context.getAssets().open("agent-vm/"+name+".sh")) {
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
            byte[] bytes=new byte[8192];int size;
            while((size=in.read(bytes))!=-1) {
                if(out.size()+size>300000)throw new SecurityException("VM setup asset is too large");
                out.write(bytes,0,size);
            }
            return out.toString("UTF-8");
        }
    }
    private static String installer(Context context)throws Exception {
        StringBuilder script=new StringBuilder("set -euo pipefail\\numask 077\\DIR=\\\"$HOME/easybook-agent-vm\\\"\\mkdir -p \\\"$DIR\\\"\\");
        // Transfer only trusted APK-bundled scripts; no mutable GitHub-main curl|bash.
        for(String name:new String[]{"runner","start-qemu","setup"}) {
            String data=android.util.Base64.encodeToString(asset(context,name).getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP);
            script.append("base64 -d > \\\"$DIR/").append(name).append(".sh\\\" <<'EASYBOOK_BUNDLED_SCRIPT'\\")
                .append(data).append("\\EASYBOOK_BUNDLED_SCRIPT\\");
        }
        script.append("chmod 700 \\\"$DIR/runner.sh\\\" \\\"$DIR/start-qemu.sh\\\" \\\"$DIR/setup.sh\\\"\\");
        script.append("exec \\\"$DIR/setup.sh\\\"\\");
        return script.toString().replace('\\\\','\\n');
    }
    private static JSONObject termuxControl(Context context,String script,String action,boolean wait)throws Exception {
        if(!permitted(context))throw new SecurityException("请安装 Termux 0.109+，开启 allow-external-apps，并授予 Easybook RUN_COMMAND 权限");
        if(!PENDING.isEmpty())throw new IllegalStateException("另一项虚拟机操作仍在执行");
        final int id=IDS.incrementAndGet();
        byte[] nonceBytes=new byte[16];RANDOM.nextBytes(nonceBytes);
        StringBuilder nonce=new StringBuilder();
        for(byte b:nonceBytes)nonce.append(String.format(java.util.Locale.ROOT,"%02x",b&0xff));
        PendingJob job=new PendingJob(nonce.toString());
        if(wait)PENDING.put(id,job);
        try {
            Intent command=new Intent("com.termux.RUN_COMMAND");
            command.setClassName("com.termux","com.termux.app.RunCommandService");
            command.putExtra("com.termux.RUN_COMMAND_PATH","/data/data/com.termux/files/usr/bin/bash");
            command.putExtra("com.termux.RUN_COMMAND_ARGUMENTS",new String[]{"-s","--",action});
            command.putExtra("com.termux.RUN_COMMAND_STDIN",script);
            command.putExtra("com.termux.RUN_COMMAND_WORKDIR","/data/data/com.termux/files/home");
            command.putExtra("com.termux.RUN_COMMAND_BACKGROUND",true);
            command.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL","Easybook Linux Setup");
            if(wait) {
                Intent receipt=new Intent(context,AgentVmResultReceiver.class);
                receipt.setAction(ACTION_RESULT);
                receipt.putExtra("easybook_vm_job",id);
                receipt.putExtra("easybook_vm_nonce",job.nonce);
                int flags=PendingIntent.FLAG_ONE_SHOT|PendingIntent.FLAG_UPDATE_CURRENT;
                if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
                command.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT",
                    PendingIntent.getBroadcast(context,id,receipt,flags));
            }
            if(context.startService(command)==null)throw new IllegalStateException("Termux 未启动；请打开 Termux 并检查授权");
            if(!wait)return new JSONObject().put("started",true);
            Bundle result=job.result.poll(14,TimeUnit.SECONDS);
            if(result==null)throw new IllegalStateException("Termux 未返回状态；请检查应用运行权限");
            int err=result.getInt("err",-1),exit=result.getInt("exitCode",-1);
            if(err!=-1||exit!=0)throw new IllegalStateException(
                "Termux: "+result.getString("errmsg",result.getString("stderr","命令失败")).substring(0,
                  Math.min(400,result.getString("errmsg",result.getString("stderr","命令失败")).length())));
            return new JSONObject().put("stdout",result.getString("stdout","").trim());
        } finally {if(wait)PENDING.remove(id);}
    }
    static JSONObject status(Context context)throws Exception {
        boolean hasTermux=installed(context),permission=permitted(context),active=enabled(context);
        JSONObject info=new JSONObject()
            .put("enabled",active).put("termuxInstalled",hasTermux)
            .put("permissionGranted",permission).put("ready",false)
            .put("backend","qemu-guest-via-termux").put("guestBootVerified",false)
            .put("phase","not-installed").put("installed",false).put("running",false)
            .put("supportedLanguages",new org.json.JSONArray().put("shell").put("python"))
            .put("requiresSetup",true).put("timeoutSeconds",45);
        if(permission) {
            try {
                JSONObject current=new JSONObject(termuxControl(context,asset(context,"manage"),"status",true).getString("stdout"));
                for(String key:new String[]{"phase","installed","running","guestReady"})if(current.has(key))info.put(key,current.get(key));
                boolean guestReady=current.optBoolean("guestReady");
                info.put("guestBootVerified",guestReady);
                info.put("ready",active&&AgentSandboxNetwork.enabled(context)&&guestReady);
            }catch(Exception e){info.put("connectionError",String.valueOf(e.getMessage()).substring(0,
                Math.min(300,String.valueOf(e.getMessage()).length())));}
        }
        return info;
    }
    static JSONObject manage(Context context,String action)throws Exception {
        if(!AgentSandboxNetwork.enabled(context)||!enabled(context))throw new SecurityException("请先开启本地执行环境和 QEMU 虚拟机");
        switch(action) {
            case "install":
                // Long downloads run in Termux, not inside a 45-second Android bridge call.
                termuxControl(context,installer(context),"install",false);
                return new JSONObject().put("started",true).put("phase","packages");
            case "start":case "stop":case "remove":
                termuxControl(context,asset(context,"manage"),action,true);
                return status(context);
            default:throw new SecurityException("Unsupported VM lifecycle operation");
        }
    }
    static JSONObject configure(Context context,JSONObject args)throws Exception {
        if(!(args.opt("enabled") instanceof Boolean))throw new SecurityException("Invalid virtual machine preference");
        if(args.getBoolean("enabled")&&!AgentSandboxNetwork.enabled(context))throw new SecurityException("请先启用 Agent 本地沙箱");
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putBoolean("enabled",args.getBoolean("enabled")).apply();
        return status(context);
    }
    static void onResult(int id,String nonce,Bundle result){
        final PendingJob job=PENDING.get(id);
        if(job!=null&&nonce!=null&&nonce.equals(job.nonce))job.result.offer(result==null?new Bundle():result);
    }
    static JSONObject run(Context context,JSONObject input,String workspace)throws Exception {
        if(!enabled(context)||!AgentSandboxNetwork.enabled(context))throw new SecurityException("虚拟机未授权");
        if(!permitted(context))throw new SecurityException("请在 Android 设置授权 Easybook 调用 Termux，且安装 Termux 0.109 或更新版本");
        final String language=input.optString("language","");
        if(!"shell".equals(language)&&!"python".equals(language))throw new SecurityException("QEMU 客体仅支持 Shell 和 Python");
        final String code=input.optString("code","");
        if(code.isEmpty()||code.length()>LIMIT||code.getBytes(StandardCharsets.UTF_8).length>LIMIT)
            throw new SecurityException("虚拟机脚本过大");
        String session=input.optString("sessionId","");
        if(!session.matches("[a-f0-9-]{36}")||workspace==null||workspace.isEmpty())throw new SecurityException("会话标识无效");
        byte[] digest=MessageDigest.getInstance("SHA-256").digest((workspace+"|"+session).getBytes(StandardCharsets.UTF_8));
        StringBuilder scopeHex=new StringBuilder();
        for(byte b:digest)scopeHex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        if(!PENDING.isEmpty())throw new IllegalStateException("另一个虚拟机执行任务尚未完成");
        int id=IDS.incrementAndGet();
        byte[] nonceBytes=new byte[16];RANDOM.nextBytes(nonceBytes);
        StringBuilder hex=new StringBuilder();for(byte b:nonceBytes)hex.append(String.format("%02x",b&0xff));
        PendingJob job=new PendingJob(hex.toString());
        PENDING.put(id,job);
        try {
            Intent receipt=new Intent(context,AgentVmResultReceiver.class);
            receipt.setAction(ACTION_RESULT);
            receipt.putExtra("easybook_vm_job",id);
            receipt.putExtra("easybook_vm_nonce",job.nonce);
            int flags=PendingIntent.FLAG_ONE_SHOT|PendingIntent.FLAG_UPDATE_CURRENT;
            if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
            PendingIntent callback=PendingIntent.getBroadcast(context,id,receipt,flags);
            Intent command=new Intent("com.termux.RUN_COMMAND");
            command.setClassName("com.termux","com.termux.app.RunCommandService");
            command.putExtra("com.termux.RUN_COMMAND_PATH","~/easybook-agent-vm/runner.sh");
            command.putExtra("com.termux.RUN_COMMAND_ARGUMENTS",new String[]{language,scopeHex.toString()});
            command.putExtra("com.termux.RUN_COMMAND_STDIN",code);
            command.putExtra("com.termux.RUN_COMMAND_WORKDIR","~/easybook-agent-vm");
            command.putExtra("com.termux.RUN_COMMAND_BACKGROUND",true);
            command.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL","Easybook QEMU Guest Agent");
            command.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT",callback);
            if(context.startService(command)==null)throw new IllegalStateException("无法启动 Termux 命令服务");
            Bundle result=job.result.poll(45,TimeUnit.SECONDS);
            if(result==null)throw new IllegalStateException("虚拟机命令超时；可在 Termux 检查 QEMU 和 SSH");
            int error=result.getInt("err",-1),exit=result.getInt("exitCode",-1);
            String stdout=result.getString("stdout",""),stderr=result.getString("stderr",""),details=result.getString("errmsg","");
            if(stdout.length()>RESPONSE_MAX)stdout=stdout.substring(stdout.length()-RESPONSE_MAX);
            if(stderr.length()>RESPONSE_MAX)stderr=stderr.substring(stderr.length()-RESPONSE_MAX);
            boolean ok=error==-1&&exit==0;
            return new JSONObject().put("ok",ok).put("result",new JSONObject()
                .put("stdout",stdout).put("stderr",stderr).put("exitCode",exit).put("backend","qemu-guest"))
                .put("error",ok?JSONObject.NULL:new JSONObject().put("message",
                    error!=-1?"Termux："+details:"客体命令退出码 "+exit));
        }finally {PENDING.remove(id);}
    }
}
