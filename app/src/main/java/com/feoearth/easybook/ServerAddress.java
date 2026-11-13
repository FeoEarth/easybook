package com.feoearth.easybook;

import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** Root-origin parsing and the deliberately narrow cleartext LAN policy. */
final class ServerAddress {
 private ServerAddress(){}
 static String normalize(String value){
  try{
   if(value==null)throw new IllegalArgumentException("Server address required");
   URI uri=new URI(value.trim());String scheme=uri.getScheme();
   if(scheme==null||!(scheme.equalsIgnoreCase("https")||scheme.equalsIgnoreCase("http")))throw new IllegalArgumentException("HTTPS or private HTTP required");
   scheme=scheme.toLowerCase(Locale.ROOT);String authority=uri.getRawAuthority(),path=uri.getRawPath();
   if(authority==null||authority.isEmpty()||authority.indexOf('@')>=0||authority.indexOf('%')>=0||uri.getRawQuery()!=null||uri.getRawFragment()!=null||path!=null&&!path.isEmpty()&&!path.equals("/"))throw new IllegalArgumentException("Use a server root address without credentials, path, query or fragment");
   String host,portText="";boolean ipv6=authority.startsWith("[");
   if(ipv6){int end=authority.indexOf(']');if(end<0)throw new IllegalArgumentException("Invalid IPv6 address");host=authority.substring(1,end);String rest=authority.substring(end+1);if(!rest.isEmpty()){if(!rest.startsWith(":"))throw new IllegalArgumentException("Invalid port");portText=rest.substring(1);if(portText.isEmpty())throw new IllegalArgumentException("Invalid port");}host=ipv6(host);}
   else{int colon=authority.indexOf(':');if(colon>=0){if(authority.indexOf(':',colon+1)>=0)throw new IllegalArgumentException("IPv6 requires brackets");host=authority.substring(0,colon);portText=authority.substring(colon+1);if(portText.isEmpty())throw new IllegalArgumentException("Invalid port");}else host=authority;
    host=IDN.toASCII(host,IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);if(host.endsWith("."))host=host.substring(0,host.length()-1);if(host.isEmpty()||host.length()>253)throw new IllegalArgumentException("Invalid host");
    if(host.matches("[0-9.]+")){String[] octets=host.split("\\.",-1);if(octets.length!=4)throw new IllegalArgumentException("Use a complete IPv4 address");for(String octet:octets)if(!octet.matches("0|[1-9][0-9]{0,2}")||Integer.parseInt(octet)>255)throw new IllegalArgumentException("Invalid IPv4 address");}
   }
   int port=-1;if(!portText.isEmpty()){if(!portText.matches("[0-9]{1,5}"))throw new IllegalArgumentException("Invalid port");port=Integer.parseInt(portText);if(port<1||port>65535)throw new IllegalArgumentException("Invalid port");}if(port==(scheme.equals("https")?443:80))port=-1;
   String origin=scheme+"://"+(ipv6?"["+host+"]":host)+(port<0?"":":"+port);
   if(scheme.equals("http")&&(ipv6||host.matches("[0-9.]+"))&&!isPrivateAddress(InetAddress.getByName(host)))throw new IllegalArgumentException("HTTP is limited to private networks");
   return origin;
  }catch(IllegalArgumentException e){throw e;}catch(Exception e){throw new IllegalArgumentException("Invalid server address",e);}
 }
 private static String ipv6(String host)throws Exception{
  if(host.indexOf(':')<0||host.indexOf('%')>=0)throw new IllegalArgumentException("Invalid IPv6 address");byte[] bytes=InetAddress.getByName(host).getAddress();
  if(bytes.length==4){byte[] mapped=new byte[16];mapped[10]=(byte)255;mapped[11]=(byte)255;System.arraycopy(bytes,0,mapped,12,4);bytes=mapped;}
  int[] words=new int[8];for(int i=0;i<8;i++)words[i]=((bytes[i*2]&255)<<8)|(bytes[i*2+1]&255);
  int start=-1,length=1;for(int i=0;i<8;){if(words[i]!=0){i++;continue;}int j=i;while(j<8&&words[j]==0)j++;if(j-i>length){start=i;length=j-i;}i=j;}
  StringBuilder out=new StringBuilder();for(int i=0;i<8;){if(i==start){out.append("::");i+=length;continue;}if(out.length()>0&&out.charAt(out.length()-1)!=':')out.append(':');out.append(Integer.toHexString(words[i++]));}return out.toString();
 }
 static boolean isHttp(String origin){return origin.startsWith("http://");}
 static void checkHttpHost(String origin)throws IOException{
  if(!isHttp(origin))return;String host=URI.create(origin).getHost();if(host.startsWith("["))host=host.substring(1,host.length()-1);InetAddress[] addresses=InetAddress.getAllByName(host);
  checkHttpAddresses(addresses);
 }
 static void checkHttpAddresses(InetAddress[] addresses)throws IOException{if(addresses.length==0)throw new IOException("HTTP host has no addresses");for(InetAddress address:addresses)if(!isPrivateAddress(address))throw new IOException("HTTP is limited to private networks");}
 static boolean isPrivateAddress(InetAddress address){
  byte[] b=address.getAddress();if(b.length==4){int a=b[0]&255,c=b[1]&255;return a==10||a==127||a==172&&c>=16&&c<=31||a==192&&c==168||a==100&&c>=64&&c<=127;}
  if(b.length!=16)return false;boolean loopback=true;for(int i=0;i<15;i++)loopback&=b[i]==0;if(loopback&&b[15]==1)return true;
  boolean mapped=true;for(int i=0;i<10;i++)mapped&=b[i]==0;if(mapped&&b[10]==(byte)255&&b[11]==(byte)255){try{return isPrivateAddress(InetAddress.getByAddress(new byte[]{b[12],b[13],b[14],b[15]}));}catch(UnknownHostException impossible){return false;}}
  return (b[0]&254)==252;
 }
 static String id(String origin){try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(origin.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}catch(Exception e){throw new IllegalStateException(e);}}
}
