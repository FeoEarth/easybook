// Verifies signed workspace ownership attestations from the sync Worker.
// No raw workspace keys or OAuth tokens are accepted by this verifier.
const hex=/^[a-f0-9]{64}$/;
const challengePattern=/^[A-Za-z0-9_-]{24,128}$/;
const decode = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
export async function verifyWorkspaceAssertion(assertion,signingKey,expectedChallenge){
 if(typeof assertion!=='string'||assertion.length>2048||typeof signingKey!=='string'||signingKey.length<32||!challengePattern.test(expectedChallenge))return null;
 const parts=assertion.split('.');
 if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
 try{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(signingKey),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('HMAC',key,decode(parts[1]),new TextEncoder().encode(parts[0]));
  if(!valid)return null;
  const data=JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const now=Math.floor(Date.now()/1000);
  if(data.v!==1||!hex.test(data.workspace||'')||data.challenge!==expectedChallenge||!Number.isSafeInteger(data.iat)||!Number.isSafeInteger(data.exp)||data.iat>now+30||data.exp<now||data.exp-data.iat>120)return null;
  return data.workspace;
 }catch{return null}
}
