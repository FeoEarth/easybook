import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../worker/index.mjs';

const origin='https://easybook.loonxy.com';
const get=path=>worker.fetch(new Request(origin+path),{});
const legacy=await (await get('/ota/manifest.json')).json();
const current=await (await get('/ota/manifest.json?v=2')).json();

for(const [manifest,schema,names,minCode] of [
  [legacy,1,['index.html','editor.js'],102],
  [current,2,['index.html','editor.js','native_update.js'],102],
]){
  assert.equal(manifest.schema,schema);
  assert.equal(manifest.minNativeVersionCode,minCode);
  assert.deepEqual(manifest.files.map(file=>file.name),names);
  const hashes=[];
  for(const file of manifest.files){
    assert.equal(file.url,'/ota/'+file.name);
    const response=await get(file.url);
    assert.equal(response.status,200,file.name);
    assert.match(response.headers.get('cache-control')||'',/no-transform/);
    const sha256=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(file.sha256,sha256,file.name+' hash differs from download');
    hashes.push(sha256.slice(0,16));
  }
  assert.equal(manifest.revision,hashes.join('-'));
}
assert.deepEqual(current.files.slice(0,2),legacy.files);
console.log('Android OTA v1/v2 compatibility and all downloaded SHA-256 hashes verified');
