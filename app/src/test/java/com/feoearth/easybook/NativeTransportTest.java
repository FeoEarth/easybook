package com.feoearth.easybook;
import org.junit.Test;
import java.io.IOException;
import java.util.ArrayList;
import static org.junit.Assert.*;
public class NativeTransportTest {
 @Test public void canonicalIsPreferredWithoutSendingCredentials()throws Exception{
  ArrayList<String> seen=new ArrayList<>();assertEquals(NativeAccount.ORIGIN,NativeTransport.select(true,(origin,account)->{seen.add(origin);return true;}));assertEquals(1,seen.size());
 }
 @Test public void fixedNativeTransportIsFallback()throws Exception{
  assertEquals(NativeAccount.IDENTITY_API,NativeTransport.select(true,(origin,account)->origin.equals(NativeAccount.IDENTITY_API)));
  assertEquals(NativeAccount.SYNC_API,NativeTransport.select(false,(origin,account)->origin.equals(NativeAccount.SYNC_API)));
 }
 @Test(expected=IOException.class) public void neitherOriginDoesNotPretendToBeLoggedIn()throws Exception{NativeTransport.select(true,(origin,account)->false);}
}
