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
    private final DataProtection protection=new DataProtection.Plaintext();
    NoteRepository(Context c){this(c,"easybook-native.db");}
    NoteRepository(Context c,String name){super(c,name,null,1);setWriteAheadLoggingEnabled(true);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE records(space TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,rev INTEGER NOT NULL,PRIMARY KEY(space,kind,id))");
        db.execSQL("CREATE TABLE settings(name TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE migration_journal(digest TEXT PRIMARY KEY,source TEXT NOT NULL,state TEXT NOT NULL,report TEXT NOT NULL,created INTEGER NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){throw new IllegalStateException("Unsupported database upgrade");}
    public static String newKey(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.ROOT,"%02x",v&255));return s.toString();}
    static String hash(String s)throws Exception{byte[] b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte v:b)out.append(String.format(Locale.ROOT,"%02x",v&255));return out.toString();}
    static void key(String k){if(k==null||!k.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid workspace key");}
    static String id(){return UUID.randomUUID().toString();}
    static JSONObject copy(JSONObject n)throws JSONException{return new JSONObject(n.toString());}
    static void validNote(JSONObject n)throws Exception{
        if(!n.getString("id").matches("[a-f0-9-]{36}")||n.getString("title").length()>200||n.getString("body").length()>60000||n.optString("icon","📄").length()>16)throw new IllegalArgumentException("Invalid note");
        if(n.optLong("version",0)<0||!n.optString("mutation").matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid note revision");
        String f=n.optString("folder_id","");if(!f.isEmpty()&&!f.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("Invalid folder assignment");
        for(String field:new String[]{"favorite","deleted"})if(n.optInt(field,0)!=0&&n.optInt(field,0)!=1)throw new IllegalArgumentException("Invalid flag");
    }
    static void validFolder(JSONObject f)throws Exception{if(!f.getString("id").matches("[a-f0-9-]{36}")||f.getString("name").trim().isEmpty()||f.getString("name").length()>60)throw new IllegalArgumentException("Invalid folder");}
    public synchronized String setting(String name,String fallback){try(Cursor c=getReadableDatabase().rawQuery("SELECT value FROM settings WHERE name=?",new String[]{name})){return c.moveToFirst()?c.getString(0):fallback;}}
    public synchronized void setSetting(String name,String value){ContentValues v=new ContentValues();v.put("name",name);v.put("value",value);getWritableDatabase().insertWithOnConflict("settings",null,v,SQLiteDatabase.CONFLICT_REPLACE);}
    public synchronized String active(){String s=setting("active","");if(s.isEmpty()){s=newKey();setSetting("active",s);}return s;}
    public synchronized void activate(String k){key(k);setSetting("active",k);}
    public synchronized JSONArray rows(String space,String kind)throws Exception{key(space);JSONArray a=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT payload,rev FROM records WHERE space=? AND kind=? ORDER BY id",new String[]{space,kind})){while(c.moveToNext())a.put(new JSONObject(protection.decodeLocal(c.getString(0))).put("_rev",c.getLong(1)));}return a;}
    public synchronized JSONObject row(String space,String kind,String id)throws Exception{try(Cursor c=getReadableDatabase().rawQuery("SELECT payload,rev FROM records WHERE space=? AND kind=? AND id=?",new String[]{space,kind,id})){return c.moveToFirst()?new JSONObject(protection.decodeLocal(c.getString(0))).put("_rev",c.getLong(1)):null;}}
    private void put(String space,String kind,JSONObject value)throws Exception{JSONObject n=copy(value);JSONObject old=row(space,kind,n.getString("id"));long rev=old==null?1:old.getLong("_rev")+1;n.remove("_rev");ContentValues v=new ContentValues();v.put("space",space);v.put("kind",kind);v.put("id",n.getString("id"));v.put("payload",protection.encodeLocal(n.toString()));v.put("rev",rev);getWritableDatabase().insertWithOnConflict("records",null,v,SQLiteDatabase.CONFLICT_REPLACE);}
    public synchronized JSONObject snapshot(String k)throws Exception{return new JSONObject().put("key",k).put("notes",rows(k,"note")).put("folders",rows(k,"folder")).put("native",true);}
    private static String canonical(Object value)throws JSONException{if(value instanceof JSONObject){JSONObject o=(JSONObject)value;List<String> keys=new ArrayList<>();o.keys().forEachRemaining(keys::add);Collections.sort(keys);StringBuilder s=new StringBuilder("{");for(String k:keys){if(k.equals("_rev"))continue;s.append(JSONObject.quote(k)).append(':').append(canonical(o.get(k))).append(',');}return s.append('}').toString();}if(value instanceof JSONArray){StringBuilder s=new StringBuilder("[");JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++)s.append(canonical(a.get(i))).append(',');return s.append(']').toString();}return value==null||value==JSONObject.NULL?"null":value instanceof String?JSONObject.quote((String)value):String.valueOf(value);}
    private static boolean sameContent(JSONObject a,JSONObject b)throws Exception{return a.optString("title").equals(b.optString("title"))&&a.optString("body").equals(b.optString("body"))&&a.optString("folder_id","").equals(b.optString("folder_id",""))&&a.optInt("favorite")==b.optInt("favorite")&&a.optInt("deleted")==b.optInt("deleted")&&a.optString("icon","📄").equals(b.optString("icon","📄"));}
    /** Raw strings are archived in the same transaction as verified imports. Replays
     * of the identical source are no-ops; different colliding content becomes a copy. */
    public synchronized JSONObject migrate(JSONObject source)throws Exception{
        String raw=canonical(source),digest=hash(raw);try(Cursor c=getReadableDatabase().rawQuery("SELECT report FROM migration_journal WHERE digest=?",new String[]{digest})){if(c.moveToFirst())return new JSONObject(c.getString(0)).put("replayed",true);}
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
            JSONObject storage=source.getJSONObject("storage");String selected=source.optString("active","");if(!selected.isEmpty())key(selected);
            List<String> spaces=new ArrayList<>();Iterator<String> keys=storage.keys();while(keys.hasNext()){String name=keys.next();if(name.matches("easybook-[a-f0-9]{64}"))spaces.add(name.substring(9));else if(name.matches("easybook-folders-[a-f0-9]{64}")){String k=name.substring(17);if(!spaces.contains(k))spaces.add(k);}}
            if(!selected.isEmpty()&&!spaces.contains(selected))spaces.add(selected);
            int noteCount=0,folderCount=0,copies=0;
            for(String k:new HashSet<>(spaces)){
                key(k);JSONArray fs=new JSONArray(storage.optString("easybook-folders-"+k,"[]"));JSONArray ns=new JSONArray(storage.optString("easybook-"+k,"[]"));Map<String,String> folderMap=new HashMap<>();
                for(int i=0;i<fs.length();i++){JSONObject f=copy(fs.getJSONObject(i));validFolder(f);JSONObject old=row(k,"folder",f.getString("id"));String original=f.getString("id");if(old!=null&&!old.getString("name").equals(f.getString("name"))){f.put("id",id()).put("dirty",true);copies++;}folderMap.put(original,f.getString("id"));if(old==null||!f.getString("id").equals(original))put(k,"folder",f);if(!row(k,"folder",f.getString("id")).getString("name").equals(f.getString("name")))throw new IllegalStateException("Folder verification failed");folderCount++;}
                for(int i=0;i<ns.length();i++){JSONObject n=copy(ns.getJSONObject(i));if(!n.has("mutation"))n.put("mutation",id());if(!n.has("version"))n.put("version",0);if(!n.has("icon"))n.put("icon","📄");if(!n.has("favorite"))n.put("favorite",0);if(!n.has("deleted"))n.put("deleted",0);validNote(n);String folder=n.optString("folder_id","");if(folderMap.containsKey(folder))n.put("folder_id",folderMap.get(folder));String original=n.getString("id");JSONObject old=row(k,"note",original);
                    if(old==null)put(k,"note",n);else if(!sameContent(old,n)){n.put("id",id()).put("title",n.getString("title").substring(0,Math.min(175,n.getString("title").length()))+" · 迁移保留副本").put("version",0).put("mutation",id()).put("dirty",true);put(k,"note",n);copies++;}
                    JSONObject stored=row(k,"note",n.getString("id"));if(stored==null||!sameContent(stored,n))throw new IllegalStateException("Migration verification failed");noteCount++;
                }
            }
            String previous=setting("active","");if(previous.isEmpty()&&!selected.isEmpty())setSetting("active",selected);
            JSONObject report=new JSONObject().put("state","verified").put("digest",digest).put("spaces",new HashSet<>(spaces).size()).put("notes",noteCount).put("folders",folderCount).put("preservedCopies",copies).put("created",System.currentTimeMillis());
            ContentValues journal=new ContentValues();journal.put("digest",digest);journal.put("source",source.toString());journal.put("state","verified");journal.put("report",report.toString());journal.put("created",System.currentTimeMillis());db.insertOrThrow("migration_journal",null,journal);db.setTransactionSuccessful();return report;
        }finally{db.endTransaction();}
    }
    public synchronized JSONArray migrationReports()throws Exception{JSONArray reports=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT report FROM migration_journal ORDER BY created",null)){while(c.moveToNext())reports.put(new JSONObject(c.getString(0)));}return reports;}
    public synchronized JSONObject rollbackArchive()throws Exception{JSONObject all=new JSONObject();JSONArray spaces=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT DISTINCT space FROM records",null)){while(c.moveToNext())spaces.put(c.getString(0));}String active=active();boolean found=false;for(int i=0;i<spaces.length();i++)if(spaces.getString(i).equals(active))found=true;if(!found)spaces.put(active);for(int i=0;i<spaces.length();i++){String k=spaces.getString(i);all.put("easybook-"+k,rows(k,"note").toString());all.put("easybook-folders-"+k,rows(k,"folder").toString());}return new JSONObject().put("active",active).put("storage",all).put("reports",migrationReports());}
    /** Save only changed records, with an optimistic base mutation. A stale UI can
     * never overwrite an independently changed database record. */
    public synchronized JSONObject commit(String k,JSONObject changes)throws Exception{key(k);SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{JSONObject mappings=new JSONObject();JSONArray savedNotes=new JSONArray(),savedFolders=new JSONArray();JSONArray fs=changes.optJSONArray("folders");if(fs!=null)for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);validFolder(f);JSONObject old=row(k,"folder",f.getString("id"));if(old==null)put(k,"folder",f);else if(!old.getString("name").equals(f.getString("name")))throw new IllegalArgumentException("Folder rename is unsupported");savedFolders.put(row(k,"folder",f.getString("id")));}
        JSONArray ns=changes.optJSONArray("notes");if(ns!=null)for(int i=0;i<ns.length();i++){JSONObject change=ns.getJSONObject(i),n=copy(change.getJSONObject("note"));validNote(n);String original=n.getString("id"),base=change.optString("baseMutation","");JSONObject old=row(k,"note",original);String folder=n.optString("folder_id","");if(!folder.isEmpty()&&row(k,"folder",folder)==null&&(old==null||!folder.equals(old.optString("folder_id"))))throw new IllegalArgumentException("Folder missing");
            if(old!=null&&!old.optString("mutation").equals(base)&&!old.optString("mutation").equals(n.optString("mutation"))){n.put("id",id()).put("version",0).put("mutation",id()).put("title",n.getString("title").substring(0,Math.min(175,n.getString("title").length()))+" · 冲突副本");mappings.put(original,n.getString("id"));savedNotes.put(old);}
            else if(old!=null)n.put("version",old.optLong("version",0));
            n.put("dirty",true);put(k,"note",n);savedNotes.put(row(k,"note",n.getString("id")));
        }db.setTransactionSuccessful();return new JSONObject().put("notes",savedNotes).put("folders",savedFolders).put("mappings",mappings);
    }finally{db.endTransaction();}}
    public synchronized void acknowledgeFolder(String k,JSONObject f)throws Exception{validFolder(f);JSONObject local=row(k,"folder",f.getString("id"));if(local!=null){local.put("dirty",false);put(k,"folder",local);}else put(k,"folder",copy(f).put("dirty",false));}
    public synchronized void mergeNote(String k,JSONObject remote)throws Exception{validNote(remote);JSONObject local=row(k,"note",remote.getString("id"));if(local==null||(!local.optBoolean("dirty")&&remote.getLong("version")>local.optLong("version")))put(k,"note",copy(remote).put("dirty",false));}
    public synchronized String syncResult(String k,JSONObject sent,JSONObject response,int status)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{String copied="";JSONObject local=row(k,"note",sent.getString("id")),remote=response.optJSONObject("note");if(local==null)throw new IllegalStateException("Local note missing");if(status==409){JSONObject conflict=copy(local).put("id",id()).put("title",local.getString("title").substring(0,Math.min(175,local.getString("title").length()))+" · 冲突副本").put("version",0).put("mutation",id()).put("dirty",true);put(k,"note",conflict);copied=conflict.getString("id");if(remote!=null){validNote(remote);put(k,"note",copy(remote).put("dirty",false));}else{throw new IllegalStateException("Conflict response missing server note");}}
        else{if(remote==null)throw new IllegalStateException("Missing sync acknowledgement");validNote(remote);if(local.optString("mutation").equals(sent.getString("mutation")))put(k,"note",copy(remote).put("dirty",false));else{local.put("version",remote.getLong("version"));put(k,"note",local);}}db.setTransactionSuccessful();return copied;}finally{db.endTransaction();}}
    public synchronized void mergeFolder(String k,JSONObject f)throws Exception{validFolder(f);if(row(k,"folder",f.getString("id"))==null)put(k,"folder",copy(f).put("dirty",false));}
    static String normalized(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("\\s+"," ").trim();}
    public synchronized JSONArray search(String k,String query,String category,boolean everywhere)throws Exception{String normalized=normalized(query);String[] terms=normalized.isEmpty()?new String[0]:normalized.split(" ");Map<String,String> names=new HashMap<>();JSONArray fs=rows(k,"folder");for(int i=0;i<fs.length();i++)names.put(fs.getJSONObject(i).getString("id"),fs.getJSONObject(i).getString("name"));JSONArray ns=rows(k,"note");List<JSONObject> matches=new ArrayList<>();String scope=terms.length>0&&(everywhere||category.equals("folders"))?"all":category;
        for(int i=0;i<ns.length();i++){JSONObject n=ns.getJSONObject(i);boolean deleted=n.optInt("deleted")==1;String folder=n.optString("folder_id","");if(scope.equals("trash")?!deleted:deleted)continue;if(scope.equals("favorite")&&n.optInt("favorite")!=1)continue;if(scope.equals("unfiled")&&!folder.isEmpty())continue;if(scope.startsWith("folder:")&&!scope.substring(7).equals(folder))continue;String hay=normalized(n.optString("title")+" "+n.optString("body")+" "+names.getOrDefault(folder,"未分类"));boolean match=true;for(String t:terms)if(!hay.contains(t)){match=false;break;}if(match)matches.add(n);}
        matches.sort((a,b)->Long.compare(b.optLong("updated"),a.optLong("updated")));JSONArray out=new JSONArray();for(JSONObject n:matches)out.put(n);return out;
    }
}
