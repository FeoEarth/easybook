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
import org.json.JSONArray;
import java.util.function.BooleanSupplier;

/** Shared native QWEA0 glass menus. The WebView owns every actual command. API 33+. */
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
    private boolean sort,closing,disabled,renderingFailed;
    private View oldFocus;
    private final FormatGlassFrame formatFrame;
    private EditText linkInput;
    private String pendingCommand;
    private String pendingValue;
    private boolean panel(){return state!=null&&!state.optString("kind","list").equals("list");}
    public NativeGlassMenu(Activity activity,FrameLayout root,WebView web,BooleanSupplier valid){
        this.activity=activity;this.root=root;this.web=web;this.valid=valid;
        backdrop=new GlassBackdrop(activity);
        formatFrame=new FormatGlassFrame(activity,root,web,backdrop,this::captureCurrent,valid);
    }
    private int dp(float x){return Math.round(x*activity.getResources().getDisplayMetrics().density);}
    public boolean isShowing(){return shield!=null;}
    public boolean show(JSONObject input){
        if("format".equals(input.optString("kind")))return false;
        if(disabled||!valid.getAsBoolean()||!root.isHardwareAccelerated()||web.getWidth()<dp(240)||web.getHeight()<dp(280)||((PowerManager)activity.getSystemService(Activity.POWER_SERVICE)).isPowerSaveMode())return false;
        if(isShowing())return true;
        state=input;sort=false;closing=false;pendingCommand=null;linkInput=null;boolean dark=input.optBoolean("dark");
        oldFocus=root.findFocus();
        shield=new FrameLayout(activity);shield.setTag("native-glass-shield");shield.setFocusableInTouchMode(true);shield.setClickable(true);
        shield.setOnClickListener(v->dismiss(false));
        try{surface=new GlassSurface(activity,backdrop,dark,()->{disabled=true;renderingFailed=true;dismiss(true);fallback();});}catch(Exception|LinkageError error){disabled=true;shield=null;surface=null;return false;}
        surface.setTag("native-glass-menu");surface.setClickable(true);surface.setOnClickListener(v->{});
        rows=new LinearLayout(activity);rows.setOrientation(LinearLayout.VERTICAL);rows.setPadding(dp(8),dp(8),dp(8),dp(8));
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(false);scroll.setVerticalScrollBarEnabled(false);scroll.addView(rows);
        surface.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        populate();
        int width=Math.min(dp(292),web.getWidth()-dp(24));
        rows.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(web.getHeight()-dp(24),View.MeasureSpec.AT_MOST));
        int height=Math.min(rows.getMeasuredHeight(),web.getHeight()-dp(24));
        float scale=web.getWidth()/(float)Math.max(1,input.optDouble("viewportWidth",web.getWidth()));
        int x=Math.max(dp(12),Math.min(web.getWidth()-width-dp(12),Math.round((float)input.optDouble("right")*scale)-width));
        int y=Math.max(dp(12),Math.min(web.getHeight()-height-dp(12),Math.round((float)input.optDouble("bottom")*scale)+dp(8)));
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,height);lp.leftMargin=x;lp.topMargin=y;shield.addView(surface,lp);if(anchored())positionAnchored();
        root.addView(shield,new FrameLayout.LayoutParams(-1,-1));captureCurrent();if(!panel())shield.requestFocus();
        if(!anchored()){surface.setPivotX(width-dp(22));surface.setPivotY(0);}surface.setAlpha(0);surface.setScaleX(.94f);surface.setScaleY(.94f);
        surface.animate().alpha(1).scaleX(1).scaleY(1).setDuration(ValueAnimator.areAnimatorsEnabled()?GlassMaterial.OPEN_MS:0).setInterpolator(new PathInterpolator(.2f,.75f,.25f,1)).start();
        web.evaluateJavascript("document.getElementById('listMore').setAttribute('aria-expanded','true')",null);return true;
    }
    private int ink(){return state.optBoolean("dark")?0xfff4f4f7:0xff1c1c1e;}
    private void populate(){
        rows.removeAllViews();
        if(panel()){populatePanel();return;}
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
    public void refreshBackdrop(){
        if(isShowing()&&!closing){web.invalidate();backdrop.invalidate();surface.invalidate();}
        else if(formatFrame.surface()!=null){web.invalidate();backdrop.invalidate();formatFrame.surface().invalidate();}
    }
    public void updateFormatFrame(JSONObject args){if(valid.getAsBoolean())formatFrame.update(args);}
    public void clearFormatFrame(){formatFrame.dispose();}
    private void captureCurrent(){backdrop.captureFor(isShowing()?surface:formatFrame.surface());}
    public void onBoundsChanged(){
        formatFrame.boundsChanged();
        if(!isShowing())return;
        if(anchored()){
            root.post(()->{if(!isShowing()||closing)return;positionAnchored();if(valid.getAsBoolean())web.evaluateJavascript("window.easybookNativeGlassReanchor&&window.easybookNativeGlassReanchor()",null);});return;
        }
        if(!panel()){dismiss(true);return;}
        // Keep native URL input and IME alive while safe-area/keyboard bounds move.
        root.post(()->{if(!isShowing()||closing)return;
            FrameLayout.LayoutParams lp=(FrameLayout.LayoutParams)surface.getLayoutParams();
            int available=Math.max(dp(100),web.getHeight()-dp(24));
            rows.measure(View.MeasureSpec.makeMeasureSpec(lp.width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(available,View.MeasureSpec.AT_MOST));
            lp.height=Math.min(rows.getMeasuredHeight(),available);
            lp.topMargin=Math.max(dp(12),Math.min(lp.topMargin,web.getHeight()-lp.height-dp(12)));
            surface.setLayoutParams(lp);refreshBackdrop();});
    }
    private boolean anchored(){return state!=null&&state.has("placement");}
    public void updateMenuAnchor(JSONObject input){
        if(!isShowing()||closing||!anchored())return;
        try{for(String field:new String[]{"anchorLeft","anchorTop","anchorRight","anchorBottom","viewportWidth","viewportHeight"})state.put(field,input.getDouble(field));}catch(Exception error){return;}
        positionAnchored();refreshBackdrop();
    }
    private void positionAnchored(){
        if(surface==null||rows==null||!anchored())return;
        float scale=web.getWidth()/(float)Math.max(1,state.optDouble("viewportWidth",web.getWidth()));
        int availableWidth=web.getWidth(),availableHeight=Math.min(web.getHeight(),Math.round((float)state.optDouble("viewportHeight",web.getHeight()/scale)*scale));
        int width=Math.min(dp(292),availableWidth-dp(24));if(width<1||availableHeight<dp(40))return;
        rows.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));
        int natural=rows.getMeasuredHeight();
        int left=Math.round((float)state.optDouble("anchorLeft")*scale),right=Math.round((float)state.optDouble("anchorRight")*scale);
        int top=Math.round((float)state.optDouble("anchorTop")*scale),bottom=Math.round((float)state.optDouble("anchorBottom")*scale);
        int above=Math.max(0,top-dp(20)),below=Math.max(0,availableHeight-bottom-dp(20));
        boolean up="above".equals(state.optString("placement"))?(above>=natural||above>=below):(below<natural&&above>below);
        int height=Math.max(1,Math.min(natural,up?above:below));
        int x=Math.max(dp(12),Math.min(availableWidth-width-dp(12),right-width));
        int y=Math.max(dp(12),Math.min(availableHeight-height-dp(12),up?top-height-dp(8):bottom+dp(8)));
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(width,height);lp.leftMargin=x;lp.topMargin=y;surface.setLayoutParams(lp);
        surface.setPivotX(Math.max(0,Math.min(width,(left+right)/2f-x)));surface.setPivotY(up?height:0);
    }
    private void fallback(){if(valid.getAsBoolean())web.evaluateJavascript("window.easybookNativeGlassFallback && window.easybookNativeGlassFallback()",null);}
    private void command(String id){
        if(closing)return;
        pendingCommand=id;pendingValue=linkInput==null?"":linkInput.getText().toString();dismiss(false);
    }
    private void populatePanel(){
        LinearLayout header=new LinearLayout(activity);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(dp(12),dp(4),dp(4),dp(6));
        TextView title=new TextView(activity);title.setText(state.optString("title","操作"));title.setTextColor(ink());title.setTextSize(18);title.setTypeface(null,Typeface.BOLD);
        header.addView(title,new LinearLayout.LayoutParams(0,-2,1));
        TextView close=new TextView(activity);close.setText("×");close.setTextSize(25);close.setTextColor(ink());close.setGravity(Gravity.CENTER);close.setContentDescription("关闭");close.setOnClickListener(v->dismiss(false));header.addView(close,new LinearLayout.LayoutParams(dp(44),dp(44)));rows.addView(header);
        if(state.optString("kind").equals("link")){
            linkInput=new EditText(activity);linkInput.setSingleLine(true);linkInput.setText(state.optString("value"));linkInput.setTextColor(ink());linkInput.setHintTextColor(state.optBoolean("dark")?0xffaaaab0:0xff66666c);linkInput.setHint("https://");linkInput.setTextSize(16);
            linkInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);
            linkInput.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2048)});
            linkInput.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            LinearLayout.LayoutParams inputLp=new LinearLayout.LayoutParams(-1,dp(52));inputLp.setMargins(dp(12),0,dp(12),dp(10));rows.addView(linkInput,inputLp);
        }
        JSONArray items=state.optJSONArray("items");if(items==null)return;
        for(int i=0;i<items.length();i++){
            JSONObject item=items.optJSONObject(i);if(item==null)continue;
            String id=item.optString("id"),label=item.optString("label");
            row(label,item.optString("subtitle"),id,()->command(id),item.optBoolean("checked"));
            View row=rows.getChildAt(rows.getChildCount()-1);row.setEnabled(!item.optBoolean("disabled"));row.setAlpha(row.isEnabled()?1f:.4f);
            if(item.optBoolean("danger")){LinearLayout text=(LinearLayout)((LinearLayout)row).getChildAt(0);((TextView)text.getChildAt(0)).setTextColor(0xffe5484d);}
        }
    }
    public void dismiss(boolean immediate){
        if(shield==null||closing)return;closing=true;
        FrameLayout previous=shield;GlassSurface glass=surface;
        String command=pendingCommand,value=pendingValue;
        Runnable done=()->{
            root.removeView(previous);
            if(shield==previous){shield=null;surface=null;closing=false;pendingCommand=null;linkInput=null;}
            captureCurrent();
            if(oldFocus!=null&&oldFocus.isAttachedToWindow())oldFocus.requestFocus();
            if(valid.getAsBoolean()&&!renderingFailed){
                web.evaluateJavascript("document.getElementById('listMore').setAttribute('aria-expanded','false');window.easybookNativeGlassClosed&&window.easybookNativeGlassClosed("+(command!=null)+")",null);
                if(command!=null)web.evaluateJavascript("window.easybookNativeGlassCommand&&window.easybookNativeGlassCommand("+JSONObject.quote(command)+","+JSONObject.quote(value==null?"":value)+")",null);
            }
        };
        glass.animate().cancel();if(immediate||!ValueAnimator.areAnimatorsEnabled())done.run();else glass.animate().alpha(0).scaleX(.96f).scaleY(.96f).setDuration(GlassMaterial.CLOSE_MS).withEndAction(done).start();
    }
    private static final class Icon extends View {
        private final Paint paint=new Paint(3);private final String id;private final boolean checked;
        Icon(Activity a,String id,boolean checked,int color){super(a);this.id=id;this.checked=checked;paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.6f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
        @Override protected void onDraw(Canvas c){super.onDraw(c);c.save();c.scale(getWidth()/24f,getHeight()/24f);Path p=new Path();
            if(id.equals("sort")||id.equals("back")){float x=id.equals("sort")?9:15;p.moveTo(x,5);p.lineTo(24-x,12);p.lineTo(x,19);c.drawPath(p,paint);}
            else if(id.equals("layout")){for(int i=0;i<3;i++){c.drawLine(8,5+i*7,21,5+i*7,paint);c.drawPoint(3,5+i*7,paint);}}
            else if(id.equals("select")||id.equals("checklist")||checked){if(id.equals("select"))c.drawCircle(12,12,9,paint);else if(id.equals("checklist"))c.drawRoundRect(3,3,21,21,5,5,paint);p.moveTo(7,12);p.lineTo(10,15);p.lineTo(18,7);c.drawPath(p,paint);}
            c.restore();
        }
    }
}
