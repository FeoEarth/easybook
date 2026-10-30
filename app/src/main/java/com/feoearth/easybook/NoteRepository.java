package com.feoearth.easybook;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.text.Normalizer;
import java.util.*;

/** Application-scoped SQLite source of truth. Every mutation is transactional.
 * JSON is a versioned row payload, not a WebView snapshot; omissions never delete rows. */
public final class NoteRepository extends SQLiteOpenHelper {
    private static NoteRepository instance;
    public static synchronized NoteRepository get(Context c){if(instance==null)instance=new NoteRepository(c.getApplicationContext());return instance;}
    private final DataProtection protection;
    final AttachmentStore attachments;
    final CredentialVault vault;
    NoteRepository(Context c){this(c,"easybook-native.db");}
    NoteRepository(Context c,String name){super(c,name,null,3);DocumentModel.initialize(c);vault=new CredentialVault(c);protection=vault;attachments=new AttachmentStore(c,this);setWriteAheadLoggingEnabled(true);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE records(space TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,rev INTEGER NOT NULL,PRIMARY KEY(space,kind,id))");
        db.execSQL("CREATE TABLE spaces(key TEXT PRIMARY KEY,credential TEXT NOT NULL)");
        db.execSQL("CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT NOT NULL)");
        identitySchema(db);
        db.execSQL("CREATE TABLE migration_journal(digest TEXT PRIMARY KEY,source TEXT NOT NULL,state TEXT NOT NULL,report TEXT NOT NULL,created INTEGER NOT NULL)");
    }
    private static void identitySchema(SQLiteDatabase db){
        db.execSQL("CREATE TABLE IF NOT EXISTS workspace_identity(local_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('personal','shared')),role TEXT NOT NULL DEFAULT 'manager' CHECK(role IN ('reader','editor','manager')))");
        db.execSQL("CREATE TABLE IF NOT EXISTS workspace_credentials(key_hash TEXT PRIMARY KEY,local_id TEXT NOT NULL)");
        db.execSQL("CREATE TABLE IF NOT EXISTS workspace_catalog(workspace_id TEXT PRIMARY KEY,name TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('personal','shared')),role TEXT NOT NULL CHECK(role IN ('reader','editor','manager')))");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){
        if(oldVersion==1){identitySchema(db);oldVersion=newVersion>=3?3:2;}
        if(oldVersion==2&&newVersion>=3){db.execSQL("ALTER TABLE workspace_identity ADD COLUMN role TEXT NOT NULL DEFAULT 'manager' CHECK(role IN ('reader','editor','manager'))");identitySchema(db);oldVersion=3;}
        if(oldVersion!=newVersion)throw new IllegalStateException("Unsupported database upgrade");
    }
    public static String newKey(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
    static String hash(String s)throws Exception{byte[] b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte v:b)out.append(String.format(Locale.ROOT,"%02x",v&255));return out.toString();}
    static void key(String k){if(k==null||!k.matches("(?:space:)?[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid workspace key");}
    static String id(){return UUID.randomUUID().toString();}
    static JSONObject copy(JSONObject n)throws JSONException{return new JSONObject(n.toString());}
    static void validNote(JSONObject n)throws Exception{
        if(n.has("body"))throw new IllegalArgumentException("HTML body unsupported");DocumentModel.validate(n.getJSONObject("document"));
        for(String field:new String[]{"id","title","mutation"})if(!(n.get(field) instanceof String))throw new IllegalArgumentException("Invalid note field type");
        if(!n.getString("id").matches("[a-f0-9-]{36}")||n.getString("title").length()>200||n.optString("icon","📄").length()>16)throw new IllegalArgumentException("Invalid note");
        if(n.optDouble("version",0)!=n.optLong("version",0)||n.optLong("version",0)<0||!n.optString("mutation").matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid note revision");
        if(n.has("purged")&&(!(n.get("purged") instanceof Number)||n.getDouble("purged")!=n.getInt("purged")||(n.getInt("purged")!=0&&n.getInt("purged")!=1)||n.optInt("purged")==1&&n.optInt("deleted")!=1))throw new IllegalArgumentException("Invalid purge");
        String f=n.optString("folder_id","");if(!f.isEmpty()&&!f.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid folder assignment");
        for(String field:new String[]{"favorite","pinned","deleted"})if(!(n.get(field) instanceof Number)||(n.getDouble(field)!=0&&n.getDouble(field)!=1))throw new IllegalArgumentException("Invalid flag");
    }
    static void validFolder(JSONObject f)throws Exception{if(!(f.get("id") instanceof String)||!(f.get("name") instanceof String))throw new IllegalArgumentException("Invalid folder field type");if(!f.getString("id").matches("[a-f0-9-]{36}")||f.getString("name").trim().isEmpty()||f.getString("name").length()>60)throw new IllegalArgumentException("Invalid folder");}
    public synchronized String setting(String name,String fallback){try(Cursor c=getReadableDatabase().rawQuery("SELECT value FROM settings WHERE name=?",new String[]{name})){return c.moveToFirst()?c.getString(0):fallback;}}
    public synchronized void setSetting(String name,String value){ContentValues v=new ContentValues();v.put("name",name);v.put("value",value);if(getWritableDatabase().insertWithOnConflict("settings",null,v,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new android.database.sqlite.SQLiteException("Setting write failed");}
    static String spaceId(String k){if(k.startsWith("space:"))return k.substring(6);try{return hash(k);}catch(Exception e){throw new IllegalStateException("SHA-256 unavailable",e);}}
    private String localSpaceId(String value){String ref=spaceId(value);if(value.startsWith("space:"))return ref;try(Cursor c=getReadableDatabase().rawQuery("SELECT local_id FROM workspace_credentials WHERE key_hash=?",new String[]{ref})){return c.moveToFirst()?c.getString(0):ref;}}
    private void rememberSpace(String k){if(k.startsWith("space:"))return;try{ContentValues v=new ContentValues();v.put("key",localSpaceId(k));v.put("credential",vault.seal(k,"credential:"+localSpaceId(k)));getWritableDatabase().insertWithOnConflict("spaces",null,v,SQLiteDatabase.CONFLICT_IGNORE);}catch(Exception e){throw new IllegalStateException("Credential persistence failed",e);}}
    public synchronized String activeSpace(){String ref=setting("active","");if(ref.isEmpty()){activate(newKey());ref=setting("active","");}return "space:"+ref;}
    public synchronized String credential(String space)throws Exception{String ref=localSpaceId(space);try(Cursor c=getReadableDatabase().rawQuery("SELECT key,credential FROM spaces WHERE key=?",new String[]{ref})){if(!c.moveToFirst())throw new CredentialVault.KeyUnavailable();String k=vault.open(c.getString(1),"credential:"+ref);if(!hash(k).equals(ref)){try(Cursor proof=getReadableDatabase().rawQuery("SELECT local_id FROM workspace_credentials WHERE key_hash=? AND local_id=?",new String[]{hash(k),ref})){if(!proof.moveToFirst())throw new SecurityException("Credential identity mismatch");}}return k;}}
    public synchronized String active(){try{return credential(activeSpace());}catch(Exception e){throw new IllegalStateException("Credential unavailable",e);}}
    public synchronized void activate(String k){if(k==null||!k.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid credential");rememberSpace(k);setSetting("active",localSpaceId(k));}
    public synchronized void pair(String k,boolean rotate)throws Exception{if(k==null||!k.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid credential");if(rotate)vault.rotate();String ref=localSpaceId(k),encrypted=vault.seal(k,"credential:"+ref);if(!vault.open(encrypted,"credential:"+ref).equals(k))throw new SecurityException("Verification failed");SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{ContentValues v=new ContentValues();v.put("key",ref);v.put("credential",encrypted);db.insertWithOnConflict("spaces",null,v,SQLiteDatabase.CONFLICT_REPLACE);setSetting("active",ref);db.setTransactionSuccessful();}finally{db.endTransaction();}}
    /** Bind a server-verified identity without moving any note or attachment file.
     * Only native HTTPS lookup may supply identity; JS never supplies a credential. */
    public synchronized void bindWorkspaceIdentity(String space,JSONObject identity)throws Exception{
        String ref=localSpaceId(space),credential=credential("space:"+ref);String server=identity.getString("id");
        if(!server.matches("[a-f0-9]{64}")||!Arrays.asList("personal","shared").contains(identity.optString("mode"))||identity.optString("name").trim().isEmpty()||identity.optString("name").length()>60)throw new SecurityException("Invalid workspace identity");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            try(Cursor c=db.rawQuery("SELECT local_id,workspace_id FROM workspace_identity WHERE local_id=? OR workspace_id=?",new String[]{ref,server})){while(c.moveToNext())if(!ref.equals(c.getString(0))||!server.equals(c.getString(1)))throw new SecurityException("Separate local workspace data requires explicit reconnection");}
            String role=identity.optString("role","manager");if(!Arrays.asList("reader","editor","manager").contains(role))throw new SecurityException("Invalid workspace role");
            ContentValues record=new ContentValues();record.put("local_id",ref);record.put("workspace_id",server);record.put("name",identity.getString("name"));record.put("mode",identity.getString("mode"));record.put("role",role);if(db.insertWithOnConflict("workspace_identity",null,record,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new SQLiteException("Identity persistence failed");
            ContentValues binding=new ContentValues();binding.put("key_hash",hash(credential));binding.put("local_id",ref);if(db.insertWithOnConflict("workspace_credentials",null,binding,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new SQLiteException("Credential binding failed");
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    public synchronized void pairWorkspace(String credential,JSONObject identity,boolean rotate)throws Exception{
        if(identity==null){pair(credential,rotate);return;}
        if(credential==null||!credential.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid credential");String server=identity.getString("id"),ref=hash(credential);
        if(!server.matches("[a-f0-9]{64}")||!identity.optString("mode").equals("personal"))throw new SecurityException("Invalid key workspace");
        SQLiteDatabase db=getWritableDatabase();try(Cursor c=db.rawQuery("SELECT local_id FROM workspace_identity WHERE workspace_id=?",new String[]{server})){if(c.moveToFirst())ref=c.getString(0);}
        String candidate=localSpaceId(credential);
        if(!candidate.equals(ref)){try(Cursor c=db.rawQuery("SELECT 1 FROM records WHERE space=? LIMIT 1",new String[]{candidate})){if(c.moveToFirst())throw new SecurityException("Separate offline data must be exported before reconnecting");}}
        if(rotate)vault.rotate();String encrypted=vault.seal(credential,"credential:"+ref);if(!credential.equals(vault.open(encrypted,"credential:"+ref)))throw new SecurityException("Credential verification failed");
        db.beginTransaction();try{
            // A known key cannot be rebound to another local workspace.
            try(Cursor c=db.rawQuery("SELECT local_id FROM workspace_credentials WHERE key_hash=?",new String[]{hash(credential)})){if(c.moveToFirst()&&!ref.equals(c.getString(0)))throw new SecurityException("Credential identity changed");}
            ContentValues entry=new ContentValues();entry.put("key",ref);entry.put("credential",encrypted);if(db.insertWithOnConflict("spaces",null,entry,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new SQLiteException("Credential persistence failed");
            ContentValues binding=new ContentValues();binding.put("key_hash",hash(credential));binding.put("local_id",ref);if(db.insertWithOnConflict("workspace_credentials",null,binding,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new SQLiteException("Credential binding failed");
            bindWorkspaceIdentity("space:"+ref,identity);setSetting("active",ref);setSetting("account-workspace:space:"+ref,"");setSetting("account-placeholder:space:"+ref,"");db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    synchronized void activateAccountWorkspace(JSONObject identity)throws Exception{
        String id=identity.getString("id"),ref=null;if(!id.matches("[a-f0-9]{64}")||!Arrays.asList("personal","shared").contains(identity.optString("mode")))throw new SecurityException("Invalid workspace");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            try(Cursor c=db.rawQuery("SELECT local_id FROM workspace_identity WHERE workspace_id=?",new String[]{id})){if(c.moveToFirst())ref=c.getString(0);}
            if(ref==null){String placeholder=newKey();pairWorkspace(placeholder,new JSONObject(identity.toString()).put("mode","personal"),false);ref=setting("active","");setSetting("account-placeholder:space:"+ref,"1");}else setSetting("active",ref);
            String role=identity.optString("role","manager");if(!Arrays.asList("reader","editor","manager").contains(role))throw new SecurityException("Invalid workspace role");
            ContentValues metadata=new ContentValues();metadata.put("mode",identity.getString("mode"));metadata.put("name",identity.getString("name"));metadata.put("role",role);db.update("workspace_identity",metadata,"local_id=?",new String[]{ref});
            setSetting("account-workspace:space:"+ref,id);db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    synchronized JSONObject cachedActiveWorkspace()throws Exception{
        String ref=spaceId(activeSpace());
        try(Cursor c=getReadableDatabase().rawQuery("SELECT workspace_id,name,mode,role FROM workspace_identity WHERE local_id=?",new String[]{ref})){
            return c.moveToFirst()?new JSONObject().put("id",c.getString(0)).put("name",c.getString(1)).put("mode",c.getString(2)).put("role",c.getString(3)):null;
        }
    }
    synchronized JSONArray cachedWorkspaces()throws Exception{
        LinkedHashMap<String,JSONObject> rows=new LinkedHashMap<>();
        try(Cursor c=getReadableDatabase().rawQuery("SELECT workspace_id,name,mode,role FROM workspace_catalog ORDER BY name COLLATE NOCASE,workspace_id",null)){
            while(c.moveToNext())rows.put(c.getString(0),new JSONObject().put("id",c.getString(0)).put("name",c.getString(1)).put("mode",c.getString(2)).put("role",c.getString(3)));
        }
        try(Cursor c=getReadableDatabase().rawQuery("SELECT workspace_id,name,mode,role FROM workspace_identity ORDER BY name COLLATE NOCASE,workspace_id",null)){
            while(c.moveToNext())rows.put(c.getString(0),new JSONObject().put("id",c.getString(0)).put("name",c.getString(1)).put("mode",c.getString(2)).put("role",c.getString(3)));
        }
        JSONArray result=new JSONArray();for(JSONObject row:rows.values())result.put(row);
        return result;
    }
    synchronized void cacheWorkspaces(JSONArray workspaces)throws Exception{
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(int i=0;i<workspaces.length();i++){JSONObject w=workspaces.getJSONObject(i);String id=w.getString("id"),name=w.getString("name"),mode=w.getString("mode"),role=w.optString("role","manager");if(!id.matches("[a-f0-9]{64}")||name.trim().isEmpty()||name.length()>60||!Arrays.asList("personal","shared").contains(mode)||!Arrays.asList("reader","editor","manager").contains(role))throw new SecurityException("Invalid workspace catalog");ContentValues row=new ContentValues();row.put("workspace_id",id);row.put("name",name);row.put("mode",mode);row.put("role",role);db.insertWithOnConflict("workspace_catalog",null,row,SQLiteDatabase.CONFLICT_REPLACE);}db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    synchronized boolean activateCachedWorkspace(String workspaceId)throws Exception{
        if(workspaceId==null||!workspaceId.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid workspace");
        try(Cursor c=getReadableDatabase().rawQuery("SELECT local_id FROM workspace_identity WHERE workspace_id=?",new String[]{workspaceId})){
            if(c.moveToFirst()){setSetting("active",c.getString(0));return true;}
        }
        JSONObject cached=null;try(Cursor c=getReadableDatabase().rawQuery("SELECT name,mode,role FROM workspace_catalog WHERE workspace_id=?",new String[]{workspaceId})){
            if(c.moveToFirst())cached=new JSONObject().put("id",workspaceId).put("name",c.getString(0)).put("mode",c.getString(1)).put("role",c.getString(2));
        }
        if(cached==null)return false;activateAccountWorkspace(cached);return true;
    }
    /** Resumable, atomic upgrade. Encrypted checkpoint permits native-only rollback;
     * no record payload or revision is modified. Original keys never enter reports. */
    public synchronized JSONObject secureCredentials()throws Exception{
        SQLiteDatabase db=getWritableDatabase();db.execSQL("CREATE TABLE IF NOT EXISTS security_checkpoints(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)");
        JSONObject before=new JSONObject();JSONArray credentials=new JSONArray(),sources=new JSONArray();
        try(Cursor c=db.rawQuery("SELECT key,credential FROM spaces",null)){while(c.moveToNext())if(!CredentialVault.sealed(c.getString(1)))credentials.put(new JSONObject().put("ref",c.getString(0)).put("value",c.getString(1)));}
        try(Cursor c=db.rawQuery("SELECT digest,source FROM migration_journal",null)){while(c.moveToNext())if(!CredentialVault.sealed(c.getString(1)))sources.put(new JSONObject().put("digest",c.getString(0)).put("value",c.getString(1)));}
        if(credentials.length()==0&&sources.length()==0){ensureSecurityCheckpoint();setSetting("securityVersion","2");return securityStatus();}
        before.put("credentials",credentials).put("sources",sources);String checkpoint=vault.seal(before.toString(),"checkpoint");if(!vault.open(checkpoint,"checkpoint").equals(before.toString()))throw new SecurityException("Checkpoint verification failed");
        db.beginTransaction();try{for(int i=0;i<credentials.length();i++){JSONObject row=credentials.getJSONObject(i);String k=row.getString("value"),ref=row.getString("ref");if(!k.matches("[a-f0-9]{64}")||!hash(k).equals(ref))throw new SecurityException("Legacy credential identity mismatch");String encrypted=vault.seal(k,"credential:"+ref);if(!vault.open(encrypted,"credential:"+ref).equals(k))throw new SecurityException("Credential verification failed");db.execSQL("UPDATE spaces SET credential=? WHERE key=?",new Object[]{encrypted,ref});}
            for(int i=0;i<sources.length();i++){JSONObject row=sources.getJSONObject(i);String digest=row.getString("digest"),raw=row.getString("value"),encrypted=vault.seal(raw,"migration:"+digest);if(!vault.open(encrypted,"migration:"+digest).equals(raw))throw new SecurityException("Archive verification failed");db.execSQL("UPDATE migration_journal SET source=? WHERE digest=?",new Object[]{encrypted,digest});}
            db.execSQL("INSERT OR REPLACE INTO security_checkpoints(id,payload) VALUES(1,?)",new Object[]{checkpoint});setSetting("securityVersion","2");setSetting("legacyMode","false");db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        scrubDeletedPages();return securityStatus();
    }
    private void ensureSecurityCheckpoint()throws Exception{SQLiteDatabase db=getWritableDatabase();try(Cursor c=db.rawQuery("SELECT id FROM security_checkpoints WHERE id=1",null)){if(c.moveToFirst())return;}JSONArray entries=new JSONArray();try(Cursor c=db.rawQuery("SELECT key,credential FROM spaces",null)){while(c.moveToNext()){try{entries.put(new JSONObject().put("ref",c.getString(0)).put("value",vault.open(c.getString(1),"credential:"+c.getString(0))));}catch(Exception unavailable){return;}}}if(entries.length()==0)return;JSONObject before=new JSONObject().put("credentials",entries).put("sources",new JSONArray());String payload=vault.seal(before.toString(),"checkpoint");if(!vault.open(payload,"checkpoint").equals(before.toString()))throw new SecurityException();db.execSQL("INSERT OR IGNORE INTO security_checkpoints(id,payload) VALUES(1,?)",new Object[]{payload});}
    public synchronized void scrubDeletedPages(){SQLiteDatabase db=getWritableDatabase();try(Cursor c=db.rawQuery("PRAGMA secure_delete=ON",null)){c.moveToFirst();}try(Cursor c=db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)",null)){c.moveToFirst();}db.execSQL("VACUUM");try(Cursor c=db.rawQuery("PRAGMA wal_checkpoint(TRUNCATE)",null)){c.moveToFirst();}}
    public synchronized JSONObject securityStatus()throws Exception{boolean paired=true;try{String ref=setting("active","");if(ref.isEmpty())throw new CredentialVault.KeyUnavailable();credential("space:"+ref);}catch(Exception e){paired=false;}return new JSONObject().put("version",2).put("paired",paired).put("credentialEncryption","AES-256-GCM/AndroidKeyStore").put("e2ee",false);}
    public synchronized void rollbackSecurity()throws Exception{
        // Restore previous credential content only after authenticating the checkpoint;
        // re-wrap it under the current Keystore key. Never downgrade to plaintext.
        JSONObject backup;try(Cursor c=getReadableDatabase().rawQuery("SELECT payload FROM security_checkpoints WHERE id=1",null)){if(!c.moveToFirst())throw new IllegalStateException("No checkpoint");backup=new JSONObject(vault.open(c.getString(0),"checkpoint"));}
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{JSONArray entries=backup.getJSONArray("credentials");for(int i=0;i<entries.length();i++){JSONObject row=entries.getJSONObject(i);String ref=row.getString("ref"),k=row.getString("value");if(!hash(k).equals(ref))throw new SecurityException();try(Cursor identity=db.rawQuery("SELECT 1 FROM workspace_identity WHERE local_id=?",new String[]{ref})){if(identity.moveToFirst())continue;}db.execSQL("UPDATE spaces SET credential=? WHERE key=?",new Object[]{vault.seal(k,"credential:"+ref),ref});}setSetting("securityRollback","verified");db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    private static String recordKind(String kind){return kind.equals("note")?"note_json_v1":kind;}
    public synchronized JSONArray rows(String space,String kind)throws Exception{key(space);JSONArray a=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT payload,rev FROM records WHERE space=? AND kind=? ORDER BY id",new String[]{localSpaceId(space),recordKind(kind)})){while(c.moveToNext()){JSONObject value=new JSONObject(protection.decodeLocal(c.getString(0))).put("_rev",c.getLong(1));if(kind.equals("note"))validNote(value);a.put(value);}}return a;}
    public synchronized JSONObject row(String space,String kind,String id)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT payload,rev FROM records WHERE space=? AND kind=? AND id=?",new String[]{localSpaceId(space),recordKind(kind),id})){return c.moveToFirst()?new JSONObject(protection.decodeLocal(c.getString(0))).put("_rev",c.getLong(1)):null;}}
    private void put(String space,String kind,JSONObject value)throws Exception{rememberSpace(space);JSONObject n=copy(value);JSONObject old=row(space,kind,n.getString("id"));long rev=old==null?1:old.getLong("_rev")+1;n.remove("_rev");ContentValues v=new ContentValues();v.put("space",localSpaceId(space));v.put("kind",recordKind(kind));v.put("id",n.getString("id"));v.put("payload",protection.encodeLocal(n.toString()));v.put("rev",rev);getWritableDatabase().insertWithOnConflict("records",null,v,SQLiteDatabase.CONFLICT_REPLACE);}
    public synchronized void saveAttachment(String key,JSONObject meta)throws Exception{AttachmentStore.validId(meta.getString("id"));put(key,"attachment",meta);}
    public synchronized JSONObject snapshot(String k)throws Exception{return new JSONObject().put("key","space:"+localSpaceId(k)).put("notes",rows(k,"note")).put("folders",rows(k,"folder")).put("native",true).put("management",management(k));}
    public synchronized JSONArray migrationReports()throws Exception{JSONArray reports=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT report FROM migration_journal ORDER BY created",null)){while(c.moveToNext())reports.put(new JSONObject(c.getString(0)));}return reports;}
    /** Save only changed records, with an optimistic base mutation. A stale UI can
     * never overwrite an independently changed database record. */
    public synchronized JSONObject commit(String k,JSONObject changes)throws Exception{key(k);SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{JSONObject mappings=new JSONObject();JSONArray placementOps=changes.optJSONArray("placements");if(placementOps!=null)queuePlacements(k,placementOps);JSONArray savedNotes=new JSONArray(),savedFolders=new JSONArray();JSONArray fs=changes.optJSONArray("folders");if(fs!=null)for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);validFolder(f);JSONObject old=row(k,"folder",f.getString("id"));if(old==null||old.optInt("deleted")==0&&(f.optInt("deleted")==1||f.optLong("updated")>old.optLong("updated")))put(k,"folder",copy(f).put("dirty",true));savedFolders.put(row(k,"folder",f.getString("id")));}
        JSONArray ns=changes.optJSONArray("notes");if(ns!=null)for(int i=0;i<ns.length();i++){JSONObject change=ns.getJSONObject(i),n=copy(change.getJSONObject("note"));validNote(n);String original=n.getString("id"),base=change.optString("baseMutation","");JSONObject old=row(k,"note",original);if(old!=null&&old.optInt("purged")==1){savedNotes.put(old);continue;}String folder=n.optString("folder_id","");if(!folder.isEmpty()&&row(k,"folder",folder)==null&&(old==null||!folder.equals(old.optString("folder_id"))))throw new IllegalArgumentException("Folder missing");
            if(n.optInt("purged")==1){clearPending(k,original);n.put("title","").put("document",new JSONObject("{\"schemaVersion\":1,\"doc\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}}")).put("folder_id","").put("favorite",0).put("pinned",0);}
            if(old!=null&&n.optInt("purged")!=1&&!old.optString("mutation").equals(base)&&!old.optString("mutation").equals(n.optString("mutation"))){n.put("id",id()).put("version",0).put("mutation",id()).put("title",n.getString("title").substring(0,Math.min(175,n.getString("title").length()))+" · 冲突副本");mappings.put(original,n.getString("id"));savedNotes.put(old);}
            else if(old!=null)n.put("version",old.optLong("version",0));
            n.put("dirty",true);put(k,"note",n);savedNotes.put(row(k,"note",n.getString("id")));
        }db.setTransactionSuccessful();return new JSONObject().put("notes",savedNotes).put("folders",savedFolders).put("mappings",mappings).put("management",management(k));
    }finally{db.endTransaction();}}
    public synchronized JSONObject management(String k)throws Exception{JSONObject raw=row(k,"management","layout"),m=FolderPlacement.clean(raw);if(raw==null||!m.toString().equals(raw.toString()))put(k,"management",m);return m;}
    private void queuePlacements(String k,JSONArray ops)throws Exception{put(k,"management",FolderPlacement.append(management(k),ops));}
    public synchronized void mergeManagement(String k,JSONObject remote,String accepted,String rejected)throws Exception{mergeManagement(k,remote,accepted,rejected,"conflict");}
    public synchronized void mergeManagement(String k,JSONObject remote,String accepted,String rejected,String reason)throws Exception{put(k,"management",FolderPlacement.result(management(k),remote,accepted,rejected,reason));}
    public synchronized void placementFailure(String k,String id)throws Exception{put(k,"management",FolderPlacement.failure(management(k),id,System.currentTimeMillis()));}
    public synchronized void retryPlacements(String k)throws Exception{put(k,"management",FolderPlacement.retry(management(k)));}
    public synchronized void acknowledgeFolder(String k,JSONObject f)throws Exception{validFolder(f);JSONObject local=row(k,"folder",f.getString("id"));if(local==null||local.optLong("updated")<=f.optLong("updated")||f.optInt("deleted")==1)put(k,"folder",copy(f).put("dirty",false));}
    public synchronized void mergeNote(String k,JSONObject remote)throws Exception{validNote(remote);JSONObject local=row(k,"note",remote.getString("id"));if(local!=null&&local.optInt("purged")==1&&remote.optInt("purged")!=1)return;if(local==null||remote.optInt("purged")==1||(!local.optBoolean("dirty")&&remote.getLong("version")>local.optLong("version")))put(k,"note",copy(remote).put("dirty",false));}
    public synchronized JSONObject pending(String k,JSONObject local)throws Exception{JSONObject pending=row(k,"outbox",local.getString("id"));if(pending!=null)return pending;JSONObject sent=copy(local);sent.remove("_rev");put(k,"outbox",sent);return sent;}
    private void clearPending(String k,String noteId){getWritableDatabase().delete("records","space=? AND kind='outbox' AND id=?",new String[]{localSpaceId(k),noteId});}
    public synchronized long cursor(String k){return Long.parseLong(setting("cursor:"+localSpaceId(k),"0"));}
    public synchronized void mergePage(String k,JSONArray notes,long cursor)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{for(int i=0;i<notes.length();i++)mergeNote(k,notes.getJSONObject(i));setSetting("cursor:"+localSpaceId(k),Long.toString(cursor));db.setTransactionSuccessful();}finally{db.endTransaction();}}
    public synchronized String syncResult(String k,JSONObject sent,JSONObject response,int status)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{String copied="";JSONObject local=row(k,"note",sent.getString("id")),remote=response.optJSONObject("note");if(local==null)throw new IllegalStateException("Local note missing");if(remote!=null&&remote.optInt("purged")==1){validNote(remote);put(k,"note",copy(remote).put("dirty",false));}
        else if(status==409&&local.optInt("purged")==1&&remote!=null){local.put("version",remote.getLong("version")).put("mutation",id()).put("dirty",true);put(k,"note",local);}
        else if(status==409){JSONObject conflict=copy(local).put("id",id()).put("title",local.getString("title").substring(0,Math.min(175,local.getString("title").length()))+" · 冲突副本").put("version",0).put("mutation",id()).put("dirty",true);put(k,"note",conflict);copied=conflict.getString("id");if(remote!=null){validNote(remote);put(k,"note",copy(remote).put("dirty",false));}else{throw new IllegalStateException("Conflict response missing server note");}}
        else{if(remote==null)throw new IllegalStateException("Missing sync acknowledgement");validNote(remote);if(local.optString("mutation").equals(sent.getString("mutation")))put(k,"note",copy(remote).put("dirty",false));else{local.put("version",remote.getLong("version"));put(k,"note",local);}}clearPending(k,sent.getString("id"));db.setTransactionSuccessful();return copied;}finally{db.endTransaction();}}
    public synchronized void mergeFolder(String k,JSONObject f)throws Exception{validFolder(f);JSONObject old=row(k,"folder",f.getString("id"));if(old==null||old.optInt("deleted")==0&&(f.optInt("deleted")==1||!old.optBoolean("dirty")&&f.optLong("updated")>=old.optLong("updated")))put(k,"folder",copy(f).put("dirty",false));}
    static String normalized(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("\\s+"," ").trim();}
    public synchronized JSONArray search(String k,String query,String category,boolean everywhere)throws Exception{String normalized=normalized(query);String[] terms=normalized.isEmpty()?new String[0]:normalized.split(" ");Map<String,String> names=new HashMap<>();Set<String> liveFolders=new HashSet<>();JSONArray fs=rows(k,"folder");for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);if(f.optInt("deleted")==0){names.put(f.getString("id"),f.getString("name"));liveFolders.add(f.getString("id"));}}JSONArray ns=rows(k,"note");List<JSONObject> matches=new ArrayList<>();String scope=terms.length>0&&(everywhere||category.equals("folders"))?"all":category;
        for(int i=0;i<ns.length();i++){JSONObject n=ns.getJSONObject(i);if(n.optInt("purged")==1)continue;boolean deleted=n.optInt("deleted")==1;String folder=n.optString("folder_id","");if(scope.equals("trash")?!deleted:deleted)continue;if(scope.equals("favorite")&&n.optInt("favorite")!=1)continue;if(scope.equals("unfiled")&&!folder.isEmpty()&&liveFolders.contains(folder))continue;if(scope.startsWith("folder:")&&!scope.substring(7).equals(folder))continue;String hay=normalized(n.optString("title")+" "+DocumentModel.plain(n.getJSONObject("document"))+" "+names.getOrDefault(folder,"未分类"));boolean match=true;for(String t:terms)if(!hay.contains(t)){match=false;break;}if(match)matches.add(n);}
        matches.sort((a,b)->Long.compare(b.optLong("updated"),a.optLong("updated")));JSONArray out=new JSONArray();for(JSONObject n:matches)out.put(n);return out;
    }
}






