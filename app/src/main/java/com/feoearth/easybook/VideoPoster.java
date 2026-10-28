package com.feoearth.easybook;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** A bounded, local-only first-frame cache. The caller must authorize the current
 * workspace attachment reference before calling this class, including cache hits. */
final class VideoPoster {
 private static final Object LOCK=new Object();
 private static WebResourceResponse image(String mime,InputStream bytes,long size){
  Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Content-Length",Long.toString(size));
  return new WebResourceResponse(mime,null,200,"OK",headers,bytes);
 }
 static WebResourceResponse response(Context context,File original,String space,String id)throws IOException{
  AttachmentStore.validId(id);NoteRepository.key(space);
  File directory=new File(context.getCacheDir(),"video-posters-v1/"+NoteRepository.spaceId(space)),poster=new File(directory,id+".jpg");
  if(!poster.isFile()&&Build.VERSION.SDK_INT>=27){
   synchronized(LOCK){
    if(!poster.isFile()){
     MediaMetadataRetriever retriever=new MediaMetadataRetriever();Bitmap frame=null;File pending=null;
     try{
      if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Poster cache unavailable");
      retriever.setDataSource(original.getAbsolutePath());
      int width=Integer.parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)),height=Integer.parseInt(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
      if(width<1||height<1||width>32768||height>32768)throw new IOException("Invalid video dimensions");
      float scale=Math.min(1f,1280f/Math.max(width,height));
      frame=retriever.getScaledFrameAtTime(0,MediaMetadataRetriever.OPTION_CLOSEST_SYNC,Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
      if(frame==null)throw new IOException("No decoded poster frame");
      pending=File.createTempFile("poster-",".jpg",directory);
      try(FileOutputStream out=new FileOutputStream(pending)){if(!frame.compress(Bitmap.CompressFormat.JPEG,88,out))throw new IOException("Poster encoding failed");out.getFD().sync();}
      Files.move(pending.toPath(),poster.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
     }catch(Exception failure){/* Poster failure never alters original playback or original bytes. */}
     finally{if(frame!=null)frame.recycle();try{retriever.release();}catch(Exception ignored){}if(pending!=null)pending.delete();}
    }
   }
  }
  if(poster.isFile())return image("image/jpeg",new FileInputStream(poster),poster.length());
  // Older platforms/unsupported codecs keep the app's custom play affordance,
  // rather than scaling WebView's generic system play poster over the picture.
  Bitmap empty=Bitmap.createBitmap(1,1,Bitmap.Config.ARGB_8888);ByteArrayOutputStream out=new ByteArrayOutputStream();try{empty.compress(Bitmap.CompressFormat.PNG,100,out);}finally{empty.recycle();}
  byte[] bytes=out.toByteArray();return image("image/png",new ByteArrayInputStream(bytes),bytes.length);
 }
}
