// Newly uploaded versions may briefly be absent from the version-detail API.
// Retry only that documented response shape; never retry a promotion or write.
export async function readUploadedVersion(read,{attempts=6,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<attempts;attempt++){
  try{return await read()}
  catch(error){
   if(error.status!==404||!error.errors?.some(item=>item.code===100146)||attempt===attempts-1)throw error;
   await wait(Math.min(500*2**attempt,4000));
  }
 }
}

export function scriptUploadVersion(result){
 const id=result?.deployment_id;
 if(typeof id==='string'&&/^[a-f0-9]{32}$/i.test(id))return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
 if(typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return id;
 throw Error('Upload did not return an exact Worker version ID');
}
export async function readDeployment(read,accept,{attempts=8,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<attempts;attempt++){
  const deployment=await read();
  if(accept(deployment))return deployment;
  if(attempt<attempts-1)await wait(Math.min(500*2**attempt,4000));
 }
 throw Error('Deployment verification timed out: expected version did not become visible');
}
