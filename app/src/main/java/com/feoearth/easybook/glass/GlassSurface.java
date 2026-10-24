package com.feoearth.easybook.glass;

import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.widget.FrameLayout;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** API 33+ Java port of QWEA0 MIT GlassLensRenderer. No PixelCopy/Bitmap path. */
public final class GlassSurface extends FrameLayout {
    private final GlassBackdrop source;
    private final RenderNode slice=new RenderNode("EasybookGlassSlice");
    private final RuntimeShader shader;
    private final int[] here=new int[2], there=new int[2];
    private final Paint fallback=new Paint();
    private final Runnable failed;
    private final boolean dark;
    private boolean broken,effectDirty=true;
    private int effectWidth=-1,effectHeight=-1;
    private float press,touchX,touchY;
    private boolean formatSurface;
    private float cornerDp=GlassMaterial.CORNER;
    private android.animation.ValueAnimator pressAnimator;
    private float refraction=GlassMaterial.REFRACTION;
    public long frames, drawNanos;
    public GlassSurface(Context context,GlassBackdrop source,boolean dark,Runnable failed)throws IOException{
        super(context);this.source=source;this.dark=dark;this.failed=failed;
        try(InputStream in=context.getAssets().open("native-glass/liquid-glass.agsl");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);
            shader=new RuntimeShader(bytes.toString(StandardCharsets.UTF_8.name()));
        }
        setWillNotDraw(false);setElevation(dp(18));
        setOutlineProvider(new ViewOutlineProvider(){@Override public void getOutline(View v,Outline o){o.setRoundRect(0,0,v.getWidth(),v.getHeight(),dp(cornerDp));}});
        setClipToOutline(true);fallback.setColor(dark?0xff25252b:0xfff9f9fc);
    }
    private float dp(float value){return value*getResources().getDisplayMetrics().density;}
    public void setRefractionForProbe(float value){refraction=value;effectDirty=true;invalidate();}
    public boolean isBroken(){return broken;}
    public void useFormatSurface(){
        formatSurface=true;setElevation(0);setFocusable(false);effectDirty=true;invalidate();
    }
    public void setFormatCorner(float pixels){
        float value=pixels/getResources().getDisplayMetrics().density;
        if(cornerDp!=value){cornerDp=value;effectDirty=true;invalidateOutline();invalidate();}
    }
    @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);drawGlass(canvas);}
    private void drawGlass(Canvas canvas){
        long started=System.nanoTime();
        if(broken||!canvas.isHardwareAccelerated()||!source.recording().hasDisplayList()){
            if(!formatSurface)canvas.drawRoundRect(0,0,getWidth(),getHeight(),dp(cornerDp),dp(cornerDp),fallback);return;
        }
        try{
            float blurRadius=dp(formatSurface?10f:GlassMaterial.BLUR);
            int margin=(int)Math.ceil(blurRadius*2+dp(GlassMaterial.REFRACTION+4));
            int w=getWidth()+2*margin,h=getHeight()+2*margin;
            getLocationInWindow(here);source.getLocationInWindow(there);
            slice.setPosition(-margin,-margin,getWidth()+margin,getHeight()+margin);
            Canvas recording=slice.beginRecording(w,h);
            try{recording.translate(margin-(here[0]-there[0]),margin-(here[1]-there[1]));recording.drawRenderNode(source.recording());}finally{slice.endRecording();}
            if(effectDirty||effectWidth!=getWidth()||effectHeight!=getHeight()){
            shader.setFloatUniform("margin",(float)margin);
            shader.setFloatUniform("viewSize",(float)getWidth(),(float)getHeight());
            float cx=getWidth()/2f,cy=getHeight()/2f,corner=dp(cornerDp);
            shader.setFloatUniform("shape1",cx,cy,cx,cy);
            shader.setFloatUniform("shape1L",cx,cy,cx,cy);
            shader.setFloatUniform("radii1",corner,corner,corner,corner);
            shader.setFloatUniform("shape2",0f,0f,0f,0f);
            shader.setFloatUniform("radius2",0f);shader.setFloatUniform("blendK",0f);
            shader.setFloatUniform("rimSoft",dp(.6f));shader.setFloatUniform("bevel",dp(GlassMaterial.EDGE));
            shader.setFloatUniform("refractPx",dp(formatSurface?10f:refraction));shader.setFloatUniform("falloff",1.6f);
            shader.setFloatUniform("refractDir",-1f);
            shader.setFloatUniform("sampleLo",margin+1f,margin+1f);
            shader.setFloatUniform("sampleHi",margin+getWidth()-1f,margin+getHeight()-1f);
            shader.setFloatUniform("dispersion",GlassMaterial.DISPERSION);
            shader.setFloatUniform("lightDir",-.7071f,-.7071f);
            shader.setFloatUniform("specStrength",dark?.65f:.5f);shader.setFloatUniform("rimBandMax",dp(3));
            int tint=formatSurface?(dark?0x30202028:0x20ffffff):(dark?GlassMaterial.DARK_TINT:GlassMaterial.LIGHT_TINT);
            shader.setFloatUniform("tintColor",Color.red(tint)/255f,Color.green(tint)/255f,Color.blue(tint)/255f,Color.alpha(tint)/255f);
            shader.setFloatUniform("adaptiveTint",0f);shader.setFloatUniform("glassTint",0f,0f,0f,0f);
            shader.setFloatUniform("dimAmount",dark?.035f:0f);shader.setFloatUniform("satFactor",formatSurface?1.02f:GlassMaterial.SATURATION);
            shader.setFloatUniform("press",press);shader.setFloatUniform("touchPos",touchX,touchY);shader.setFloatUniform("touchAmp",press);
            RenderEffect lens=RenderEffect.createRuntimeShaderEffect(shader,"content");
            RenderEffect blur=RenderEffect.createBlurEffect(blurRadius,blurRadius,Shader.TileMode.CLAMP);
            slice.setRenderEffect(RenderEffect.createChainEffect(lens,blur));effectWidth=getWidth();effectHeight=getHeight();effectDirty=false;
            }
            canvas.drawRenderNode(slice);frames++;
        }catch(RuntimeException ex){broken=true;post(failed);}
        drawNanos+=System.nanoTime()-started;
    }
    @Override public boolean dispatchTouchEvent(MotionEvent event){
        touchX=event.getX();touchY=event.getY();
        int action=event.getActionMasked();
        if(action==MotionEvent.ACTION_DOWN||action==MotionEvent.ACTION_UP||action==MotionEvent.ACTION_CANCEL){
            if(pressAnimator!=null)pressAnimator.cancel();
            float target=action==MotionEvent.ACTION_DOWN?1f:0f;
            if(!android.animation.ValueAnimator.areAnimatorsEnabled()){press=target;effectDirty=true;invalidate();}
            else {pressAnimator=android.animation.ValueAnimator.ofFloat(press,target);
                pressAnimator.setDuration(target>0?GlassMaterial.PRESS_MS:GlassMaterial.RELEASE_MS);
                pressAnimator.setInterpolator(new android.view.animation.DecelerateInterpolator());
                pressAnimator.addUpdateListener(a->{press=(float)a.getAnimatedValue();effectDirty=true;invalidate();});pressAnimator.start();}
        }else if(action==MotionEvent.ACTION_MOVE&&press>0){effectDirty=true;invalidate();}
        return super.dispatchTouchEvent(event);
    }
    @Override protected void onDetachedFromWindow(){if(pressAnimator!=null)pressAnimator.cancel();slice.discardDisplayList();super.onDetachedFromWindow();}
}
