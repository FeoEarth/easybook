import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..'),temp=await mkdtemp(join(tmpdir(),'easybook-server-account-'));
const harness=`package com.feoearth.easybook;
public class ServerAccountUrlsCheck {
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 public static void main(String[] args){
  String origin="https://notes.example.com:8443",id="a".repeat(64),qr=origin+"/account/qr/approve?id="+id;
  check(ServerAccountUrls.sameOrigin(origin,origin+"/account/handoff?flow=one"),"same profile login denied");
  check(ServerAccountUrls.sameOrigin("https://easybook.loonxy.com","https://easybook.loonxy.com:443/account"),"default HTTPS port differs");
  for(String wrong:new String[]{"https://easybook.loonxy.com/account","https://notes.example.com/account","https://notes.example.com:8444/account","https://notes.example.com.evil.test:8443/account","https://notes.example.com:8443@evil.test/account","http://notes.example.com:8443/account","https://notes.example.com:8443/account#fragment","//notes.example.com:8443/account","javascript:alert(1)"})check(!ServerAccountUrls.sameOrigin(origin,wrong),"cross-profile account destination accepted: "+wrong);
  check(id.equals(ServerAccountUrls.qrChallengeId(qr,origin)),"same profile QR denied");
  for(String wrong:new String[]{qr+"&id="+id,qr+"&extra=1",qr+"#fragment",origin+"/account/qr/approve/"+"?id="+id,origin+"/account/qr/%61pprove?id="+id,"https://easybook.loonxy.com/account/qr/approve?id="+id,"http://192.168.1.3/account/qr/approve?id="+id})check(ServerAccountUrls.qrChallengeId(wrong,origin)==null,"invalid QR accepted: "+wrong);
  String basic="easybook://account/qr/approve?id="+id,scoped=basic+"&server=https%3A%2F%2Fnotes.example.com%3A8443";
  check(ServerAccountUrls.qrApprovalMatches(basic,"https://easybook.loonxy.com",true),"official legacy QR denied");
  check(ServerAccountUrls.qrApprovalMatches(scoped,origin,false),"custom scoped QR denied");
  check(!ServerAccountUrls.qrApprovalMatches(basic,origin,false),"unscoped QR crossed into custom profile");
  check(!ServerAccountUrls.qrApprovalMatches(scoped,"https://other.example.com",false),"QR crossed between custom profiles");
  check(!ServerAccountUrls.qrApprovalMatches(scoped,"https://easybook.loonxy.com",true),"custom QR crossed into official profile");
  check(!ServerAccountUrls.qrApprovalMatches(scoped+"&server=other",origin,false),"duplicate server accepted");
  check(!ServerAccountUrls.qrApprovalMatches(scoped+"&id="+id,origin,false),"duplicate ID accepted");
  check(!ServerAccountUrls.qrApprovalMatches(basic,"http://192.168.1.3",false),"HTTP account approval accepted");
  System.out.println("PASS Android server account URLs: captured HTTPS origin and port, strict QR links, custom deep-link server binding, official compatibility");
 }
}`;
function run(args){const result=spawnSync('java',args,{cwd:root,encoding:'utf8',timeout:15000});assert.equal(result.status,0,[result.error,result.stdout,result.stderr].filter(Boolean).join('\n'));if(result.stdout)process.stdout.write(result.stdout);}
try{
 await writeFile(join(temp,'ServerAccountUrlsCheck.java'),harness);
 run(['-m','jdk.compiler/com.sun.tools.javac.Main','-d',temp,join(root,'app/src/main/java/com/feoearth/easybook/ServerAccountUrls.java'),join(temp,'ServerAccountUrlsCheck.java')]);
 run(['-cp',temp,'com.feoearth.easybook.ServerAccountUrlsCheck']);
}finally{await rm(temp,{recursive:true,force:true});}
