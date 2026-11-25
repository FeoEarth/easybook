package com.feoearth.easybook;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.drawable.Animatable2;
import android.graphics.drawable.AnimatedVectorDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.window.SplashScreenView;

final class LaunchAnimation {
    private static final long LOAD_TIMEOUT_MS = 2200;
    private static final long EXIT_DURATION_MS = 180;

    private final FrameLayout cover;
    private final AnimatedVectorDrawable mark;
    private final ViewTreeObserver.OnDrawListener firstDraw = this::onFirstDraw;
    private final Runnable startMotion = this::startMotion;
    private final Runnable loadTimeout = this::dismiss;
    private boolean startQueued;
    private boolean motionFinished;
    private boolean pageVisible;
    private boolean dismissing;

    LaunchAnimation(Activity activity) {
        cover = new FrameLayout(activity);
        cover.setBackgroundColor(activity.getColor(R.color.launch_surface));
        cover.setClickable(true);
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);

        ImageView icon = new ImageView(activity);
        icon.setImageResource(R.drawable.launch_motion);
        mark = (AnimatedVectorDrawable) icon.getDrawable();
        int canvas = activity.getResources().getDimensionPixelSize(R.dimen.launch_icon_canvas);
        cover.addView(icon, new FrameLayout.LayoutParams(canvas, canvas, Gravity.CENTER));

        if (Build.VERSION.SDK_INT >= 31) {
            // Our first frame matches the mark in the system starting window.
            activity.getSplashScreen().setOnExitAnimationListener(SplashScreenView::remove);
        }

        activity.addContentView(cover, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cover.getViewTreeObserver().addOnDrawListener(firstDraw);
        cover.postDelayed(loadTimeout, LOAD_TIMEOUT_MS);
    }

    private void onFirstDraw() {
        if (startQueued) return;
        startQueued = true;
        cover.post(startMotion);
    }

    private void startMotion() {
        cover.getViewTreeObserver().removeOnDrawListener(firstDraw);
        mark.registerAnimationCallback(new Animatable2.AnimationCallback() {
            @Override public void onAnimationEnd(Drawable drawable) {
                motionFinished = true;
                if (pageVisible) dismiss();
            }
        });
        mark.start();
    }

    void revealWhenDrawn(WebView web) {
        if (dismissing) return;
        web.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                pageVisible = true;
                if (motionFinished) dismiss();
            }
        });
    }

    private void dismiss() {
        if (dismissing) return;
        dismissing = true;
        cover.removeCallbacks(loadTimeout);
        if (!ValueAnimator.areAnimatorsEnabled()) {
            remove();
            return;
        }
        cover.animate()
                .alpha(0f)
                .setDuration(EXIT_DURATION_MS)
                .setInterpolator(new PathInterpolator(0.2f, 0f, 0f, 1f))
                .withEndAction(this::remove)
                .start();
    }

    void remove() {
        dismissing = true;
        cover.removeCallbacks(startMotion);
        cover.removeCallbacks(loadTimeout);
        cover.getViewTreeObserver().removeOnDrawListener(firstDraw);
        cover.animate().cancel();
        mark.clearAnimationCallbacks();
        if (mark.isRunning()) mark.stop();
        if (cover.getParent() instanceof ViewGroup parent) parent.removeView(cover);
    }
}
