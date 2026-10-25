package com.feoearth.easybook;
import android.app.job.*;
/** OS-managed approximate periodic work; no foreground service or resident loop. */
public final class SyncJobService extends JobService {
 private Thread worker;private volatile boolean stopped;
 @Override public boolean onStartJob(JobParameters params){stopped=false;worker=new Thread(()->{try{NoteRepository db=NoteRepository.get(this);SyncPolicy.initialize(this);String key=db.activeSpace();if(db.securityStatus().getBoolean("paired"))new NativeSync(db,new NativeSync.HttpsTransport(new DataProtection.Plaintext())).run(key,false);}catch(Exception ignored){}finally{if(!stopped)jobFinished(params,false);}},"Easybook-periodic-sync");worker.start();return true;}
 @Override public boolean onStopJob(JobParameters params){stopped=true;if(worker!=null)worker.interrupt();return true;}
}
