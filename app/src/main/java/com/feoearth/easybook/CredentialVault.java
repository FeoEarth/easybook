package com.feoearth.easybook;

import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Versioned, purpose-bound AES-256-GCM envelopes. Keystore material never leaves provider.
 * No silent fallback or key recreation when an existing alias becomes unavailable. */
public final class CredentialVault implements DataProtection {
    private final AtomicFile pointer;
    CredentialVault(Context context){pointer=new AtomicFile(new File(context.getNoBackupFilesDir(),"credential-vault-alias"));}
    private KeyStore store()throws Exception{KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);return s;}
    synchronized String currentAlias()throws Exception{
        if(pointer.getBaseFile().exists()){try(FileInputStream in=pointer.openRead()){byte[] b=new byte[128];int n=in.read(b);String a=new String(b,0,Math.max(0,n),StandardCharsets.UTF_8);if(!a.matches("easybook.credentials.[a-f0-9-]{36}"))throw new IOException("Invalid vault metadata");return a;}}
        return rotate();
    }
    /** Only called for a new install, or after explicit native re-pair confirmation. */
    synchronized String rotate()throws Exception{
        String alias="easybook.credentials."+UUID.randomUUID();KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());g.generateKey();
        FileOutputStream out=null;try{out=pointer.startWrite();out.write(alias.getBytes(StandardCharsets.UTF_8));pointer.finishWrite(out);}catch(Exception e){if(out!=null)pointer.failWrite(out);throw e;}return alias;
    }
    static boolean sealed(String s){return s!=null&&s.startsWith("ev2:");}
    String seal(String value,String purpose)throws Exception{
        String alias=currentAlias();java.security.Key key=store().getKey(alias,null);if(key==null)throw new KeyUnavailable();
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key);c.updateAAD(("easybook-v2:"+purpose).getBytes(StandardCharsets.UTF_8));
        return "ev2:"+alias+":"+Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    }
    String open(String envelope,String purpose)throws Exception{
        if(!sealed(envelope))throw new SecurityException("Unsealed credential");String[] p=envelope.split(":",-1);if(p.length!=4)throw new SecurityException("Invalid envelope");
        java.security.Key key=store().getKey(p[1],null);if(key==null)throw new KeyUnavailable();
        return decrypt(p,key,purpose);
    }
    private String decrypt(String[] p,java.security.Key key,String purpose)throws Exception{
        byte[] iv=Base64.decode(p[2],Base64.NO_WRAP),data=Base64.decode(p[3],Base64.NO_WRAP);if(iv.length!=12||data.length<16)throw new SecurityException("Invalid GCM envelope");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));c.updateAAD(("easybook-v2:"+purpose).getBytes(StandardCharsets.UTF_8));return new String(c.doFinal(data),StandardCharsets.UTF_8);
    }
    public String wrapCredential(String value)throws Exception{return seal(value,"credential:"+NoteRepository.hash(value));}
    public String unwrapCredential(String value)throws Exception{throw new SecurityException("Use purpose-bound native credential lookup");}
    public String encodeLocal(String value){return value;}
    public String decodeLocal(String value){return value;}
    public String encodeTransport(String value){return value;}
    public String decodeTransport(String value){return value;}
    static final class KeyUnavailable extends Exception {KeyUnavailable(){super("Credential unavailable; re-pair required");}}
}
