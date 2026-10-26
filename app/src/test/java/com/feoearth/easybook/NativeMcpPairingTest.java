package com.feoearth.easybook;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public class NativeMcpPairingTest {
    @Test public void credentialOnlyGoesToWorkspaceAttestation()throws Exception{
        String challenge="AbC_def-012345678901234567890123456789012";int[] calls={0};
        NativeMcpPairing.pair(challenge,"native-only-secret",(complete,body,credential)->{
            assertEquals(challenge,body.getString("challenge"));
            if(calls[0]++==0){assertFalse(complete);assertEquals("native-only-secret",credential);assertFalse(body.has("assertion"));return new JSONObject().put("assertion","signed-proof");}
            assertTrue(complete);assertNull(credential);assertEquals("signed-proof",body.getString("assertion"));assertEquals(2,body.length());return new JSONObject().put("paired",true);
        });assertEquals(2,calls[0]);
    }
    @Test public void malformedCodeNeverMakesRequest()throws Exception{
        try{NativeMcpPairing.pair("bad","secret",(a,b,c)->{fail("Unexpected network request");return null;});fail("Should reject");}catch(IllegalArgumentException expected){}
    }
    @Test public void invalidAttestationCannotCompletePairing()throws Exception{
        int[] calls={0};try{NativeMcpPairing.pair("A".repeat(43),"secret",(a,b,c)->{calls[0]++;assertFalse(a);return new JSONObject();});fail("Should reject");}catch(java.io.IOException expected){}assertEquals(1,calls[0]);
    }
    @Test public void completionMustConfirmPairing()throws Exception{
        try{NativeMcpPairing.pair("A".repeat(43),"secret",(a,b,c)->a?new JSONObject().put("paired",false):new JSONObject().put("assertion","proof"));fail("Should reject");}catch(java.io.IOException expected){}
    }
}
