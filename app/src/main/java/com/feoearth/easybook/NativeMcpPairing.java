package com.feoearth.easybook;

import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Fixed-origin pairing; workspace credentials and assertions never cross the bridge. */
final class NativeMcpPairing {
    interface Transport { JSONObject post(boolean complete,JSONObject body,String credential)throws Exception; }
    static void pair(String challenge,String credential,Transport transport)throws Exception{
        if(challenge==null||!challenge.matches("[A-Za-z0-9_-]{24,128}"))throw new IllegalArgumentException("配对码格式无效");
        JSONObject proof=transport.post(false,new JSONObject().put("challenge",challenge),credential);
        String assertion=proof.optString("assertion","");
        if(assertion.isEmpty()||assertion.length()>8192)throw new IOException("工作区验证响应无效");
        JSONObject done=transport.post(true,new JSONObject().put("challenge",challenge).put("assertion",assertion),null);
        if(!done.optBoolean("paired"))throw new IOException("客户端授权响应无效");
    }
    static final class HttpsTransport implements Transport {
        public JSONObject post(boolean complete,JSONObject body,String credential)throws Exception{
            String endpoint=complete?"https://easybook-mcp-oauth.1902521952.workers.dev/pairing/complete":"https://easybook-sync.1902521952.workers.dev/api/mcp/attest";
            HttpsURLConnection c=(HttpsURLConnection)new URL(endpoint).openConnection();
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestMethod("POST");c.setRequestProperty("Content-Type","application/json");
            if(!complete)c.setRequestProperty("Authorization","Bearer "+credential);
            c.setDoOutput(true);byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);
            try{
                try(OutputStream out=c.getOutputStream()){out.write(bytes);}
                int status=c.getResponseCode();
                if(status!=200){if(status==409)throw new IOException("配对码已过期或已使用，请获取新码");if(status==401||status==403)throw new IOException("工作区验证失败，请检查设备连接及配对码");throw new IOException("配对服务暂不可用（HTTP "+status+"）");}
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[1024];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>16384)throw new IOException("配对响应过大");out.write(buffer,0,n);}return new JSONObject(out.toString("UTF-8"));
                }
            }finally{c.disconnect();}
        }
    }
}
