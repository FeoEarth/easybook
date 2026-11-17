import assert from 'node:assert/strict';
import {readUploadedVersion,scriptUploadVersion,readDeployment} from './cloudflare-release-utils.mjs';
const missing=()=>Object.assign(Error('Version not visible'),{status:404,errors:[{code:100146}]});
let calls=0;const delays=[];
assert.deepEqual(await readUploadedVersion(async()=>{if(++calls<4)throw missing();return {id:'candidate'}},{wait:async ms=>delays.push(ms)}),{id:'candidate'});
assert.equal(calls,4);assert.deepEqual(delays,[500,1000,2000]);
calls=0;await assert.rejects(readUploadedVersion(async()=>{calls++;throw missing()},{wait:async()=>{}}));assert.equal(calls,6);
for(const error of [Object.assign(Error('Denied'),{status:403}),Object.assign(Error('Other 404'),{status:404,errors:[{code:10007}]}),Error('Network')]){
 calls=0;await assert.rejects(readUploadedVersion(async()=>{calls++;throw error},{wait:async()=>{}}),value=>value===error);assert.equal(calls,1);
}
console.log('Candidate version reads: bounded transient-404 retry, immediate authorization/other-error failure OK');

assert.equal(scriptUploadVersion({deployment_id:'0123456789abcdef0123456789abcdef'}),'01234567-89ab-cdef-0123-456789abcdef');
assert.equal(scriptUploadVersion({deployment_id:'01234567-89ab-cdef-0123-456789abcdef'}),'01234567-89ab-cdef-0123-456789abcdef');
assert.throws(()=>scriptUploadVersion({deployment_id:'unknown'}));
calls=0;const expected={versions:[{version_id:'exact-candidate',percentage:100}]};
assert.equal(await readDeployment(async()=>++calls<3?{versions:[{version_id:'old'}]}:expected,d=>d.versions[0].version_id==='exact-candidate',{wait:async()=>{}}),expected);assert.equal(calls,3);
calls=0;await assert.rejects(readDeployment(async()=>{calls++;return {versions:[{version_id:'other'}]}},()=>false,{wait:async()=>{}}),/timed out/);assert.equal(calls,8);
calls=0;await assert.rejects(readDeployment(async()=>{calls++;throw Error('Denied')},()=>true,{wait:async()=>{}}),/Denied/);assert.equal(calls,1);
console.log('Exact-version deployment polling, bounded mismatch failure and upload-ID normalization OK');
