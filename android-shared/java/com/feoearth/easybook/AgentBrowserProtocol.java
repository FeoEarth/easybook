package com.feoearth.easybook;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.util.Arrays;
import java.util.HashSet;

final class AgentBrowserProtocol {
    static final String MAIN_PACKAGE = "com.feoearth.easybook.notes";
    static final String PACKAGE = "com.feoearth.easybook.browser";
    static final String ACTIVITY = "com.feoearth.easybook.AgentBrowserActivity";
    static final int MIN_VERSION = 1;
    static final int ATTACHED = 1, RESPONSE = 2, STOPPED = 3;
    static final int SIGNATURE_FLAGS = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;

    private AgentBrowserProtocol() { }

    static boolean matches(PackageInfo main, PackageInfo browser) {
        if (main == null || browser == null || !MAIN_PACKAGE.equals(main.packageName) || !PACKAGE.equals(browser.packageName)) return false;
        long version = Build.VERSION.SDK_INT >= 28 ? browser.getLongVersionCode() : browser.versionCode;
        Signature[] left = signers(main), right = signers(browser);
        return version >= MIN_VERSION && left != null && right != null && left.length > 0 && left.length == right.length &&
            new HashSet<>(Arrays.asList(left)).equals(new HashSet<>(Arrays.asList(right)));
    }

    private static Signature[] signers(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28) return info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        return info.signatures;
    }
}
