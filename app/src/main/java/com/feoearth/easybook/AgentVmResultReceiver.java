package com.feoearth.easybook;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** Internal, non-exported PendingIntent callback from Termux >=0.109. */
public final class AgentVmResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !AgentVmBridge.ACTION_RESULT.equals(intent.getAction())) return;
        final int id=intent.getIntExtra("easybook_vm_job",-1);
        final String nonce=intent.getStringExtra("easybook_vm_nonce");
        final Bundle result=intent.getBundleExtra("result");
        AgentVmBridge.onResult(id,nonce,result);
    }
}
