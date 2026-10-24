package com.feoearth.easybook.glass;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.graphics.*;
import android.graphics.drawable.*;
import android.os.PowerManager;
import android.view.*;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.*;
import org.json.JSONObject;
import java.util.function.BooleanSupplier;

/** One list More-menu experiment. The WebView owns every actual command. API 33+. */
public final class NativeGlassMenu {
    private final Activity activity;
    private final FrameLayout root;
    public final GlassBackdrop backdrop;
    private final WebView web;
    private final BooleanSupplier valid;
    private FrameLayout shield;
    public GlassSurface surface;
    private LinearLayout rows;
    private JSONObject state;
    private boolean sort,closing;
    private View oldFocus;
    public NativeGlassMenu(Activity activity,FrameLayout root,WebView web,BooleanSupplier valid){
        this.activity=activity;this.root=root;this.web=web;this.valid=valid;
        backdrop=new GlassBackdrop(activity);
    }
    private int dp(float x){return Math.round(x*activity.getResources().getDisplayMetrics().density);}
    public boolean isShowing(){return shield!=null;}
    public boolean show(JSONObject input){
        if(!valid.getAsBoolean()||!root.isHardwareAccelerated()||web.getWidth()<dp(240)||web.getHeight()<dp(280)||((PowerManager)activity.getSystemService(Activity.POWER_SERVICE)).isPowerSaveMode())return false;
        if(isShowing())return true;
        state=input;sort=false;closing=false;boolean dark=input.optBoolean("dark");
        oldFocus=root.findFocus();
        shield=new FrameLayout(activity);shield.setTag("native-glass-shield");shield.setFocusableInTouchMode(true);shield.setClickable(true);
        shield.setOnClickListener(v->dismiss(false));
        try{surface=new GlassSurface(activity,backdrop,dark,()->{dismiss(true);fallback();});}catch(Exception|LinkageError error){shield=null;surface=null;return false;}
        surface.setTag("native-glass-menu");surface.setClickable(true);surface.setOnClickListener(v->{});
        rows=new LinearLayout(activity);rows.setOrientation(LinearLayout.VERTICAL);rows.setPadding(dp(8),dp(8),dp(8),dp(8));
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);scroll.addView(rows);
        surface.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        populate();
        int width=Math.min(dp(272),web.getWidth()-dp(24));
        rows.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(web.getHeight()-dp(24),View.MeasureSpec.AT_MOST));
        int height=Math.min(rows.getMeasuredHeight(),web.getHeight()-dp(24));
        float scale=web.getWidth()/(float)Math.max(1,input.optDouble("viewportWidth",web.getWidth()));
        int x=Math.max(dp(12),Math.min(web.getWidth()-width-dp(12),Math.round((float)input.optDouble("right")*scale)-width));
        int y=Math.max(dp(12),Math.min(web.getHeight()-height-dp(12),Math.round((float)input.optDouble("bottom")*scale)+dp(8)));
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,height);lp.leftMargin=x;lp.topMargin=y;shield.addView(surface,lp);
        root.addView(shield,new FrameLayout.LayoutParams(-1,-1));backdrop.captureFor(surface);shield.requestFocus();
        surface.setPivotX(width-dp(22));surface.setPivotY(0);surface.setAlpha(0);surface.setScaleX(.94f);surface.setScaleY(.94f);
        surface.animate().alpha(1).scaleX(1).scaleY(1).setDuration(ValueAnimator.areAnimatorsEnabled()?220:0).setInterpolator(new PathInterpolator(.2f,.75f,.25f,1)).start();
        web.evaluateJavascript("document.getElementById('listMore').setAttribute('aria-expanded','true')",null);return true;
    }
    private int ink(){return state.optBoolean("dark")?0xfff4f4f7:0xff1c1c1e;}
    private void populate(){
        rows.removeAllViews();
        if(sort){
            row("返回","排序方式","back",()->{sort=false;populate();},false);
            divider();row("按编辑时间","","updated",()->command("sort-updated"),"updated".equals(state.optString("sort")));
            row("按标题","","title",()->command("sort-title"),"title".equals(state.optString("sort")));
        }else{
            row("排序方式","title".equals(state.optString("sort"))?"按标题":"按编辑时间","sort",()->{sort=true;populate();},false);
            row("grid".equals(state.optString("layout"))?"显示为列表":"显示为画廊","","layout",()->command("layout"),false);
            divider();row("选择备忘录","","select",()->command("select"),false);
            row("新建清单","","checklist",()->command("checklist"),false);
        }
    }
    private void divider(){View v=new View(activity);v.setBackgroundColor(state.optBoolean("dark")?0x24ffffff:0x18000000);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(1));lp.setMargins(dp(12),dp(3),dp(12),dp(3));rows.addView(v,lp);}
    private void row(String title,String subtitle,String id,Runnable action,boolean checked){
        LinearLayout row=new LinearLayout(activity);row.setTag("native-glass-"+id);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(12),dp(8),dp(12),dp(8));row.setMinimumHeight(dp(subtitle.isEmpty()?50:62));row.setContentDescription(title+(checked?"，已选中":""));
        GradientDrawable normal=new GradientDrawable();normal.setColor(Color.TRANSPARENT);normal.setCornerRadius(dp(16));GradientDrawable mask=new GradientDrawable();mask.setColor(Color.WHITE);mask.setCornerRadius(dp(16));
        row.setBackground(new RippleDrawable(android.content.res.ColorStateList.valueOf(state.optBoolean("dark")?0x2affffff:0x16000000),normal,mask));
        LinearLayout text=new LinearLayout(activity);text.setOrientation(LinearLayout.VERTICAL);TextView label=new TextView(activity);label.setText(title);label.setTextColor(ink());label.setTextSize(16);label.setSingleLine(true);text.addView(label);
        if(!subtitle.isEmpty()){TextView small=new TextView(activity);small.setText(subtitle);small.setTextColor(state.optBoolean("dark")?0xffbbbbc2:0xff66666c);small.setTextSize(12);small.setPadding(0,dp(2),0,0);text.addView(small);}
        row.addView(text,new LinearLayout.LayoutParams(0,-2,1));
        Icon icon=new Icon(activity,id,checked,ink());LinearLayout.LayoutParams ilp=new LinearLayout.LayoutParams(dp(22),dp(22));ilp.leftMargin=dp(10);row.addView(icon,ilp);
        row.setFocusable(true);row.setClickable(true);row.setOnClickListener(v->action.run());
        row.setOnTouchListener((v,event)->{if(event.getActionMasked()==MotionEvent.ACTION_DOWN)v.animate().scaleX(.98f).scaleY(.98f).setDuration(ValueAnimator.areAnimatorsEnabled()?90:0).start();else if(event.getActionMasked()==MotionEvent.ACTION_UP||event.getActionMasked()==MotionEvent.ACTION_CANCEL)v.animate().scaleX(1).scaleY(1).setDuration(ValueAnimator.areAnimatorsEnabled()?120:0).start();return false;});
        rows.addView(row,new LinearLayout.LayoutParams(-1,-2));
    }
    public boolean back(){if(!isShowing())return false;if(sort){sort=false;populate();}else dismiss(false);return true;}
    public void onBoundsChanged(){if(isShowing())dismiss(true);}
    private void fallback(){if(valid.getAsBoolean())web.evaluateJavascript("window.easybookNativeGlassFallback && window.easybookNativeGlassFallback()",null);}
    private void command(String id){if(closing)return;dismiss(false);if(valid.getAsBoolean())web.evaluateJavascript("window.easybookNativeGlassCommand && window.easybookNativeGlassCommand("+JSONObject.quote(id)+")",null);}
    public void dismiss(boolean immediate){
        if(shield==null||closing)return;closing=true;
        FrameLayout previous=shield;GlassSurface glass=surface;
        Runnable done=()->{if(valid.getAsBoolean())web.evaluateJavascript("document.getElementById('listMore').setAttribute('aria-expanded','false')",null);root.removeView(previous);backdrop.captureFor(null);if(shield==previous){shield=null;surface=null;closing=false;}if(oldFocus!=null&&oldFocus.isAttachedToWindow())oldFocus.requestFocus();};
        glass.animate().cancel();if(immediate||!ValueAnimator.areAnimatorsEnabled())done.run();else glass.animate().alpha(0).scaleX(.96f).scaleY(.96f).setDuration(150).withEndAction(done).start();
    }
    private static final class Icon extends View {
        private final Paint paint=new Paint(3);private final String id;private final boolean checked;
        Icon(Activity a,String id,boolean checked,int color){super(a);this.id=id;this.checked=checked;paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(a.getResources().getDisplayMetrics().density*1.6f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
        @Override protected void onDraw(Canvas c){super.onDraw(c);c.save();c.scale(getWidth()/24f,getHeight()/24f);Path p=new Path();
            if(id.equals("sort")||id.equals("back")){float x=id.equals("sort")?9:15;p.moveTo(x,5);p.lineTo(24-x,12);p.lineTo(x,19);c.drawPath(p,paint);}
            else if(id.equals("layout")){for(int i=0;i<3;i++){c.drawLine(8,5+i*7,21,5+i*7,paint);c.drawPoint(3,5+i*7,paint);}}
            else if(id.equals("select")||id.equals("checklist")||checked){if(id.equals("select"))c.drawCircle(12,12,9,paint);else if(id.equals("checklist"))c.drawRoundRect(3,3,21,21,5,5,paint);p.moveTo(7,12);p.lineTo(10,15);p.lineTo(18,7);c.drawPath(p,paint);}
            c.restore();
        }
    }
}
