import assert from 'node:assert/strict';
const origin=process.argv[2];assert.ok(origin?.startsWith('https://'));
const health=await fetch(origin+'/health/ai-execution');assert.equal(health.status,200);assert.equal((await health.json()).serviceReady,true,'AI vault/service mismatch');
const protectedRoute=await fetch(origin+'/api/ai/config');assert.equal(protectedRoute.status,401,'AI account authentication preserved');
const privateRoute=await fetch(origin+'/api/ai/internal-readiness',{method:'POST'});assert.equal(privateRoute.status,404);
console.log('PASS deployed AI service readiness and unauthenticated denial; no credentials or real AI calls');
