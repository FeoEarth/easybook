package com.feoearth.easybook;
import android.app.job.*;
/** OS-managed approximate periodic work; no foreground service or resident loop. */
public final class SyncJobService extends JobService {
 private Thread worker;private volatile boolean stopped;private volatile NoteRepository runningDb;
 @Override public boolean onStartJob(JobParameters params){
  ServerProfiles registry=ServerProfiles.get(this);ServerProfiles.Profile profile=registry.active();
  if(!profile.id.equals(params.getExtras().getString("profileId",""))||profile.epoch!=params.getExtras().getLong("profileEpoch",-1))return false;
  stopped=false;worker=new Thread(()->{try{if(stopped||!registry.isActive(profile.id,profile.epoch))return;NoteRepository db=NoteRepository.get(this,profile);runningDb=db;db.assertActiveProfile();SyncPolicy.initialize(this);String key=db.activeSpace();if(db.securityStatus().getBoolean("paired"))new NativeSync(db,new NativeSync.HttpsTransport(db,new DataProtection.Plaintext())).run(key,false);}catch(Exception ignored){}finally{runningDb=null;if(!stopped)jobFinished(params,false);}},"Easybook-periodic-sync");worker.start();return true;
 }
 @Override public boolean onStopJob(JobParameters params){stopped=true;NoteRepository db=runningDb;if(db!=null)NativeTransport.cancel(db);if(worker!=null)worker.interrupt();return ServerProfiles.get(this).isActive(params.getExtras().getString("profileId",""),params.getExtras().getLong("profileEpoch",-1));}
}
