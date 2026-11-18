package com.feoearth.easybook;

import android.app.Activity;
import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.*;
import java.util.Collections;

/** Isolated purchase browser: no native JS bridge and no external navigation. */
public final class MembershipActivity extends Activity {
 private WebView web;
 private boolean dark;

 private void applyAppearance(Configuration configuration){
  dark=AppAppearance.dark(AppAppearance.mode(this),AppAppearance.systemDark(configuration));
  int color=dark?0xff000000:0xfff5f5f7;
  AppAppearance.applyWindow(getWindow(),dark,color);
  getWindow().getDecorView().setBackgroundColor(color);
  if(web==null)return;
  web.setBackgroundColor(color);
  web.evaluateJavascript("document.documentElement.dataset.theme='"+(dark?"dark":"light")+"'",null);
 }
 @Override public void onConfigurationChanged(Configuration configuration){
  super.onConfigurationChanged(configuration);
  applyAppearance(configuration);
 }
 @Override protected void onResume(){super.onResume();applyAppearance(getResources().getConfiguration());}

 @Override public void onCreate(Bundle state){super.onCreate(state);
  applyAppearance(getResources().getConfiguration());
  try{NoteRepository db=NoteRepository.get(this,ServerProfiles.get(this).active());String origin=db.profile().origin;
   if(db.profile().httpKeyOnly)throw new SecurityException();String token=NativeAccount.token(db);
   web=new WebView(this);AppAppearance.usePageColors(web);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
   web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !db.isActiveProfile()||!ServerAccountUrls.sameOrigin(origin,r.getUrl().toString())||!"/membership".equals(r.getUrl().getPath());}
    @Override public void onPageFinished(WebView view,String url){
     if(db.isActiveProfile()&&ServerAccountUrls.sameOrigin(origin,url)&&"/membership".equals(android.net.Uri.parse(url).getPath()))applyAppearance(getResources().getConfiguration());
    }
   });
   setContentView(web);applyAppearance(getResources().getConfiguration());web.loadUrl(origin+"/membership?theme="+(dark?"dark":"light"),Collections.singletonMap("Authorization","Easybook-Session "+token));
  }catch(Exception error){android.widget.TextView message=new android.widget.TextView(this);message.setText("请先登录账户，再打开会员页面。");message.setTextColor(dark?0xfff5f5f7:0xff1d1d1f);setContentView(message);}
 }
 @Override public void onBackPressed(){if(web==null){super.onBackPressed();return;}web.evaluateJavascript("Boolean(window.dismissMembershipPayment && window.dismissMembershipPayment())",value->{if(!"true".equals(value))finish();});}
 @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
