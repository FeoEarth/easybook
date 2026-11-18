package com.feoearth.easybook;

import android.content.Context;
import android.content.res.Configuration;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

final class AppAppearance {
    private AppAppearance() {}

    static String mode(Context context) {
        // Keep the preference file used by MainActivity.getPreferences().
        String className = MainActivity.class.getName();
        String packagePrefix = context.getPackageName() + ".";
        String preferenceFile = className.startsWith(packagePrefix) ? className.substring(packagePrefix.length()) : className;
        String value = context.getSharedPreferences(preferenceFile, Context.MODE_PRIVATE).getString("themeMode", "auto");
        return "light".equals(value) || "dark".equals(value) ? value : "auto";
    }

    static boolean systemDark(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    static boolean dark(String mode, boolean systemDark) {
        return "dark".equals(mode) || ("auto".equals(mode) && systemDark);
    }

    static int windowColor(boolean dark) {
        return dark ? 0xff000000 : 0xfff2f2f7;
    }

    static void applyWindow(Window window, boolean dark, int color) {
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        View decor = window.getDecorView();
        int lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        int flags = decor.getSystemUiVisibility();
        decor.setSystemUiVisibility(dark ? flags & ~lightBars : flags | lightBars);
    }

    static void usePageColors(WebView web) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.getSettings(), false);
        }
    }
}
