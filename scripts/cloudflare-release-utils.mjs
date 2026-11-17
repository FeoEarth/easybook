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
