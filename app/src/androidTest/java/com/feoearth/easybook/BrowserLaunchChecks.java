package com.feoearth.easybook;

import android.os.Bundle;
import android.os.Parcel;
import android.os.ResultReceiver;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class BrowserLaunchChecks {
    static void run() throws Exception {
        CountDownLatch received = new CountDownLatch(1);
        ResultReceiver callback = new ResultReceiver(null) {
            @Override protected void onReceiveResult(int code, Bundle data) {
                if (code == 1 && data.getBoolean("attached")) received.countDown();
            }
        };
        Bundle extras = new Bundle();
        extras.putParcelable("receiver", AgentBrowserClient.transportReceiver(callback));
        Parcel wire = Parcel.obtain();
        try {
            wire.writeBundle(extras);
            wire.setDataPosition(0);
            // The companion APK cannot see any classes defined by the main APK.
            ResultReceiver remote = wire.readBundle(new ClassLoader(null) {}).getParcelable("receiver");
            DataLayerChecks.require(remote.getClass() == ResultReceiver.class, "browser callback uses a framework parcelable");
            Bundle response = new Bundle();
            response.putBoolean("attached", true);
            remote.send(1, response);
            DataLayerChecks.require(received.await(2, TimeUnit.SECONDS), "browser callback delivers IPC replies");
        } finally {
            wire.recycle();
        }
    }
}
