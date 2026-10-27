package com.feoearth.easybook;
import org.junit.Test;
import static org.junit.Assert.*;
public class AttachmentRangeTest {
 @Test public void handlesWholeOpenSuffixAndClampedRanges()throws Exception{
  assertEquals(100,AttachmentRange.parse(null,100).count);
  assertEquals(90,AttachmentRange.parse("bytes=10-",100).count);
  assertEquals(90,AttachmentRange.parse("bytes=-10",100).start);
  assertEquals(99,AttachmentRange.parse("bytes=90-999",100).end);
  assertEquals(0,AttachmentRange.parse(null,0).count);
  assertEquals(900000000L,AttachmentRange.parse("bytes=900000000-",1000000000).start);
 }
 @Test public void rejectsInvalidAndMultipartRanges()throws Exception{
  for(String range:new String[]{"bytes=-0","bytes=-","bytes=100-","bytes=20-10","bytes=0-1,3-4","bytes=999999999999999999999-","nonsense"}){
   try{AttachmentRange.parse(range,100);fail(range);}catch(java.io.IOException expected){}
  }
  try{AttachmentRange.parse("bytes=0-",0);fail();}catch(java.io.IOException expected){}
 }
}
