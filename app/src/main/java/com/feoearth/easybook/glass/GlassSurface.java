package com.feoearth.easybook.glass;

import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.widget.FrameLayout;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** API 33+ GPU adapter for the attributed Apache-2.0 shader. No PixelCopy/Bitmap path. */
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
    private final float[] shapes=new float[32],radii=new float[8];
    private float refraction=GlassMaterial.REFRACTION;
    public long frames, drawNanos;
    public GlassSurface(Context context,GlassBackdrop source,boolean dark,Runnable failed)throws IOException{
        super(context);this.source=source;this.dark=dark;this.failed=failed;
        try(InputStream in=context.getAssets().open("native-glass/liquid-glass.agsl");ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);
            shader=new RuntimeShader(bytes.toString(StandardCharsets.UTF_8.name()));
        }
        setWillNotDraw(false);setElevation(dp(18));
        setOutlineProvider(new ViewOutlineProvider(){@Override public void getOutline(View v,Outline o){o.setRoundRect(0,0,v.getWidth(),v.getHeight(),dp(GlassMaterial.CORNER));}});
        setClipToOutline(true);fallback.setColor(dark?0xff25252b:0xfff9f9fc);
    }
    private float dp(float value){return value*getResources().getDisplayMetrics().density;}
    public void setRefractionForProbe(float value){refraction=value;effectDirty=true;invalidate();}
    public boolean isBroken(){return broken;}
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);long started=System.nanoTime();
        if(broken||!canvas.isHardwareAccelerated()||!source.recording().hasDisplayList()){
            canvas.drawRoundRect(0,0,getWidth(),getHeight(),dp(GlassMaterial.CORNER),dp(GlassMaterial.CORNER),fallback);return;
        }
        try{
            int margin=(int)Math.ceil(dp(GlassMaterial.BLUR*2+GlassMaterial.REFRACTION+4));
            int w=getWidth()+2*margin,h=getHeight()+2*margin;
            getLocationInWindow(here);source.getLocationInWindow(there);
            slice.setPosition(-margin,-margin,getWidth()+margin,getHeight()+margin);
            Canvas recording=slice.beginRecording(w,h);
            try{recording.translate(margin-(here[0]-there[0]),margin-(here[1]-there[1]));recording.drawRenderNode(source.recording());}finally{slice.endRecording();}
            if(effectDirty||effectWidth!=getWidth()||effectHeight!=getHeight()){
            java.util.Arrays.fill(shapes,-1000000f);java.util.Arrays.fill(radii,0);
            for(int i=0;i<8;i++){shapes[i*4+2]=0;shapes[i*4+3]=0;}
            shapes[0]=getWidth()/2f+margin;shapes[1]=getHeight()/2f+margin;shapes[2]=getWidth()/2f;shapes[3]=getHeight()/2f;radii[0]=dp(GlassMaterial.CORNER);
            shader.setFloatUniform("shapes",shapes);shader.setFloatUniform("shapeRadii",radii);
            shader.setFloatUniform("mergeK",0f);shader.setFloatUniform("refractionHeight",dp(GlassMaterial.EDGE));
            shader.setFloatUniform("refractionAmount",dp(refraction));shader.setFloatUniform("chromaticAberration",GlassMaterial.DISPERSION);
            int tint=dark?GlassMaterial.DARK_TINT:GlassMaterial.LIGHT_TINT;
            shader.setFloatUniform("tint",Color.red(tint)/255f,Color.green(tint)/255f,Color.blue(tint)/255f,Color.alpha(tint)/255f);
            shader.setFloatUniform("noiseAlpha",.005f);shader.setFloatUniform("lightDir",-.7071f,-.7071f);
            shader.setFloatUniform("highlightAlpha",dark?.24f:.34f);shader.setFloatUniform("highlightWidth",dp(1));
            shader.setFloatUniform("pressAmount",0f);shader.setFloatUniform("pressPoint",0f,0f);
            RenderEffect lens=RenderEffect.createRuntimeShaderEffect(shader,"content");
            ColorMatrix saturation=new ColorMatrix();saturation.setSaturation(GlassMaterial.SATURATION);
            RenderEffect blur=RenderEffect.createColorFilterEffect(new ColorMatrixColorFilter(saturation),RenderEffect.createBlurEffect(dp(GlassMaterial.BLUR),dp(GlassMaterial.BLUR),Shader.TileMode.CLAMP));
            slice.setRenderEffect(RenderEffect.createChainEffect(lens,blur));effectWidth=getWidth();effectHeight=getHeight();effectDirty=false;
            }
            canvas.drawRenderNode(slice);frames++;
        }catch(RuntimeException ex){broken=true;post(failed);}
        drawNanos+=System.nanoTime()-started;
    }
    @Override protected void onDetachedFromWindow(){slice.discardDisplayList();super.onDetachedFromWindow();}
}
