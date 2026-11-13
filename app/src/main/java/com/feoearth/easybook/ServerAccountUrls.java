package com.feoearth.easybook;

import java.net.URI;
import java.net.URLDecoder;

/** Account destinations belong to the captured profile, never to a server-supplied host. */
final class ServerAccountUrls {
    private static int port(URI uri){return uri.getPort()==-1?443:uri.getPort();}
    static boolean sameOrigin(String origin,String destination){
        try{
            URI base=new URI(origin),uri=new URI(destination);
            return "https".equals(base.getScheme())&&"https".equals(uri.getScheme())&&base.getHost()!=null&&base.getHost().equalsIgnoreCase(uri.getHost())&&port(base)==port(uri)&&uri.getRawUserInfo()==null&&uri.getRawFragment()==null;
        }catch(Exception invalid){return false;}
    }
    static String qrChallengeId(String raw,String origin){
        if(raw==null||raw.length()>512||!sameOrigin(origin,raw))return null;
        try{
            URI link=new URI(raw);
            if(!"/account/qr/approve".equals(link.getRawPath()))return null;
            String query=link.getRawQuery();
            return query!=null&&query.matches("id=[a-f0-9]{64}")?query.substring(3):null;
        }catch(Exception invalid){return null;}
    }
    static boolean qrApprovalMatches(String raw,String origin,boolean builtin){
        if(raw==null||raw.length()>1024||!origin.startsWith("https://"))return false;
        try{
            URI link=new URI(raw);
            if(!"easybook".equals(link.getScheme())||!"account".equals(link.getHost())||!"/qr/approve".equals(link.getRawPath())||link.getRawUserInfo()!=null||link.getPort()!=-1||link.getRawFragment()!=null||link.getRawQuery()==null)return false;
            String id=null,server=null;
            for(String item:link.getRawQuery().split("&",-1)){
                String[] pair=item.split("=",2);if(pair.length!=2)return false;
                String key=URLDecoder.decode(pair[0],"UTF-8"),value=URLDecoder.decode(pair[1],"UTF-8");
                if(key.equals("id")&&id==null)id=value;
                else if(key.equals("server")&&server==null)server=value;
                else return false;
            }
            return id!=null&&id.matches("[a-f0-9]{64}")&&(server==null?builtin:origin.equals(server));
        }catch(Exception invalid){return false;}
    }
}
