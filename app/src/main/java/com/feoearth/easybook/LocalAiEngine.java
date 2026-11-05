package com.feoearth.easybook;

import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Single-owner on-device inference, isolated from Easybook's sync/database executor. */
final class LocalAiEngine {
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile Conversation processing;
    private Engine engine;
    private String loaded="";
    boolean busy(){return busy.get();}
    void generate(String requestId,String model,File file,String prompt,Consumer<JSONObject> events){
        if(!busy.compareAndSet(false,true))throw new IllegalStateException("本地 AI 正在生成，请稍后重试");
        executor.execute(()->{
            try{
                if(engine==null||!loaded.equals(model)){
                    release();
                    // The Engine takes seconds to initialize. Never touch the UI thread.
                    Engine candidate=new Engine(new EngineConfig(file.getAbsolutePath()));
                    candidate.initialize();
                    engine=candidate;loaded=model;
                }
                Conversation conversation=engine.createConversation(new ConversationConfig());
                processing=conversation;
                CountDownLatch finished=new CountDownLatch(1);
                final Throwable[] failure={null};
                try{
                    // Prompt includes bounded prior turns. Each request gets a fresh conversation,
                    // ensuring that a workspace/session switch cannot inherit earlier context.
                    conversation.sendMessageAsync(prompt,new MessageCallback(){
                        @Override public void onMessage(Message message){
                            String delta=message.toString();
                            if(delta.isEmpty())return;
                            emit(events,requestId,"delta",delta);
                        }
                        @Override public void onDone(){finished.countDown();}
                        @Override public void onError(Throwable error){failure[0]=error;finished.countDown();}
                    });
                    if(!finished.await(5,TimeUnit.MINUTES)){
                        conversation.cancelProcess();
                        if(!finished.await(15,TimeUnit.SECONDS))throw new IllegalStateException("本地推理超时");
                    }
                    if(failure[0]!=null)throw new IllegalStateException("本地推理失败",failure[0]);
                    emit(events,requestId,"done","");
                }finally{
                    processing=null;
                    try{conversation.close();}catch(Exception ignored){}
                }
            }catch(Throwable failure){
                android.util.Log.w("EasybookLocalAI","inference_error:"+failure.getClass().getSimpleName());
                emit(events,requestId,"error",failure.getMessage()==null?"设备暂时无法运行此模型，请尝试轻量模型":failure.getMessage());
                release();
            }finally{busy.set(false);}
        });
    }
    void cancel(){Conversation current=processing;if(current!=null)try{current.cancelProcess();}catch(Exception ignored){}}
    void unload(){if(!busy.get())executor.execute(this::release);}
    private static void emit(Consumer<JSONObject> sink,String id,String type,String content){
        try{sink.accept(new JSONObject().put("id",id).put("type",type).put("text",content));}catch(Exception ignored){}
    }
    private void release(){
        if(engine!=null){try{engine.close();}catch(Exception ignored){}engine=null;loaded="";}
    }
    void shutdown(){cancel();executor.execute(this::release);executor.shutdown();}
}
