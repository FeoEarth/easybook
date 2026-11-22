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
    static JSONObject status(Context context)throws Exception {
        boolean installed=installed(context),permission=permitted(context),enabled=enabled(context);
        return new JSONObject()
            .put("enabled",enabled).put("termuxInstalled",installed)
            .put("permissionGranted",permission).put("ready",enabled&&permission&&AgentSandboxNetwork.enabled(context))
            .put("backend","qemu-guest-via-termux").put("guestBootVerified",false)
            .put("supportedLanguages",new org.json.JSONArray().put("shell").put("python"))
            .put("requiresSetup",true).put("timeoutSeconds",45);
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
    static JSONObject run(Context context,JSONObject input)throws Exception {
        if(!enabled(context)||!AgentSandboxNetwork.enabled(context))throw new SecurityException("虚拟机未授权");
        if(!permitted(context))throw new SecurityException("请在 Android 设置授权 Easybook 调用 Termux，且安装 Termux 0.109 或更新版本");
        final String language=input.optString("language","");
        if(!"shell".equals(language)&&!"python".equals(language))throw new SecurityException("QEMU 客体仅支持 Shell 和 Python");
        final String code=input.optString("code","");
        if(code.isEmpty()||code.length()>LIMIT||code.getBytes(StandardCharsets.UTF_8).length>LIMIT)
            throw new SecurityException("虚拟机脚本过大");
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
            command.putExtra("com.termux.RUN_COMMAND_ARGUMENTS",new String[]{language});
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
