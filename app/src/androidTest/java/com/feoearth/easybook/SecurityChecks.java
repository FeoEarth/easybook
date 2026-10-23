package com.feoearth.easybook;
import android.content.Context;
import android.database.Cursor;
import android.content.ContentValues;
import java.security.KeyStore;
import org.json.*;

final class SecurityChecks {
    static void require(boolean b,String s){DataLayerChecks.require(b,s);}
    static void run(Context context)throws Exception{
        require((context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0,"release APK must not be debuggable");
        require((context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)==0,"system backup disabled");
        for(String resource:new String[]{"backup_rules","data_extraction_rules"}){int id=context.getResources().getIdentifier(resource,"xml",context.getPackageName());require(id!=0,"backup exclusion resource exists");android.content.res.XmlResourceParser parser=context.getResources().getXml(id);int exclusions=0;while(parser.next()!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT)if(parser.getEventType()==org.xmlpull.v1.XmlPullParser.START_TAG&&parser.getName().equals("exclude"))exclusions++;parser.close();require(exclusions>=5,"explicit data backup exclusions");}
        String name="security-tests-"+NoteRepository.id()+".db";NoteRepository db=new NoteRepository(context,name);CredentialVault v=db.vault;
        try{
            String key=NoteRepository.newKey(),ref=NoteRepository.hash(key);
            KeyStore keyStore=KeyStore.getInstance("AndroidKeyStore");keyStore.load(null);String alias=v.currentAlias();javax.crypto.SecretKey material=(javax.crypto.SecretKey)keyStore.getKey(alias,null);require(material.getEncoded()==null,"Keystore key is non-exportable");android.security.keystore.KeyInfo info=(android.security.keystore.KeyInfo)javax.crypto.SecretKeyFactory.getInstance("AES","AndroidKeyStore").getKeySpec(material,android.security.keystore.KeyInfo.class);require(info.getKeySize()==256,"Keystore AES key size");String a=v.seal(key,"test"),b=v.seal(key,"test");require(!a.equals(b)&&!a.contains(key),"randomized credential encryption");require(v.open(a,"test").equals(key),"AES-GCM roundtrip");
            try{v.open(a,"wrong-purpose");throw new AssertionError("AAD ignored");}catch(javax.crypto.AEADBadTagException expected){}
            String[] p=a.split(":");byte[] bytes=android.util.Base64.decode(p[3],android.util.Base64.NO_WRAP);bytes[0]^=1;p[3]=android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP);try{v.open(String.join(":",p),"test");throw new AssertionError("tampering accepted");}catch(javax.crypto.AEADBadTagException expected){}
            // Exact stage-one database schema and plaintext credential/archive fixture.
            JSONObject n=DataLayerChecks.note(NoteRepository.id(),"升级后离线笔记");DataLayerChecks.save(db,key,n,"");ContentValues raw=new ContentValues();raw.put("credential",key);db.getWritableDatabase().update("spaces",raw,"key=?",new String[]{ref});db.setSetting("active",ref);
            JSONObject source=DataLayerChecks.source(key,new JSONArray().put(n),new JSONArray());String digest=NoteRepository.hash(source.toString());db.getWritableDatabase().execSQL("INSERT INTO migration_journal VALUES(?,?,?,?,?)",new Object[]{digest,source.toString(),"verified",new JSONObject().put("state","verified").toString(),1});
            db.secureCredentials();require(db.active().equals(key),"migrated credential identity verified");try(Cursor c=db.getReadableDatabase().rawQuery("SELECT credential FROM spaces WHERE key=?",new String[]{ref})){c.moveToFirst();require(CredentialVault.sealed(c.getString(0))&&!c.getString(0).contains(key),"no plaintext credential in SQLite");}
            try(Cursor c=db.getReadableDatabase().rawQuery("SELECT source FROM migration_journal WHERE digest=?",new String[]{digest})){c.moveToFirst();require(CredentialVault.sealed(c.getString(0))&&!c.getString(0).contains(key),"key-bearing legacy archive encrypted");}
            for(String suffix:new String[]{"","-wal"}){java.io.File file=new java.io.File(context.getDatabasePath(name).toString()+suffix);if(file.exists())require(!new String(java.nio.file.Files.readAllBytes(file.toPath()),java.nio.charset.StandardCharsets.ISO_8859_1).contains(key),"logical database/WAL contains no plaintext credential after compaction");}
            db.secureCredentials();db.rollbackSecurity();require(db.active().equals(key)&&db.rows(db.activeSpace(),"note").length()==1,"repeat and encrypted rollback preserve notes");require(!db.snapshot(db.activeSpace()).toString().contains(key),"sanitized snapshot");
            // Simulated missing Keystore alias: must retain data and block sync credentials.
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);store.deleteEntry(v.currentAlias());require(!db.securityStatus().getBoolean("paired"),"missing key requires re-pair");require(db.rows(db.activeSpace(),"note").length()==1,"missing key retains offline data");
            JSONObject edit=db.row(db.activeSpace(),"note",n.getString("id"));String base=edit.getString("mutation");edit.put("document",DataLayerChecks.document("密钥失效仍可离线编辑")).put("mutation",NoteRepository.id());DataLayerChecks.save(db,db.activeSpace(),edit,base);try{db.credential(db.activeSpace());throw new AssertionError("missing key silently recreated");}catch(CredentialVault.KeyUnavailable expected){}
            db.pair(key,true);require(db.credential(db.activeSpace()).equals(key)&&DataLayerChecks.findBody(db.rows(db.activeSpace(),"note"),"密钥失效仍可离线编辑")!=null,"same-key native re-pair preserves workspace");
            // Invalid plaintext migration is atomic and retryable.
            String bad=NoteRepository.newKey();raw.put("credential",bad);db.getWritableDatabase().update("spaces",raw,"key=?",new String[]{ref});try{db.secureCredentials();throw new AssertionError("identity mismatch accepted");}catch(SecurityException expected){}try(Cursor c=db.getReadableDatabase().rawQuery("SELECT credential FROM spaces WHERE key=?",new String[]{ref})){c.moveToFirst();require(c.getString(0).equals(bad),"failed migration leaves original for retry");}raw.put("credential",key);db.getWritableDatabase().update("spaces",raw,"key=?",new String[]{ref});db.secureCredentials();require(db.active().equals(key),"migration retry succeeds");
        }finally{db.close();context.deleteDatabase(name);}
    }
}

