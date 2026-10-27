import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const html=readFileSync('app/src/main/assets/index.html','utf8'),css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<style>'+css+'</style><script type="module">import {createVideoPlayer} from "/player.js";window.p=createVideoPlayer();document.body.append(p.root);window.ready=true;</script>');return}if(req.url==='/player.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync('editor/video-player.js'));return}if(['/playback.mp4','/playback.webm'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('mp4')?'video/mp4':'video/webm');res.end(readFileSync('scripts/fixtures'+req.url));return}res.writeHead(404).end()});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
 for(const ext of ['mp4','webm']){
  await page.evaluate(async ext=>{const blob=await(await fetch('/playback.'+ext)).blob();window.p.setFile({name:'sample.'+ext,mime:blob.type,url:URL.createObjectURL(blob)})},ext);
  await page.waitForFunction(()=>p.video.readyState>=2);await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>p.video.currentTime>.25&&p.video.getVideoPlaybackQuality().totalVideoFrames>0);
  await page.getByRole('button',{name:'暂停',exact:true}).click();const time=await page.evaluate(()=>p.video.currentTime);assert.ok(time>.25);
  await page.locator('input[aria-label="视频进度"]').fill('2');await page.waitForFunction(()=>Math.abs(p.video.currentTime-2)<.2);
  await page.getByRole('button',{name:'全屏',exact:true}).click();await page.waitForFunction(()=>document.fullscreenElement===p.root);assert.equal(await page.evaluate(()=>p.video.currentTime),2);assert.equal(await page.evaluate(()=>p.video.paused),true);
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement);assert.equal(await page.evaluate(()=>p.video.currentTime),2);
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>p.video.currentTime>2.1);await page.getByRole('button',{name:'暂停',exact:true}).click();console.log('PASS '+ext+': decoded frames, play/pause, seek, fullscreen continuity');
 }
 await page.evaluate(()=>p.setFile({name:'unsupported.mov',url:URL.createObjectURL(new Blob(['invalid video'],{type:'video/quicktime'}))}));await page.getByText('此设备不支持该视频编码或文件已损坏，请保存后打开').waitFor();await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('此设备不支持该视频编码或文件已损坏，请保存后打开').waitFor();console.log('PASS unsupported file: visible decode error and retry');
 assert.deepEqual(errors,[]);await page.evaluate(()=>p.destroy());assert.equal(await page.evaluate(()=>p.video.hasAttribute('src')),false);
}finally{await browser.close();await new Promise(r=>server.close(r))}
