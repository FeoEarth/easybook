package com.feoearth.easybook;
import org.junit.Test;
import static org.junit.Assert.*;
public class NativeAccountErrorsTest {
 @Test public void distinguishesCancellationMissingAndUnsupported(){
  String cancel=NativeAccount.credentialMessage("android.credentials.GetCredentialException.TYPE_USER_CANCELED",false);
  String missing=NativeAccount.credentialMessage("android.credentials.GetCredentialException.TYPE_NO_CREDENTIAL",false);
  String unsupported=NativeAccount.credentialMessage("android.credentials.GetCredentialException.TYPE_UNSUPPORTED",false);
  assertTrue(cancel.contains("已取消"));assertTrue(missing.contains("没有可用"));assertTrue(unsupported.contains("未提供"));
  assertNotEquals(cancel,missing);assertNotEquals(missing,unsupported);
 }
 @Test public void duplicateAndInterruptedHaveRecoveryGuidance(){
  assertTrue(NativeAccount.credentialMessage("androidx.credentials.TYPE_INVALID_STATE_ERROR",true).contains("已存在"));
  assertTrue(NativeAccount.credentialMessage("android.credentials.CreateCredentialException.TYPE_INTERRUPTED",true).contains("中断"));
 }
}
