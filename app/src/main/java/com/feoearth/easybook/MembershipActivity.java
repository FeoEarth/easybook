package com.feoearth.easybook;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import java.util.Collections;

/** Isolated purchase browser: no native JS bridge and no external navigation. */
public final class MembershipActivity extends Activity {
 private WebView web;
 @Override public void onCreate(Bundle state){super.onCreate(state);
  try{NoteRepository db=NoteRepository.get(this,ServerProfiles.get(this).active());String origin=db.profile().origin;
   if(db.profile().httpKeyOnly)throw new SecurityException();String token=NativeAccount.token(db);
   web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
   web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){return !db.isActiveProfile()||!ServerAccountUrls.sameOrigin(origin,r.getUrl().toString())||!r.getUrl().getPath().equals("/membership");}});
   setContentView(web);web.loadUrl(origin+"/membership",Collections.singletonMap("Authorization","Easybook-Session "+token));
  }catch(Exception error){android.widget.TextView message=new android.widget.TextView(this);message.setText("请先登录账户，再打开会员页面。");setContentView(message);}
 }
 @Override public void onBackPressed(){if(web==null){super.onBackPressed();return;}web.evaluateJavascript("Boolean(window.dismissMembershipPayment && window.dismissMembershipPayment())",value->{if(!"true".equals(value))finish();});}
 @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
