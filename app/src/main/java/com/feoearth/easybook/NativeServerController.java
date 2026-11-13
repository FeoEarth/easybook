package com.feoearth.easybook;

import android.content.Context;
import java.io.*;
import java.net.HttpURLConnection;
import org.json.*;

/** The discovery request contains no account session, workspace key or device identity. */
final class NativeServerController {
    static final class Failure extends IOException {
        Failure(String message){super(message);}
    }
    private final ServerProfiles profiles;
    NativeServerController(Context context){profiles=ServerProfiles.get(context);}
    JSONObject list()throws JSONException{return new JSONObject().put("servers",profiles.list()).put("active",profiles.active().id).put("epoch",profiles.epoch());}
    JSONObject perform(String method,JSONObject args)throws Exception{
        try{
            switch(method){
                case "server.list":return list();
                case "server.add":return new JSONObject().put("server",profiles.add(args.getString("origin"),args.getString("name"),args.optBoolean("acknowledgeHttp",false)).toJSON());
                case "server.rename":return new JSONObject().put("server",profiles.rename(args.getString("id"),args.getString("name")).toJSON());
                case "server.remove":profiles.remove(args.getString("id"));return list();
                case "server.test":return probe(profiles.profile(args.getString("id")));
                default:throw new SecurityException("Server operation denied");
            }
        }catch(Failure e){throw e;}catch(IllegalArgumentException|IllegalStateException e){throw new Failure(e.getMessage());}
    }
    ServerProfiles.Profile select(String id)throws Failure{
        try{return profiles.select(id);}catch(IllegalArgumentException|IllegalStateException e){throw new Failure(e.getMessage());}
    }
    private JSONObject probe(ServerProfiles.Profile profile)throws Exception{
        HttpURLConnection connection=NativeTransport.openProbe(profile,"/.well-known/easybook.json");
        connection.setRequestMethod("GET");connection.setRequestProperty("Accept","application/json");
        connection.setConnectTimeout(10000);connection.setReadTimeout(10000);connection.setInstanceFollowRedirects(false);
        try{
            int code=connection.getResponseCode();
            if(code!=200)throw new Failure("服务器探测失败（HTTP "+code+"），请检查服务地址与部署配置");
            JSONObject descriptor;
            try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] bytes=new byte[2048];int n;
                while((n=in.read(bytes))!=-1){if(out.size()+n>32768)throw new Failure("服务器探测响应过大");out.write(bytes,0,n);}
                try{descriptor=new JSONObject(out.toString("UTF-8"));}catch(JSONException e){throw new Failure("服务器未返回有效的 Easybook 兼容信息");}
            }
            if(!(descriptor.opt("protocolVersion") instanceof Number)||descriptor.optDouble("protocolVersion",0)!=1)throw new Failure("服务器协议版本不兼容，需要协议 1");
            if(!profile.origin.equals(descriptor.optString("serverOrigin")))throw new Failure("服务器声明的地址与所填地址不一致，请检查 PUBLIC_ORIGIN");
            JSONObject capabilities=descriptor.optJSONObject("capabilities");
            if(capabilities==null||!Boolean.TRUE.equals(capabilities.opt("sync"))||!Boolean.TRUE.equals(capabilities.opt("keySync"))||!profile.httpKeyOnly&&!Boolean.TRUE.equals(capabilities.opt("accounts")))throw new Failure("服务器缺少所需的 Easybook 功能");
            // Persist only the documented boolean capabilities, never arbitrary server content.
            JSONObject safe=new JSONObject();
            for(String key:new String[]{"sync","keySync","accounts","webConnector","passkeys","httpKeyOnly"})safe.put(key,Boolean.TRUE.equals(capabilities.opt(key)));
            safe.put("httpKeyOnly",profile.httpKeyOnly);
            if(profile.httpKeyOnly)safe.put("accounts",false).put("passkeys",false).put("webConnector",false);
            ServerProfiles.Profile verified=profiles.markVerified(profile.id,safe);
            return new JSONObject().put("server",verified.toJSON()).put("protocolVersion",1).put("capabilities",safe);
        }catch(Failure e){throw e;}catch(javax.net.ssl.SSLException e){throw new Failure("服务器证书验证失败，请使用系统信任的有效 HTTPS 证书");}catch(java.net.SocketTimeoutException e){throw new Failure("服务器连接超时，请检查网络和地址");}catch(IOException e){throw new Failure("无法连接服务器，请检查网络和服务地址");}
        finally{connection.disconnect();}
    }
}
