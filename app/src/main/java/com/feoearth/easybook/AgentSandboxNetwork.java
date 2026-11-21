package com.feoearth.easybook;

import android.content.Context;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.IDN;
import java.net.InetAddress;
import java.net.URI;
import java.net.Socket;
import java.net.InetSocketAddress;
import java.io.IOException;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;

/**
 * Public HTTPS text broker for the opt-in Agent script worker. No cookies,
 * account credentials, redirects, arbitrary headers or private network hosts.
 * The worker has no access to the native bridge directly.
 */
final class AgentSandboxNetwork {
    private static final String PREFS="agent-sandbox-v1";
    private static final int MAX_RESPONSE=262144;
    private AgentSandboxNetwork(){}
    static boolean enabled(Context context){
        return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getBoolean("enabled",false);
    }
    static JSONObject status(Context context)throws Exception {
        return new JSONObject().put("enabled",enabled(context)).put("runtime","android-web-worker")
            .put("language","javascript").put("network","public-https").put("fileScope","session")
            .put("maxSeconds",30).put("maxFiles",48).put("maxBytes",524288);
    }
    static JSONObject configure(Context context,JSONObject args)throws Exception {
        if(!(args.opt("enabled") instanceof Boolean))throw new SecurityException("Invalid sandbox setting");
        boolean value=args.getBoolean("enabled");
        context.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putBoolean("enabled",value).commit();
        return status(context);
    }
    private static boolean publicAddress(InetAddress address){
        if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()
            ||address.isSiteLocalAddress()||address.isMulticastAddress())return false;
        byte[] bytes=address.getAddress();
        // Block IPv6 unique-local, deprecated site-local, and IPv4-mapped private addresses.
        if(bytes.length==16){
            if((bytes[0]&0xfe)==0xfc||(bytes[0]&0xff)==0xfe&&((bytes[1]&0xc0)==0xc0))return false;
            if(bytes[0]==0&&bytes[1]==0){
                boolean mapped=true;for(int i=2;i<10;i++)if(bytes[i]!=0)mapped=false;
                if(mapped&&bytes[10]==(byte)0xff&&bytes[11]==(byte)0xff){
                    byte[] v4={bytes[12],bytes[13],bytes[14],bytes[15]};
                    return publicAddressBytes(v4);
                }
            }
        }else if(bytes.length==4)return publicAddressBytes(bytes);
        return true;
    }
    private static boolean publicAddressBytes(byte[] bytes){
        int a=bytes[0]&255,b=bytes[1]&255,c=bytes[2]&255;
        if(a==0||a==10||a==127||a>=224)return false;
        if(a==100&&b>=64&&b<=127)return false; // CGNAT
        if(a==169&&b==254)return false;
        if(a==172&&b>=16&&b<=31)return false;
        if(a==192&&(b==168||b==0&&c==0||b==0&&c==2||b==88&&c==99))return false;
        if(a==198&&(b==18||b==19||b==51&&c==100))return false;
        if(a==203&&b==0&&c==113)return false;
        if(a==255)return false;
        return true;
    }
    /**
     * Pin the actual TCP destination to an already validated public address.
     * This prevents a second DNS resolution from switching to a private IP.
     * Fail closed if an HTTPS stack requests an unpinned socket path.
     */
    private static SSLSocketFactory pinnedFactory(String hostname,InetAddress[] verified){
        SSLSocketFactory delegate=(SSLSocketFactory)SSLSocketFactory.getDefault();
        return new SSLSocketFactory(){
            @Override public String[] getDefaultCipherSuites(){return delegate.getDefaultCipherSuites();}
            @Override public String[] getSupportedCipherSuites(){return delegate.getSupportedCipherSuites();}
            private boolean valid(InetAddress address){
                if(!publicAddress(address))return false;
                for(InetAddress pinned:verified)if(pinned.equals(address))return true;
                return false;
            }
            private Socket connected(InetAddress address,int port)throws IOException{
                if(port!=443||!valid(address))throw new IOException("Blocked unverified HTTPS destination");
                Socket plain=new Socket();
                plain.connect(new InetSocketAddress(address,port),8000);
                return plain;
            }
            @Override public Socket createSocket(String host,int port)throws IOException{
                if(!hostname.equalsIgnoreCase(host))throw new IOException("HTTPS host mismatch");
                Socket raw=connected(verified[0],port);
                return delegate.createSocket(raw,hostname,port,true);
            }
            @Override public Socket createSocket(String host,int port,InetAddress local,int localPort)throws IOException{
                throw new IOException("Unpinned bound HTTPS socket denied");
            }
            @Override public Socket createSocket(InetAddress address,int port)throws IOException{
                Socket raw=connected(address,port);
                return delegate.createSocket(raw,hostname,port,true);
            }
            @Override public Socket createSocket(InetAddress address,int port,InetAddress local,int localPort)throws IOException{
                throw new IOException("Unpinned bound HTTPS socket denied");
            }
            @Override public Socket createSocket(Socket socket,String host,int port,boolean autoClose)throws IOException{
                if(!hostname.equalsIgnoreCase(host)||port!=443)throw new IOException("HTTPS host mismatch");
                if(socket!=null&&socket.isConnected()){
                    if(!valid(socket.getInetAddress()))throw new IOException("Unverified HTTPS socket destination");
                    return delegate.createSocket(socket,hostname,port,autoClose);
                }
                Socket raw=connected(verified[0],port);
                return delegate.createSocket(raw,hostname,port,true);
            }
            @Override public Socket createSocket()throws IOException{
                throw new IOException("Unpinned HTTPS socket denied");
            }
        };
    }
    static JSONObject fetch(Context context,String input)throws Exception {
        if(!enabled(context))throw new SecurityException("Agent 执行环境未启用");
        if(input==null||input.length()>2048)throw new SecurityException("URL 过长");
        URI uri;try{uri=new URI(input);}catch(Exception e){throw new SecurityException("URL 无效");}
        if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getRawUserInfo()!=null||uri.getFragment()!=null||uri.getPort()!=-1&&uri.getPort()!=443)
            throw new SecurityException("沙箱仅允许公开 HTTPS");
        String host=uri.getHost();if(host==null)throw new SecurityException("无效主机名");
        host=IDN.toASCII(host).toLowerCase(java.util.Locale.ROOT);
        if(host.length()>253||!host.contains(".")||!host.matches("[a-z0-9.-]+")||host.contains("..")||host.startsWith(".")||host.endsWith(".")
            ||host.matches("[0-9.]+")||host.equals("localhost")||host.endsWith(".localhost")||host.endsWith(".local")
            ||host.endsWith(".internal")||host.endsWith(".lan")||host.endsWith(".home")||host.endsWith(".test"))
            throw new SecurityException("不允许访问本地或私有主机");
        InetAddress[] verified=InetAddress.getAllByName(host);
        if(verified.length==0)throw new SecurityException("无法解析 HTTPS 主机");
        for(InetAddress address:verified)if(!publicAddress(address))
            throw new SecurityException("不允许访问私有网络地址");
        HttpsURLConnection connection=(HttpsURLConnection)uri.toURL().openConnection();
        connection.setSSLSocketFactory(pinnedFactory(host,verified));
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(8000);
        connection.setRequestProperty("Accept","text/plain, application/json, text/*;q=0.8");
        connection.setUseCaches(false);
        try{
            int status=connection.getResponseCode();
            if(status<200||status>=300)throw new SecurityException("HTTPS 请求失败（HTTP "+status+"）；不跟随重定向");
            String type=connection.getContentType();if(type==null)type="";
            if(type.length()>160)type=type.substring(0,160);
            if(!(type.startsWith("text/")||type.startsWith("application/json")||type.startsWith("application/javascript")
                ||type.startsWith("application/xml")||type.startsWith("application/octet-stream")))
                throw new SecurityException("仅允许文本类型响应");
            try(InputStream stream=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[4096];int n;
                while((n=stream.read(buffer))!=-1){if(output.size()+n>MAX_RESPONSE)throw new SecurityException("响应超过 256 KB");output.write(buffer,0,n);}
                return new JSONObject().put("status",status).put("contentType",type)
                    .put("text",new String(output.toByteArray(),StandardCharsets.UTF_8));
            }
        }finally{connection.disconnect();}
    }
}
