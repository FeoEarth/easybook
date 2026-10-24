package com.feoearth.easybook.glass;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.RenderNode;
import android.widget.FrameLayout;

/** Shared API 33+ GPU backdrop. Records the normal hardware draw once; never reads pixels. */
public final class GlassBackdrop extends FrameLayout {
    private final RenderNode node=new RenderNode("EasybookWebViewBackdrop");
    private boolean capturing;
    private android.view.View consumer,secondary;
    public long recordings, recordNanos;
    public GlassBackdrop(Context context){super(context);setClipChildren(false);}
    public RenderNode recording(){return node;}
    public void captureFor(android.view.View view){captureFor(view,null);}
    public void captureFor(android.view.View view,android.view.View other){consumer=view;secondary=other;capturing=view!=null;if(!capturing)node.discardDisplayList();invalidate();}
    @Override public void onDescendantInvalidated(android.view.View child,android.view.View target){
        super.onDescendantInvalidated(child,target);
        if(capturing && consumer!=null){invalidate();consumer.postInvalidateOnAnimation();if(secondary!=null)secondary.postInvalidateOnAnimation();}
    }
    @Override protected void dispatchDraw(Canvas canvas){
        if(!capturing||!canvas.isHardwareAccelerated()||getWidth()==0||getHeight()==0){super.dispatchDraw(canvas);return;}
        long started=System.nanoTime();
        node.setPosition(0,0,getWidth(),getHeight());
        Canvas target=node.beginRecording(getWidth(),getHeight());
        try{super.dispatchDraw(target);}finally{node.endRecording();}
        canvas.drawRenderNode(node);recordings++;recordNanos+=System.nanoTime()-started;
        if(consumer!=null)consumer.postInvalidateOnAnimation();if(secondary!=null)secondary.postInvalidateOnAnimation();
    }
    @Override protected void onDetachedFromWindow(){node.discardDisplayList();consumer=null;secondary=null;super.onDetachedFromWindow();}
}
