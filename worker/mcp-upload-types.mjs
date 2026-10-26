import {fail} from './mcp-common.mjs';
export const CHUNK=4*1024*1024,MAX_UPLOAD=50*1024*1024,MAX_BASE64=128*1024;
export const MIME=['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain'];
const ascii=(a,start,end)=>String.fromCharCode(...a.subarray(start,end));
export function sniff(prefix,tail,size,claimed){
 const v=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);let mime,width,height;
 if(prefix.length>=33&&prefix[0]===137&&ascii(prefix,1,8)==='PNG\r\n\x1a\n'){
  if(v.getUint32(8)!==13||ascii(prefix,12,16)!=='IHDR'||size<45||ascii(tail,tail.length-8,tail.length-4)!=='IEND')fail('INVALID_FILE','Invalid PNG structure');
  mime='image/png';width=v.getUint32(16);height=v.getUint32(20);
 }else if(prefix.length>=4&&prefix[0]===255&&prefix[1]===216&&prefix[2]===255){
  if(tail.at(-2)!==255||tail.at(-1)!==217)fail('INVALID_FILE','JPEG end marker missing');mime='image/jpeg';
  let i=2;while(i+4<prefix.length){if(prefix[i++]!==255)break;while(prefix[i]===255)i++;const marker=prefix[i++];if(marker===218||marker===217)break;if(marker===216||marker===1||marker>=208&&marker<=215)continue;if(i+2>prefix.length)break;const len=v.getUint16(i);if(len<2)fail('INVALID_FILE','Invalid JPEG segment');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&i+7<prefix.length){height=v.getUint16(i+3);width=v.getUint16(i+5);break}i+=len;}
  if(!width||!height)fail('INVALID_FILE','JPEG SOF header must occur within the first 64 KiB');
 }else if(prefix.length>=16&&ascii(prefix,0,4)==='RIFF'&&ascii(prefix,8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(ascii(prefix,12,16))){if(v.getUint32(4,true)+8!==size)fail('INVALID_FILE','WebP size mismatch');mime='image/webp';}
 else if(prefix.length>=13&&['GIF87a','GIF89a'].includes(ascii(prefix,0,6))){if(tail.at(-1)!==59)fail('INVALID_FILE','GIF trailer missing');mime='image/gif';width=v.getUint16(6,true);height=v.getUint16(8,true);}
 else if(prefix.length>=8&&ascii(prefix,0,5)==='%PDF-'&&/^%PDF-[12]\.[0-9]/.test(ascii(prefix,0,8))){mime='application/pdf';}
 else if(claimed==='text/plain'){mime='text/plain';}
 if(!mime||mime!==claimed)fail('MIME_MISMATCH','File signature does not match the declared MIME type');
 if(width!==undefined&&(!width||!height||width>10000||height>10000))fail('INVALID_FILE','Image dimensions exceed document limits');
 return {mime,...(width?{width,height}:{})};
}
export function decodeBase64(value){
 if(typeof value!=='string'||!value.length||value.length>Math.ceil(MAX_BASE64/3)*4||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('INVALID_BASE64','Invalid or oversized canonical Base64');
 const binary=atob(value);if(binary.length>MAX_BASE64)fail('FILE_TOO_LARGE','Base64 uploads are limited to 128 KiB');if(btoa(binary)!==value)fail('INVALID_BASE64','Noncanonical Base64');return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
