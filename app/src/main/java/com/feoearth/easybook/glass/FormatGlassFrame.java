package com.feoearth.easybook.glass;

import android.app.Activity;
import android.graphics.Color;
import android.os.PowerManager;
import android.view.View;
import android.webkit.*;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;

/** One full GPU material, with a transparent projection of the unchanged DOM UI. */
final class FormatGlassFrame {
    private final Activity activity;
    private final FrameLayout root;
    private final WebView web;
    private final GlassBackdrop backdrop;
    private final Runnable changed;
    private final BooleanSupplier valid;
    private final boolean toolbar,move,dock,sync,pdf;private final String dockPrefix;
    private String prefix(){return pdf?dockPrefix:sync?"Sync":dock?dockPrefix:move?"Move":toolbar?"Toolbar":"Format";}
    private GlassSurface glass;
    private WebView controls;
    private FrameLayout moveShield;
    private JSONObject state,content;
    private boolean dark,broken,attached,loaded,pdfWantsFocus;
    private final int[] webAt=new int[2],rootAt=new int[2];

    FormatGlassFrame(Activity activity,FrameLayout root,WebView web,GlassBackdrop backdrop,Runnable changed,BooleanSupplier valid){
        this(activity,root,web,backdrop,changed,valid,false);
    }
    FormatGlassFrame(Activity activity,FrameLayout root,WebView web,GlassBackdrop backdrop,Runnable changed,BooleanSupplier valid,boolean toolbar){
        this(activity,root,web,backdrop,changed,valid,toolbar?"toolbar":"format");
    }
    FormatGlassFrame(Activity activity,FrameLayout root,WebView web,GlassBackdrop backdrop,Runnable changed,BooleanSupplier valid,String kind){
        this.activity=activity;this.root=root;this.web=web;this.backdrop=backdrop;this.changed=changed;this.valid=valid;this.toolbar="toolbar".equals(kind);this.move="move".equals(kind);this.sync="sync".equals(kind);this.dock=kind.startsWith("Dock");this.pdf=kind.startsWith("Pdf");this.dockPrefix=dock||pdf?kind:"";
    }
    GlassSurface surface(){return attached?glass:null;}
    void clear(){
        pdfWantsFocus=false;if(attached){if(pdf&&controls!=null&&controls.hasFocus()){((android.view.inputmethod.InputMethodManager)activity.getSystemService(Activity.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(controls.getWindowToken(),0);web.requestFocus();}attached=false;root.removeView(glass);if(moveShield!=null){root.removeView(moveShield);moveShield=null;}changed.run();}
    }
    void dispose(){
        clear();if(controls!=null){androidx.webkit.WebViewCompat.removeWebMessageListener(controls,"FormatActions");controls.destroy();controls=null;}
        glass=null;content=null;state=null;loaded=false;
    }
    private void fail(){broken=true;dispose();if(valid.getAsBoolean())web.evaluateJavascript("window.easybook"+prefix()+"SurfaceFallback&&window.easybook"+prefix()+"SurfaceFallback()",null);}
    void boundsChanged(){
        if(state==null||!attached)return;
        root.post(()->{if(!valid.getAsBoolean()||!attached)return;applyGeometry();web.evaluateJavascript("window.easybookSync"+prefix()+"Surface&&window.easybookSync"+prefix()+"Surface()",null);});
    }
    void update(JSONObject args){
        if(!args.optBoolean("visible")){clear();state=null;return;}
        if(broken||!root.isHardwareAccelerated()||((PowerManager)activity.getSystemService(Activity.POWER_SERVICE)).isPowerSaveMode()){clear();if(valid.getAsBoolean())web.evaluateJavascript("window.easybook"+prefix()+"SurfaceFallback&&window.easybook"+prefix()+"SurfaceFallback()",null);return;}
        boolean newDark=args.optBoolean("dark");
        if(glass!=null&&dark!=newDark)dispose();
        state=args;if(args.has("content"))content=args.optJSONObject("content");
        if(content==null){fail();return;}
        if(glass==null){
            try{
                glass=new GlassSurface(activity,backdrop,newDark,this::fail);if(move||sync)glass.useMoveSurface();else if(toolbar||dock||pdf)glass.useToolbarSurface();else glass.useFormatSurface();glass.setTag(sync?"sync-glass-surface":move?"move-glass-surface":toolbar?"toolbar-glass-surface":"format-glass-surface");dark=newDark;
                controls=new WebView(activity);controls.setBackgroundColor(Color.TRANSPARENT);boolean pdfInput=pdf&&("Pdf6".equals(dockPrefix)||"Pdf7".equals(dockPrefix));controls.setFocusable(pdfInput);controls.setFocusableInTouchMode(pdfInput);controls.setOverScrollMode(View.OVER_SCROLL_NEVER);
                controls.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
                WebSettings settings=controls.getSettings();settings.setJavaScriptEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setBlockNetworkLoads(true);settings.setBlockNetworkImage(true);settings.setSupportZoom(false);
                androidx.webkit.WebViewCompat.addWebMessageListener(controls,"FormatActions",java.util.Collections.singleton("https://format.easybook.invalid"),(view,message,origin,isMainFrame,reply)->{
                    if(view!=controls||!isMainFrame||!"https".equals(origin.getScheme())||!"format.easybook.invalid".equals(origin.getHost())||message.getData()==null||message.getData().length()>(pdf?2048:128))return;
                    try{JSONObject event=new JSONObject(message.getData());Actions actions=new Actions();if("ready".equals(event.optString("type")))actions.ready(event.getInt("revision"));else if("click".equals(event.optString("type")))actions.click(event.getString("token"));else if(pdf&&"edit".equals(event.optString("type")))actions.pdfInput(event.getString("token"),event.getString("value"),event.optBoolean("submit"));else if(pdf&&"focus".equals(event.optString("type")))actions.pdfFocus();else if(toolbar&&"gesture".equals(event.optString("type")))actions.gesture(event.optBoolean("active"));else if(toolbar&&"scroll".equals(event.optString("type")))actions.scroll(event.getDouble("left"));else if((move||sync)&&"scroll".equals(event.optString("type")))actions.moveScroll(event.getDouble("top"));else if(dock&&"focus".equals(event.optString("type")))actions.focusSearch();else if(move&&"drag".equals(event.optString("type")))actions.drag(event.getString("phase"),event.getDouble("y"),event.getInt("pointer"));}catch(Exception ignored){}
                });
                controls.setWebViewClient(new WebViewClient(){
                    @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
                    @Override public void onPageFinished(WebView view,String url){if(view!=controls)return;loaded=true;if(attached&&valid.getAsBoolean())render(true);}
                    @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){fail();return true;}
                });
                glass.addView(controls,new FrameLayout.LayoutParams(1,1));
                String html;try(InputStream in=activity.getAssets().open(pdf?"native-glass/pdf-content.html":sync?"native-glass/sync-content.html":dock?"native-glass/dock-content.html":move?"native-glass/move-content.html":toolbar?"native-glass/toolbar-content.html":"native-glass/format-content.html");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1)bytes.write(buffer,0,count);html=bytes.toString(StandardCharsets.UTF_8.name());}
                controls.loadDataWithBaseURL("https://format.easybook.invalid/",html,"text/html","UTF-8",null);
            }catch(Exception|LinkageError error){fail();return;}
        }
        if(!attached){attached=true;glass.setVisibility(View.INVISIBLE);if(move||sync){moveShield=new FrameLayout(activity);moveShield.setClickable(true);moveShield.setOnClickListener(v->{if(valid.getAsBoolean())web.evaluateJavascript(sync?"window.easybookSyncSurfaceClose&&window.easybookSyncSurfaceClose()":"document.getElementById('moveCancel').click()",null);});root.addView(moveShield,new FrameLayout.LayoutParams(-1,-1));}root.addView(glass,new FrameLayout.LayoutParams(1,1));}
        applyGeometry();if(loaded)render(args.has("content"));changed.run();
    }
    private void applyGeometry(){
        if(!attached||state==null)return;
        float scale=web.getWidth()/(float)Math.max(1,state.optDouble("viewportWidth",1));
        int left=Math.round((float)state.optDouble("left")*scale),top=Math.round((float)state.optDouble("top")*scale);
        int width=Math.max(1,Math.round((float)state.optDouble("width")*scale)),height=Math.max(1,Math.round((float)state.optDouble("height")*scale));
        web.getLocationInWindow(webAt);root.getLocationInWindow(rootAt);
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,height);lp.leftMargin=left+webAt[0]-rootAt[0]-((toolbar||move||dock||sync||pdf)?root.getPaddingLeft():0);lp.topMargin=top+webAt[1]-rootAt[1]-((toolbar||move||dock||sync||pdf)?root.getPaddingTop():0);glass.setLayoutParams(lp);
        if(move||sync)glass.setMoveCorners((float)state.optDouble("corner")*scale,(float)state.optDouble("bottomCorner")*scale);else glass.setFormatCorner((float)state.optDouble("corner")*scale);glass.setAlpha((float)state.optDouble("opacity",1));
        // Full-size CSS viewport keeps original media queries/font metrics. The
        // panel is simply clipped out at its measured origin, never re-laid out.
        FrameLayout.LayoutParams foreground=new FrameLayout.LayoutParams(web.getWidth(),web.getHeight());foreground.leftMargin=-left;foreground.topMargin=-top;controls.setLayoutParams(foreground);
        glass.setVisibility(state.optBoolean("mounted")?View.VISIBLE:View.INVISIBLE);if(pdfWantsFocus&&state.optBoolean("mounted"))focusPdfInput();glass.invalidate();
    }
    private void render(boolean withContent){
        if(state==null||!attached||controls==null)return;
        try{
            JSONObject geometry=new JSONObject().put("left",state.optDouble("left")).put("top",state.optDouble("top")).put("width",state.optDouble("width")).put("height",state.optDouble("height")).put("revision",state.optInt("revision")).put("scrollLeft",state.optDouble("scrollLeft",0)).put("scrollTop",state.optDouble("scrollTop",0));
            if(dock)geometry.put("dockSlot",state.optInt("slot"));
            controls.evaluateJavascript("window.renderFormat&&window.renderFormat("+(withContent?content.toString():"null")+","+geometry.toString()+")",null);
        }catch(Exception error){fail();}
    }
    private void focusPdfInput(){
        if(!pdf||controls==null)return;
        controls.post(()->{if(pdfWantsFocus&&attached&&state!=null&&state.optBoolean("mounted")&&valid.getAsBoolean()){pdfWantsFocus=false;controls.requestFocus();((android.view.inputmethod.InputMethodManager)activity.getSystemService(Activity.INPUT_METHOD_SERVICE)).showSoftInput(controls,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);}});
    }
    private final class Actions {
        public void pdfInput(String token,String value,boolean submit){
            if(!pdf||token==null||!token.matches("p-[0-9]{1,6}")||value==null||value.length()>256)return;
            activity.runOnUiThread(()->{if(attached&&state!=null&&state.optBoolean("mounted")&&valid.getAsBoolean())web.evaluateJavascript("window.easybook"+prefix()+"SurfaceInput&&window.easybook"+prefix()+"SurfaceInput("+JSONObject.quote(token)+","+JSONObject.quote(value)+","+submit+")",null);});
        }
        public void pdfFocus(){activity.runOnUiThread(()->{if(pdf&&attached&&valid.getAsBoolean()&&controls!=null){pdfWantsFocus=true;focusPdfInput();}});}

        public void focusSearch(){activity.runOnUiThread(()->{if(dock&&"DockSearch".equals(dockPrefix)&&attached&&valid.getAsBoolean()){web.requestFocus();web.evaluateJavascript("window.easybookDockSearchFocus&&window.easybookDockSearchFocus()",value->{if(valid.getAsBoolean())((android.view.inputmethod.InputMethodManager)activity.getSystemService(Activity.INPUT_METHOD_SERVICE)).showSoftInput(web,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);});}});}

        public void moveScroll(double top){if(!Double.isFinite(top)||top<0||top>100000)return;activity.runOnUiThread(()->{if((move||sync)&&attached&&valid.getAsBoolean())web.evaluateJavascript("window.easybook"+prefix()+"SurfaceScroll&&window.easybook"+prefix()+"SurfaceScroll("+top+")",null);});}
        public void drag(String phase,double y,int pointer){if(!phase.matches("down|move|up|cancel")||!Double.isFinite(y)||Math.abs(y)>10000||pointer<0)return;activity.runOnUiThread(()->{if(move&&attached&&valid.getAsBoolean())web.evaluateJavascript("window.easybookMoveSurfaceDrag&&window.easybookMoveSurfaceDrag("+JSONObject.quote(phase)+","+y+","+pointer+")",null);});}
        public void gesture(boolean active){activity.runOnUiThread(()->{if(toolbar&&attached&&valid.getAsBoolean())web.evaluateJavascript("window.easybookToolbarSurfaceGesture&&window.easybookToolbarSurfaceGesture("+active+")",null);});}
        public void scroll(double left){if(!Double.isFinite(left)||left<0||left>100000)return;activity.runOnUiThread(()->{if(toolbar&&attached&&valid.getAsBoolean())web.evaluateJavascript("window.easybookToolbarSurfaceScroll&&window.easybookToolbarSurfaceScroll("+left+")",null);});}

        public void ready(int revision){activity.runOnUiThread(()->{
            if(attached&&state!=null&&valid.getAsBoolean()&&revision==state.optInt("revision"))web.evaluateJavascript("window.easybook"+prefix()+"SurfaceReady&&window.easybook"+prefix()+"SurfaceReady("+revision+")",null);
        });}
        public void click(String token){
            if(token==null||!token.matches((pdf?"p":sync?"s":dock?"d":move?"m":toolbar?"t":"f")+"-[0-9]{1,6}"))return;
            activity.runOnUiThread(()->{if(attached&&state!=null&&state.optBoolean("mounted")&&valid.getAsBoolean())web.evaluateJavascript("window.easybook"+prefix()+"SurfaceClick&&window.easybook"+prefix()+"SurfaceClick("+JSONObject.quote(token)+")",null);});
        }
    }
}

