package com.feoearth.easybook;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.ViewTreeObserver;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

/** Single Activity callback; platform IME/dialog windows retain their own higher priority. */
final class PredictiveBack {
    interface Host {
        int target(); // 0 system, 1 connection sheet, 2 glass, 3 WebView/loading
        long revision(int target);
        View view(int target);
        void commit(int target,long revision);
    }
    private final Activity activity;
    private final View root;
    private final Host host;
    private OnBackInvokedCallback callback;
    private boolean registered,active=true,gesture,invalid;
    private int target;
    private long revision;
    private View preview,frozenView;
    private float scaleX,scaleY,translationX,translationY,alpha;
    private ValueAnimator settling;
    private final ViewTreeObserver.OnPreDrawListener observer=()->{refresh();return true;};
    PredictiveBack(Activity activity,View root,Host host){
        this.activity=activity;this.root=root;this.host=host;
        if(Build.VERSION.SDK_INT>=33){
            callback=Build.VERSION.SDK_INT>=34?Api34.create(this):this::invoke;
            root.getViewTreeObserver().addOnPreDrawListener(observer);refresh();
        }
    }
    void refresh(){
        if(Build.VERSION.SDK_INT<33)return;
        if(gesture&&(host.target()!=target||host.revision(target)!=revision||host.view(target)!=frozenView)){invalid=true;restore(false);}
        boolean needed=active&&(gesture||host.target()!=0);
        if(needed==registered)return;
        if(needed)activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,callback);
        else activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(callback);
        registered=needed;
    }
    void start(){
        restore(false);gesture=true;invalid=false;target=host.target();revision=host.revision(target);
        preview=host.view(target);frozenView=preview;
        if(preview!=null){preview.animate().cancel();scaleX=preview.getScaleX();scaleY=preview.getScaleY();translationX=preview.getTranslationX();translationY=preview.getTranslationY();alpha=preview.getAlpha();}
    }
    void progress(float progress,int edge){
        refresh();if(invalid||preview==null||!ValueAnimator.areAnimatorsEnabled())return;
        float p=Math.max(0,Math.min(1,progress)),scale=1-(target==2?.08f:.035f)*p;
        preview.setScaleX(scaleX*scale);preview.setScaleY(scaleY*scale);
        // Small displacement, never an iOS-style horizontal page slide or a fake screenshot.
        preview.setTranslationX(translationX+(edge==0?1:-1)*12*root.getResources().getDisplayMetrics().density*p);
    }
    void cancel(){restore(true);gesture=false;invalid=false;refresh();}
    void invoke(){
        if(!active)return;
        if(!gesture){target=host.target();revision=host.revision(target);invalid=false;}
        boolean valid=!invalid&&target!=0&&target==host.target()&&revision==host.revision(target)&&(!gesture||frozenView==host.view(target));
        restore(false);gesture=false;
        if(valid)host.commit(target,revision);
        // Never redispatch or call finish here. A stale/failed JS result cannot exit.
        refresh();
    }
    private void restore(boolean animate){
        if(settling!=null){settling.end();settling=null;}
        View v=preview;preview=null;if(v==null)return;
        final float sx=scaleX,sy=scaleY,tx=translationX,ty=translationY,a=alpha;
        if(animate&&ValueAnimator.areAnimatorsEnabled()){
            float fromX=v.getScaleX(),fromY=v.getScaleY(),fromT=v.getTranslationX();
            settling=ValueAnimator.ofFloat(0,1);settling.setDuration(160);
            settling.addUpdateListener(value->{float f=(float)value.getAnimatedValue();v.setScaleX(fromX+(sx-fromX)*f);v.setScaleY(fromY+(sy-fromY)*f);v.setTranslationX(fromT+(tx-fromT)*f);v.setTranslationY(ty);v.setAlpha(a);});settling.start();
        }else{v.setScaleX(sx);v.setScaleY(sy);v.setTranslationX(tx);v.setTranslationY(ty);v.setAlpha(a);}
    }
    void pause(){active=false;cancel();}
    void resume(){active=true;refresh();}
    void destroy(){pause();restore(false);if(root.getViewTreeObserver().isAlive())root.getViewTreeObserver().removeOnPreDrawListener(observer);}
    private static final class Api34 {
        static OnBackInvokedCallback create(PredictiveBack owner){return new android.window.OnBackAnimationCallback(){
            @Override public void onBackStarted(android.window.BackEvent event){owner.start();}
            @Override public void onBackProgressed(android.window.BackEvent event){owner.progress(event.getProgress(),event.getSwipeEdge());}
            @Override public void onBackCancelled(){owner.cancel();}
            @Override public void onBackInvoked(){owner.invoke();}
        };}
    }
}
