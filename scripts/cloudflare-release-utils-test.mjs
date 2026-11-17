import assert from 'node:assert/strict';
import {readUploadedVersion} from './cloudflare-release-utils.mjs';
const missing=()=>Object.assign(Error('Version not visible'),{status:404,errors:[{code:100146}]});
let calls=0;const delays=[];
assert.deepEqual(await readUploadedVersion(async()=>{if(++calls<4)throw missing();return {id:'candidate'}},{wait:async ms=>delays.push(ms)}),{id:'candidate'});
assert.equal(calls,4);assert.deepEqual(delays,[500,1000,2000]);
calls=0;await assert.rejects(readUploadedVersion(async()=>{calls++;throw missing()},{wait:async()=>{}}));assert.equal(calls,6);
for(const error of [Object.assign(Error('Denied'),{status:403}),Object.assign(Error('Other 404'),{status:404,errors:[{code:10007}]}),Error('Network')]){
 calls=0;await assert.rejects(readUploadedVersion(async()=>{calls++;throw error},{wait:async()=>{}}),value=>value===error);assert.equal(calls,1);
}
console.log('Candidate version reads: bounded transient-404 retry, immediate authorization/other-error failure OK');
