import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Compile the actual Android address policy with only the JDK: no SDK, Gradle or network.
const root=resolve(import.meta.dirname,'..'),temp=await mkdtemp(join(tmpdir(),'easybook-server-address-'));
const source=join(root,'app/src/main/java/com/feoearth/easybook/ServerAddress.java');
const harness=`package com.feoearth.easybook;
import java.net.*;import java.io.*;
public final class ServerAddressCheck {
 static void equal(String expected,String actual){if(!expected.equals(actual))throw new AssertionError(expected+" != "+actual);}
 static void rejected(String value){try{ServerAddress.normalize(value);throw new AssertionError("accepted "+value);}catch(IllegalArgumentException expected){}}
 public static void main(String[] args)throws Exception{
  equal("https://example.com",ServerAddress.normalize(" HTTPS://EXAMPLE.COM:443/ "));
  equal("https://xn--bcher-kva.example:8443",ServerAddress.normalize("https://Bücher.example:8443/"));
  equal("http://[fd00::1]:8080",ServerAddress.normalize("http://[FD00:0:0:0:0:0:0:1]:8080/"));
  equal("http://[::1]",ServerAddress.normalize("http://[0:0:0:0:0:0:0:1]:80"));
  equal(ServerAddress.id("https://example.com"),ServerAddress.id(ServerAddress.normalize("https://EXAMPLE.com/")));
  if(ServerAddress.id("https://example.com").equals(ServerAddress.id("https://example.com:8443")))throw new AssertionError("ports share identity");
  for(String invalid:new String[]{"ftp://example.com","https://u:p@example.com","https://example.com/path","https://example.com//","https://example.com/%2e","https://example.com?","https://example.com#","https://example.com:0","https://example.com:65536","https://example.com:","https://127.1","https://0177.0.0.1","https://[fe80::1%25eth0]","http://8.8.8.8","http://169.254.169.254","http://0.0.0.0","http://[2001:4860:4860::8888]","http://[fe80::1]","http://[::]"})rejected(invalid);
  for(String allowed:new String[]{"10.0.0.1","172.16.0.1","172.31.255.255","192.168.1.1","127.0.0.1","100.64.0.1","100.127.255.255","::1","fc00::1","fdff::1","::ffff:192.168.1.2"})if(!ServerAddress.isPrivateAddress(InetAddress.getByName(allowed)))throw new AssertionError("denied "+allowed);
  for(String denied:new String[]{"8.8.8.8","172.15.255.255","172.32.0.0","100.63.255.255","100.128.0.0","169.254.1.1","0.0.0.0","224.0.0.1","::","fe80::1","ff02::1","2001:db8::1","::ffff:8.8.8.8"})if(ServerAddress.isPrivateAddress(InetAddress.getByName(denied)))throw new AssertionError("allowed "+denied);
  ServerAddress.checkHttpAddresses(new InetAddress[]{InetAddress.getByName("10.0.0.1"),InetAddress.getByName("fd00::1")});
  try{ServerAddress.checkHttpAddresses(new InetAddress[]{InetAddress.getByName("10.0.0.1"),InetAddress.getByName("8.8.8.8")});throw new AssertionError("mixed DNS allowed");}catch(IOException expected){}
  try{ServerAddress.checkHttpAddresses(new InetAddress[0]);throw new AssertionError("empty DNS allowed");}catch(IOException expected){}
  System.out.println("PASS Android server address policy: normalized stable origins, private HTTP boundaries, mixed DNS refusal");
 }
}`;
function run(args){const result=spawnSync('java',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,[result.error,result.stdout,result.stderr].filter(Boolean).join('\n'));if(result.stdout)process.stdout.write(result.stdout);}
try{
 await writeFile(join(temp,'ServerAddressCheck.java'),harness);
 run(['-m','jdk.compiler/com.sun.tools.javac.Main','-d',temp,source,join(temp,'ServerAddressCheck.java')]);
 run(['-cp',temp,'com.feoearth.easybook.ServerAddressCheck']);
 // Syntax-check the Java files changed for the feature, without downloading an Android SDK.
 const parser=`import javax.tools.*;import com.sun.source.util.*;import java.util.*;public class ParseJava{public static void main(String[] args)throws Exception{JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();DiagnosticCollector<JavaFileObject> errors=new DiagnosticCollector<>();StandardJavaFileManager files=compiler.getStandardFileManager(errors,null,null);JavacTask task=(JavacTask)compiler.getTask(null,files,errors,List.of("-proc:none"),null,files.getJavaFileObjects(args));task.parse();for(Diagnostic<?> error:errors.getDiagnostics())if(error.getKind()==Diagnostic.Kind.ERROR)throw new AssertionError(error.toString());System.out.println("PASS Android feature Java syntax");files.close();}}`;
 await writeFile(join(temp,'ParseJava.java'),parser);
 const classes=['ServerAddress','ServerProfiles','NoteRepository','AttachmentStore','NativeTransport','NativeSync','SyncPolicy','SyncJobService','SyncJournal','NativeServerController','NativeAccount','WorkspaceClient','SecurityManager','MainActivity','ServerAccountUrls','QrScanActivity','NativeMcpPairing'];
 run([join(temp,'ParseJava.java'),...classes.map(name=>join(root,'app/src/main/java/com/feoearth/easybook',name+'.java'))]);
}finally{await rm(temp,{recursive:true,force:true});}
