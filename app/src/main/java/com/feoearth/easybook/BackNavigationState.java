package com.feoearth.easybook;

/** UI-thread protocol state. Unknown navigation fails closed, never exits the Activity. */
final class BackNavigationState {
    long revision=-1, serial, pending;
    boolean canGoBack=true;
    void reset(){revision=-1;canGoBack=true;pending=0;serial++;}
    boolean update(long next,boolean canBack){
        if(next<0||next<revision)return false;
        revision=next;canGoBack=canBack;return true;
    }
    boolean intercept(){return revision<0||canGoBack||pending!=0;}
    long begin(long expected){if(pending!=0||revision<0||expected!=revision||!canGoBack)return 0;return pending=++serial;}
    boolean finish(long token){if(token==0||pending!=token)return false;pending=0;return true;}
}
