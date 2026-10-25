package com.feoearth.easybook;
import org.junit.Test;
import org.json.*;
import java.nio.file.*;
import java.lang.reflect.Field;
import static org.junit.Assert.*;
public class TableContractTest {
 private Path find(String path){Path p=Paths.get(path);return Files.exists(p)?p:Paths.get("..").resolve(path);}
 private String read(String path)throws Exception{return new String(Files.readAllBytes(find(path)),java.nio.charset.StandardCharsets.UTF_8);}
 @Test public void sameCanonicalTableAsWeb() throws Exception {
  String schema=read("app/src/main/assets/document-contract.json");
  assertEquals(read("shared/document-contract.json"),schema);
  Field contract=DocumentModel.class.getDeclaredField("contract");contract.setAccessible(true);contract.set(null,new JSONObject(schema));
  JSONObject fixture=new JSONObject(read("docs/table-contract-fixture.json"));
  assertTrue(DocumentModel.plain(DocumentModel.validate(new JSONObject(fixture.toString()))).contains("Cell A"));
  JSONObject table=fixture.getJSONObject("doc").getJSONArray("content").getJSONObject(0);
  table.getJSONArray("content").getJSONObject(0).getJSONArray("content").remove(0);
  try {DocumentModel.validate(fixture);fail("Ragged table accepted");} catch(IllegalArgumentException expected){}
 }
}
