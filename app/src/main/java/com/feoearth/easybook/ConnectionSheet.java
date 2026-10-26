package com.feoearth.easybook;

import android.app.Activity;
import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.text.InputFilter;
import android.text.InputType;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import com.feoearth.easybook.glass.*;
import java.util.Locale;
import java.util.function.Consumer;

/** Native-only credential surface. No credential is serialized into WebView content. */
final class ConnectionSheet {
    private final Activity activity; private final boolean dark; private final Consumer<String> connect;
    private final Runnable reveal,closed;
    private FrameLayout overlay,root,panel; private LinearLayout body,header; private EditText input;
    private TextView feedback; private Button commit; private String pending=""; private boolean busy,secureBefore,editing;
    private NativeGlassMenu glass; private boolean mcp;
    void useMcp(){mcp=true;}
    ConnectionSheet(Activity a,boolean d,Consumer<String> c,Runnable r,Runnable close){activity=a;dark=d;connect=c;reveal=r;closed=close;}
    private int dp(float n){return Math.round(n*activity.getResources().getDisplayMetrics().density);}
    private int ink(){return dark?0xfff2f2f7:0xff1c1c1e;} private int muted(){return dark?0xff98989f:0xff8e8e93;} private int accent(){return dark?0xffe6bb32:0xffb88a00;}
    private GradientDrawable fill(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private TextView text(String value,int size,int color){TextView v=new TextView(activity);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setLineSpacing(dp(3),1);return v;}
    private Button button(String title,Runnable action){Button b=new Button(activity);b.setText(title);b.setTextSize(16);b.setAllCaps(false);b.setTextColor(accent());b.setMinimumHeight(dp(44));b.setMinHeight(dp(44));b.setPadding(dp(12),dp(8),dp(12),dp(8));b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(dark?0x33ffffff:0x22000000),fill(dark?0x24767680:0x18767680,22),null));b.setOnClickListener(v->action.run());return b;}
    void show(){
        if(activity.isFinishing()||activity.isDestroyed())return;
        ViewGroup content=activity.findViewById(android.R.id.content);root=(FrameLayout)content;
        if(activity instanceof MainActivity){glass=((MainActivity)activity).nativeGlass;if(glass!=null){glass.dismiss(true);glass.clearFormatFrame();root=(FrameLayout)glass.backdrop.getParent();}}
        secureBefore=(activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0;activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        overlay=new FrameLayout(activity);overlay.setBackgroundColor(0x33000000);overlay.setClickable(true);overlay.setFocusableInTouchMode(true);overlay.setOnClickListener(v->{if(!busy)close();});
        panel=new FrameLayout(activity);panel.setClickable(true);panel.setBackground(fill(dark?0xff1c1c1e:0xfff2f2f7,30));
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(false);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);
        body=new LinearLayout(activity);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(16),dp(12),dp(16),dp(24));scroll.addView(body);panel.addView(scroll);
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams(Math.min(dp(620),root.getWidth()-dp(16)),ViewGroup.LayoutParams.WRAP_CONTENT,Gravity.BOTTOM|Gravity.CENTER_HORIZONTAL);lp.setMargins(dp(8),dp(8),dp(8),dp(8));overlay.addView(panel,lp);root.addView(overlay,new FrameLayout.LayoutParams(-1,-1));
        overlay.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{ViewGroup.LayoutParams sp=scroll.getLayoutParams();int max=Math.max(dp(120),b-t-dp(24));body.measure(View.MeasureSpec.makeMeasureSpec(Math.max(dp(120),panel.getWidth()),View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED));int height=Math.min(body.getMeasuredHeight(),max);if(sp.height!=height){sp.height=height;scroll.setLayoutParams(sp);}FrameLayout.LayoutParams pp=(FrameLayout.LayoutParams)panel.getLayoutParams();int width=Math.min(dp(620),r-l-dp(16));if(pp.width!=width){pp.width=width;panel.setLayoutParams(pp);}});
        inputPage();overlay.requestFocus();
    }
    private void begin(String title,String left,Runnable cancel,String right,Runnable submit){body.removeAllViews();header=new LinearLayout(activity);header.setGravity(Gravity.CENTER_VERTICAL);Button back=button(left,cancel);header.addView(back);TextView heading=text(title,17,ink());heading.setGravity(Gravity.CENTER);heading.setTypeface(null,Typeface.BOLD);heading.setSingleLine(true);heading.setEllipsize(android.text.TextUtils.TruncateAt.END);header.addView(heading,new LinearLayout.LayoutParams(0,dp(52),1));commit=button(right,submit);header.addView(commit);body.addView(header);}
    private void note(String value){TextView v=text(value,13,muted());v.setPadding(dp(8),dp(16),dp(8),dp(16));body.addView(v);}
    private void status(){feedback=text("",13,muted());feedback.setMinHeight(dp(42));feedback.setPadding(dp(8),dp(8),dp(8),0);feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(feedback);}
    private void glassHeader(){if(Build.VERSION.SDK_INT<33||glass==null||activity.getPreferences(Context.MODE_PRIVATE).getBoolean("fastMode",false))return;try{GlassSurface surface=new GlassSurface(activity,glass.backdrop,dark,()->{});surface.useToolbarSurface();surface.setFormatCorner(dp(26));body.removeView(header);surface.addView(header,new FrameLayout.LayoutParams(-1,-2));body.addView(surface,0,new LinearLayout.LayoutParams(-1,-2));glass.backdrop.captureFor(surface);}catch(Exception|LinkageError ignored){}}
    private void inputPage(){editing=true;begin(mcp?"AI 与 MCP":"连接其他设备","取消",this::close,mcp?"授权":"连接",()->{String k=input.getText().toString().trim();if(!mcp)k=k.toLowerCase(Locale.ROOT);if(!k.matches(mcp?"[A-Za-z0-9_-]{24,128}":"[a-f0-9]{64}")){error(mcp?"请输入完整的一次性配对码":"请输入完整的 64 位同步密钥");input.requestFocus();return;}pending=k;hideKeyboard();input.setText("");confirmPage();});
        note(mcp?"在 AI 客户端获取一次性配对码，粘贴后授权访问当前工作区。":"输入另一设备的同步密钥，即可连接同一笔记空间。");input=new EditText(activity);input.setTextSize(16);input.setTextColor(ink());input.setHintTextColor(muted());input.setHint(mcp?"粘贴一次性配对码":"粘贴 64 位同步密钥");input.setTypeface(Typeface.MONOSPACE);input.setMinLines(3);input.setMaxLines(5);input.setGravity(Gravity.TOP);input.setPadding(dp(16),dp(14),dp(16),dp(14));input.setBackground(fill(dark?0xff2c2c2e:0xffffffff,18));input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS|InputType.TYPE_TEXT_FLAG_MULTI_LINE);input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);if(Build.VERSION.SDK_INT>=29)input.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(mcp?128:256)});body.addView(input,new LinearLayout.LayoutParams(-1,-2));status();Button view=button("查看本机密钥",()->{hideKeyboard();reveal.run();});if(!mcp)body.addView(view,new LinearLayout.LayoutParams(-1,-2));note(mcp?"有效期以 AI 客户端显示的时间为准，过期后请获取新码。\n同步密钥始终由原生层保管，无需提供给 AI。":"密钥由 Android Keystore 加密保存。连接其他空间不会删除原笔记。\n电脑端：easybook.loonxy.com");glassHeader();}
    private void confirmPage(){editing=false;begin(mcp?"确认授权":"确认连接","返回",()->{pending="";inputPage();},mcp?"授权":"连接",()->{if(busy)return;busy=true;commit.setEnabled(false);commit.setText(mcp?"授权中…":"连接中…");feedback.setText(mcp?"正在验证工作区并提交客户端授权…":"正在安全保存连接信息…");connect.accept(pending);pending="";});note(mcp?"批准此配对码对应的 AI 客户端，只读访问当前工作区。请确认配对码来自你正在使用的客户端。":"已有本机笔记将保留。失效凭据会重新加密保存，不会自动清空或覆盖笔记。");status();glassHeader();}
    void credential(String key,Runnable copy){if(overlay==null)return;editing=false;begin("本机同步密钥","返回",this::inputPage,"复制",()->{copy.run();inputPage();feedback.setText("密钥已复制，请仅提供给自己的设备");});note("仅在此原生面板显示。请只分享给自己的设备，不要发送给 AI。");TextView value=text(key,16,ink());value.setTypeface(Typeface.MONOSPACE);value.setPadding(dp(16),dp(16),dp(16),dp(16));value.setBackground(fill(dark?0xff2c2c2e:0xffffffff,18));value.setTextIsSelectable(false);body.addView(value);glassHeader();}
    void error(String message){if(overlay==null)return;busy=false;pending="";if(!editing)inputPage();feedback.setTextColor(0xffff3b30);feedback.setText(message);}
    void mcpSuccess(){if(overlay==null)return;busy=false;pending="";if(input!=null)input.setText("");begin("授权成功","完成",this::close,"完成",this::close);note("本次配对已完成，当前客户端已获得工作区只读授权。请返回 AI 客户端继续使用。");glassHeader();}
    boolean back(){if(overlay==null)return false;if(!busy)close();return true;}
    private void hideKeyboard(){((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(overlay.getWindowToken(),0);}
    void close(){if(overlay==null)return;hideKeyboard();pending="";if(input!=null)input.setText("");body.removeAllViews();root.removeView(overlay);overlay=null;if(glass!=null)glass.refreshBackdrop();if(!secureBefore)activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);closed.run();}
}
