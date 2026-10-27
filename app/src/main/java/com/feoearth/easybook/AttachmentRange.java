package com.feoearth.easybook;
import java.io.IOException;
/** A single RFC 9110 byte range; multipart ranges are deliberately rejected. */
final class AttachmentRange {
 final long start,end,count;final boolean partial;
 private AttachmentRange(long start,long end,boolean partial){this.start=start;this.end=end;this.count=Math.max(0,end-start+1);this.partial=partial;}
 static AttachmentRange parse(String value,long length)throws IOException{
  if(value==null)return new AttachmentRange(0,length-1,false);
  try{
   java.util.regex.Matcher m=java.util.regex.Pattern.compile("bytes=([0-9]*)-([0-9]*)").matcher(value.trim());
   if(!m.matches()||length<=0||m.group(1).isEmpty()&&m.group(2).isEmpty())throw new IOException("Unsatisfiable range");
   long start,end=length-1;
   if(m.group(1).isEmpty()){long suffix=Long.parseLong(m.group(2));if(suffix<=0)throw new IOException("Unsatisfiable range");start=Math.max(0,length-suffix);}
   else{start=Long.parseLong(m.group(1));if(!m.group(2).isEmpty())end=Math.min(end,Long.parseLong(m.group(2)));}
   if(start>end||start>=length)throw new IOException("Unsatisfiable range");
   return new AttachmentRange(start,end,true);
  }catch(NumberFormatException e){throw new IOException("Unsatisfiable range",e);}
 }
}
