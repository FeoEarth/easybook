package com.feoearth.easybook;

/** Stage one is explicitly plaintext. Future implementations can wrap keys in Keystore
 * and encrypt local values/wire envelopes without changing repository callers. */
public interface DataProtection {
    String wrapCredential(String credential) throws Exception;
    String unwrapCredential(String stored) throws Exception;
    String encodeLocal(String plaintext) throws Exception;
    String decodeLocal(String stored) throws Exception;
    String encodeTransport(String plaintext) throws Exception;
    String decodeTransport(String stored) throws Exception;
    final class Plaintext implements DataProtection {
        public String wrapCredential(String s){return s;}
        public String unwrapCredential(String s){return s;}
        public String encodeLocal(String s){return s;}
        public String decodeLocal(String s){return s;}
        public String encodeTransport(String s){return s;}
        public String decodeTransport(String s){return s;}
    }
}
