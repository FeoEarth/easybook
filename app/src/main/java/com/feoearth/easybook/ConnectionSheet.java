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

/** Full-page native settings. Credentials never enter a WebView or bridge payload. */
final class ConnectionSheet {
    private final Activity activity; private final boolean dark; private final Consumer<String> connect;
    private final Runnable reveal,closed;
    private FrameLayout root,page,navigation; private LinearLayout body,actions; private ScrollView scroll;
    private EditText input; private TextView feedback; private Button commit,backButton;
    private GlassBackdrop backdrop; private String pending=""; private boolean busy,secureBefore,editing,mcp;
    private Runnable backAction;
    ConnectionSheet(Activity a,boolean d,Consumer<String> c,Runnable r,Runnable close){activity=a;dark=d;connect=c;reveal=r;closed=close;}
    void useMcp(){mcp=true;}
    private int dp(float n){return Math.round(n*activity.getResources().getDisplayMetrics().density);}
    private int ink(){return dark?0xfff2f2f7:0xff1c1c1e;} private int muted(){return dark?0xff98989f:0xff8e8e93;}
    private int accent(){return dark?0xffe6bb32:0xffb88a00;} private int background(){return dark?0xff000000:0xfff2f2f7;} private int paper(){return dark?0xff1c1c1e:0xffffffff;}
    private GradientDrawable fill(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private TextView text(String value,int size,int color){TextView v=new TextView(activity);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setLineSpacing(dp(3),1);v.setIncludeFontPadding(false);return v;}
    private Button button(String title,Runnable action){Button b=new Button(activity);b.setText(title);b.setTextSize(17);b.setAllCaps(false);b.setTextColor(accent());b.setMinimumHeight(dp(50));b.setMinHeight(dp(50));b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(16),dp(12),dp(16),dp(12));b.setStateListAnimator(null);b.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(dark?0x22ffffff:0x16000000),fill(paper(),20),null));b.setOnClickListener(v->{if(!busy)action.run();});return b;}
    private void add(View v){body.addView(v,new LinearLayout.LayoutParams(-1,-2));}
    private void label(String title){TextView v=text(title,13,muted());v.setPadding(dp(16),dp(26),dp(16),dp(8));add(v);}
    private void note(String value){TextView v=text(value,13,muted());v.setPadding(dp(16),dp(10),dp(16),dp(2));add(v);}
    private void row(String title,String subtitle){LinearLayout group=new LinearLayout(activity);group.setOrientation(LinearLayout.VERTICAL);group.setPadding(dp(16),dp(16),dp(16),dp(16));group.setBackground(fill(paper(),20));TextView name=text(title,17,ink());group.addView(name);if(!subtitle.isEmpty()){TextView sub=text(subtitle,13,muted());sub.setPadding(0,dp(6),0,0);group.addView(sub);}add(group);}
    void show(){
        if(activity.isFinishing()||activity.isDestroyed())return;
        root=activity.findViewById(android.R.id.content);
        if(activity instanceof MainActivity){NativeGlassMenu glass=((MainActivity)activity).nativeGlass;if(glass!=null){glass.dismiss(true);glass.clearFormatFrame();root=(FrameLayout)glass.backdrop.getParent();}}
        secureBefore=(activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_SECURE)!=0;activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        page=new FrameLayout(activity);page.setBackgroundColor(background());page.setClickable(true);page.setFocusableInTouchMode(true);
        scroll=new ScrollView(activity);scroll.setFillViewport(true);scroll.setVerticalScrollBarEnabled(false);scroll.setClipToPadding(false);
        FrameLayout column=new FrameLayout(activity);body=new LinearLayout(activity);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(20),dp(72),dp(20),dp(32));
        FrameLayout.LayoutParams content=new FrameLayout.LayoutParams(-1,-2,Gravity.TOP|Gravity.CENTER_HORIZONTAL);column.addView(body,content);scroll.addView(column,new ScrollView.LayoutParams(-1,-2));
        if(Build.VERSION.SDK_INT>=33){backdrop=new GlassBackdrop(activity);backdrop.addView(scroll,new FrameLayout.LayoutParams(-1,-1));page.addView(backdrop,new FrameLayout.LayoutParams(-1,-1));}else page.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
        navigation=new FrameLayout(activity);navigation.setBackgroundColor(background());page.addView(navigation,new FrameLayout.LayoutParams(-1,dp(64),Gravity.TOP));
        root.addView(page,new FrameLayout.LayoutParams(-1,-1));page.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob)->{int width=Math.min(r-l,dp(680));ViewGroup.LayoutParams p=body.getLayoutParams();if(p.width!=width){p.width=width;body.setLayoutParams(p);}});
        inputPage();page.requestFocus();
    }
    private void begin(String title,Runnable back){
        hideKeyboard();if(input!=null)input.setText("");body.removeAllViews();navigation.removeAllViews();backAction=back;editing=false;
        backButton=button("‹  返回",()->backAction.run());backButton.setTextSize(17);backButton.setBackgroundColor(android.graphics.Color.TRANSPARENT);backButton.setContentDescription("返回");
        FrameLayout.LayoutParams nav=new FrameLayout.LayoutParams(dp(94),dp(44),Gravity.START|Gravity.CENTER_VERTICAL);nav.leftMargin=dp(12);
        if(Build.VERSION.SDK_INT>=33&&backdrop!=null&&!activity.getPreferences(Context.MODE_PRIVATE).getBoolean("fastMode",false)){
            try{GlassSurface lens=new GlassSurface(activity,backdrop,dark,()->{});lens.useToolbarSurface();lens.setFormatCorner(dp(22));lens.addView(backButton,new FrameLayout.LayoutParams(-1,-1));navigation.addView(lens,nav);backdrop.captureFor(lens);}catch(Exception|LinkageError e){if(backButton.getParent()!=null)((ViewGroup)backButton.getParent()).removeView(backButton);navigation.addView(backButton,nav);}
        }else navigation.addView(backButton,nav);
        TextView heading=text(title,34,ink());heading.setTypeface(null,Typeface.BOLD);heading.setPadding(0,dp(4),0,dp(4));add(heading);scroll.scrollTo(0,0);
    }
    private void status(){feedback=text("",13,muted());feedback.setMinHeight(dp(44));feedback.setPadding(dp(16),dp(10),dp(16),dp(8));feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);add(feedback);}
    private void primary(String title,Runnable action){commit=button(title,action);commit.setTextColor(0xff241c00);commit.setTypeface(null,Typeface.BOLD);commit.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x22000000),fill(accent(),22),null));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(52));lp.topMargin=dp(16);body.addView(commit,lp);}
    private void inputPage(){
        begin(mcp?"AI 与 MCP":"连接其他设备",this::close);editing=true;
        label(mcp?"工作区授权":"设备连接");row(mcp?"连接 AI 客户端":"连接同一笔记空间",mcp?"使用一次性配对码授权当前工作区":"在另一设备输入同一密钥即可同步");
        label(mcp?"一次性配对码":"另一设备的同步密钥");input=new EditText(activity);input.setTextSize(17);input.setTextColor(ink());input.setHintTextColor(muted());input.setHint(mcp?"粘贴配对码":"粘贴 64 位同步密钥");input.setTypeface(Typeface.MONOSPACE);input.setMinLines(3);input.setMaxLines(5);input.setGravity(Gravity.TOP);input.setPadding(dp(16),dp(16),dp(16),dp(16));input.setBackground(fill(paper(),20));input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS|InputType.TYPE_TEXT_FLAG_MULTI_LINE);input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);if(Build.VERSION.SDK_INT>=29)input.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(mcp?128:256)});add(input);
        note(mcp?"在 AI 客户端获取配对码，有效期以客户端显示为准。":"密钥由 Android Keystore 加密保存。");status();
        primary("继续",()->{String value=input.getText().toString().trim();if(!mcp)value=value.toLowerCase(Locale.ROOT);if(!value.matches(mcp?"[A-Za-z0-9_-]{24,128}":"[a-f0-9]{64}")){error(mcp?"请输入完整的一次性配对码":"请输入完整的 64 位同步密钥");input.requestFocus();return;}pending=value;confirmPage();});
        if(!mcp){label("本机设备");Button view=button("查看本机同步密钥  ›",()->{hideKeyboard();reveal.run();});view.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);add(view);note("仅提供给自己的设备。电脑端：easybook.loonxy.com");}else note("同步密钥由原生层保管，无需提供给 AI。");
    }
    private void confirmPage(){
        begin(mcp?"确认授权":"确认连接",()->{pending="";inputPage();});label("本次操作");row(mcp?"授予只读访问":"连接笔记空间",mcp?"请确认配对码来自你正在使用的 AI 客户端。":"本机笔记保留，不会自动清空或覆盖。");note(mcp?"此授权面向配对码对应的客户端，仅用于当前工作区。":"失效凭据会重新加密保存。连接其他空间后，原笔记仍保留在本机。");status();primary(mcp?"授权当前工作区":"确认连接",()->{busy=true;commit.setEnabled(false);backButton.setEnabled(false);commit.setText(mcp?"正在授权…":"正在连接…");feedback.setText(mcp?"正在验证工作区并提交授权…":"正在安全保存连接信息…");connect.accept(pending);pending="";});
    }
    void credential(String key,Runnable copy){if(page==null)return;begin("本机同步密钥",this::inputPage);label("同步密钥");TextView value=text(key,17,ink());value.setTypeface(Typeface.MONOSPACE);value.setPadding(dp(16),dp(16),dp(16),dp(16));value.setBackground(fill(paper(),20));value.setTextIsSelectable(false);add(value);note("仅向自己的设备提供，不要发送给 AI 或其他人。");primary("复制密钥",()->{copy.run();inputPage();feedback.setText("密钥已复制，请仅提供给自己的设备");});}
    void error(String message){if(page==null)return;busy=false;pending="";if(!editing)inputPage();feedback.setTextColor(0xffff3b30);feedback.setText(message);}
    void mcpSuccess(){if(page==null)return;busy=false;pending="";begin("授权成功",this::close);label("工作区授权");row("本次配对已完成","当前客户端已获得工作区只读授权");note("请返回 AI 客户端继续使用。");primary("完成",this::close);}
    boolean back(){if(page==null)return false;if(!busy){if(Build.VERSION.SDK_INT>=30&&page.getRootWindowInsets()!=null&&page.getRootWindowInsets().isVisible(WindowInsets.Type.ime())){hideKeyboard();if(input!=null)input.clearFocus();}else backAction.run();}return true;}
    private void hideKeyboard(){if(page!=null)((InputMethodManager)activity.getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(page.getWindowToken(),0);}
    void close(){if(page==null)return;hideKeyboard();pending="";if(input!=null)input.setText("");body.removeAllViews();navigation.removeAllViews();if(backdrop!=null)backdrop.captureFor(null);root.removeView(page);page=null;if(!secureBefore)activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);closed.run();}
}
