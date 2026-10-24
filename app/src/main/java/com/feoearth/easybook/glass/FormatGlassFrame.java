package com.feoearth.easybook.glass;

import android.app.Activity;
import android.os.PowerManager;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import org.json.JSONObject;

/** Material-only adapter for the protected DOM format panel. No native controls. */
final class FormatGlassFrame {
    private final Activity activity;
    private final FrameLayout root;
    private final WebView web;
    private final GlassBackdrop backdrop;
    private final Runnable changed;
    private GlassSurface surface;
    private boolean dark,broken;

    FormatGlassFrame(Activity activity,FrameLayout root,WebView web,GlassBackdrop backdrop,Runnable changed){
        this.activity=activity;this.root=root;this.web=web;this.backdrop=backdrop;this.changed=changed;
    }
    GlassSurface surface(){return surface;}
    void clear(){
        if(surface!=null){root.removeView(surface);surface=null;changed.run();}
    }
    void update(JSONObject args){
        if(!args.optBoolean("visible")){clear();return;}
        if(broken||!root.isHardwareAccelerated()||((PowerManager)activity.getSystemService(Activity.POWER_SERVICE)).isPowerSaveMode()){
            clear();return; // The historical WebView material is always present underneath.
        }
        float scale=web.getWidth()/(float)Math.max(1,args.optDouble("viewportWidth",1));
        int left=Math.round((float)args.optDouble("left")*scale),top=Math.round((float)args.optDouble("top")*scale);
        int width=Math.round((float)args.optDouble("width")*scale),height=Math.round((float)args.optDouble("height")*scale);
        if(width<24||height<24||left<0||top<0||left+width>web.getWidth()+2||top+height>web.getHeight()+2){clear();return;}
        boolean newDark=args.optBoolean("dark");
        if(surface!=null&&dark!=newDark)clear();
        if(surface==null){
            try{
                surface=new GlassSurface(activity,backdrop,newDark,()->{broken=true;clear();});
                surface.useFormatFrame();surface.setTag("format-glass-frame");dark=newDark;
                // Only a non-interactive rim sits above WebView. No shield/focus
                // request, no duplicated toolbar, no native format buttons.
                root.addView(surface,new FrameLayout.LayoutParams(width,height));
            }catch(Exception|LinkageError error){surface=null;broken=true;return;}
        }
        int[] webAt=new int[2],rootAt=new int[2];web.getLocationInWindow(webAt);root.getLocationInWindow(rootAt);
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,height);
        lp.leftMargin=left+webAt[0]-rootAt[0];lp.topMargin=top+webAt[1]-rootAt[1];
        surface.setLayoutParams(lp);surface.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);changed.run();
    }
}
