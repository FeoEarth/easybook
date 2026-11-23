package com.feoearth.easybook;

import java.net.InetAddress;

final class PublicNetworkAddress {
    private PublicNetworkAddress() {}
    static boolean isPublic(InetAddress address){
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
}
