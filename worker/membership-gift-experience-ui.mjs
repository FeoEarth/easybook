// Presentation only: the revealed code is copied in its original format.
export const giftExperienceCSS=String.raw`
.gift-preview{min-width:0;margin:4px 0 16px}
.gift-flip-stage{
 --card-depth:1.5px;--card-edge:#39334c;
 position:relative;min-width:0;padding:3px 1px 10px;perspective:1050px;touch-action:pan-y;
}
.gift-flip-object{
 --card-turn:0deg;
 position:relative;width:100%;min-height:190px;aspect-ratio:1.586;
 transform-style:preserve-3d;
 transform:rotateX(var(--card-tilt-x,0deg)) rotateY(var(--card-tilt-y,0deg)) rotateY(var(--card-turn));
 transition:transform .5s cubic-bezier(.24,.76,.26,1);
}
.gift-flip-stage.is-flipped .gift-flip-object{--card-turn:180deg}
.gift-card-art.gift-flip-face{
 position:absolute;inset:0;min-height:0;height:100%;margin:0;aspect-ratio:auto;
 backface-visibility:hidden;-webkit-backface-visibility:hidden;
 transform:translateZ(var(--card-depth));
}
/* The reverse keeps the original graphite and champagne finishes. */
.gift-card-art.gift-flip-back{
 --gift-glint:#cfe5ff38;--gift-brush-light:#e1eeff12;--gift-brush-dark:#090e172e;
 padding:clamp(16px,5vw,22px);justify-content:flex-start;gap:12px;
 color:#f0f4fa;
 background:linear-gradient(128deg,#19202a 0%,#3c495a 32%,#2b3542 58%,#1b222c 100%);
 border-color:#9fb7d64d;
 box-shadow:inset 0 1px 0 var(--gift-glint),inset 0 -1px 0 #0002,0 14px 26px -19px #0009;
 transform:rotateY(180deg) translateZ(var(--card-depth));
}
.gift-card-art.gift-flip-back.is-subscription{
 --gift-glint:#fff8df8c;--gift-brush-light:#fffcee42;--gift-brush-dark:#65553218;
 color:#302b21;
 background:linear-gradient(128deg,#b9a885 0%,#eee4cc 31%,#d1c09d 62%,#b6a27d 100%);
 border-color:#74603d45;
}
.gift-flip-back::before,.gift-flip-back::after{
 content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
}
.gift-flip-back::before{
 background:
  repeating-linear-gradient(0deg,var(--gift-brush-light) 0 1px,transparent 1px 4px,var(--gift-brush-dark) 4px 5px,transparent 5px 8px),
  repeating-linear-gradient(0deg,transparent 0 13px,var(--gift-brush-dark) 13px 14px,transparent 14px 19px);
 opacity:.7;
}
.gift-flip-back::after{
 background:radial-gradient(ellipse at 24% 0%,var(--gift-glint),transparent 68%),linear-gradient(152deg,#fff1 4%,transparent 44%,#0001 92%);
}
.gift-card-rim{
 position:absolute;inset:1px;border-radius:17px;
 background:var(--card-edge);pointer-events:none;
}
.gift-card-rim::before,.gift-card-rim::after{
 content:"";position:absolute;inset:12px auto;width:3px;
 background:var(--card-edge);transform:rotateY(90deg);
}
.gift-card-rim::before{left:-1.5px}
.gift-card-rim::after{right:-1.5px}
.gift-flip-trigger{
 position:absolute;inset:0;width:100%;border:0;border-radius:inherit;
 background:transparent;cursor:pointer;
}
.gift-flip-trigger:focus-visible{outline:2px solid var(--card-ink);outline-offset:-5px}
.gift-view-hint{margin:2px 4px 0;text-align:center;font-size:12px;color:var(--muted);line-height:1.5}
.gift-card-brand{display:flex;align-items:center;gap:5px;min-width:0;font-size:16px;font-weight:600;letter-spacing:-.5px}
.gift-brand-logo{display:block;flex:none;width:26px;height:26px;object-fit:contain;mix-blend-mode:screen}
.is-subscription .gift-brand-logo{mix-blend-mode:multiply}
.gift-code-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
.gift-code{margin:0;overflow-wrap:anywhere;user-select:all;font:500 14px/1.9 ui-monospace,SFMono-Regular,Consolas,monospace}
.gift-back-top{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:24px}
.gift-back-return{min-height:28px;padding:4px 7px;background:transparent;color:inherit;border:0;border-radius:8px;font-size:10px;opacity:.75;white-space:nowrap}
.gift-back-unavailable{font-size:12px;line-height:1.8;opacity:.7;margin:auto 0}
.gift-back-secret{position:relative;min-width:0;width:100%;margin:auto 0 0;display:grid;grid-template-columns:1fr auto;gap:4px}
.gift-back-secret .gift-code-heading{grid-column:1/-1;font-size:9px;min-height:18px;font-weight:500;letter-spacing:1px;opacity:.75}
.gift-back-secret .gift-code-hide{position:absolute;right:0;top:-8px;min-height:28px;color:inherit;font-size:10px}
.gift-back-secret .gift-secret{grid-column:1/-1;margin:2px 0 5px;border-color:currentColor;border-width:0;border-radius:8px;background:transparent;min-width:0}
.gift-back-secret .gift-secret .gift-code{display:block;min-height:42px;padding:4px 0;font-size:clamp(11px,3.4vw,14px);line-height:1.5;letter-spacing:1px;color:inherit;font-variant-numeric:tabular-nums}
.gift-back-secret .gift-spoiler{padding:0;gap:0;color:inherit;background:transparent;border-radius:8px}
.gift-back-copy{display:block;grid-column:2;justify-self:end;width:auto;min-height:28px;padding:3px 0 3px 10px;border-radius:8px;border:0;background:transparent;color:inherit;font-size:11px;letter-spacing:.3px}
.gift-back-copy svg{width:13px;height:13px;vertical-align:middle;margin-right:5px}
.gift-back-copy:disabled{opacity:.3}
.gift-code-hide{min-height:40px;padding:6px 8px;background:transparent;color:var(--action);font-size:12px;border-radius:10px}
.gift-secret{position:relative;isolation:isolate;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--fill);margin:10px 0 14px}
.gift-secret .gift-code{min-height:88px;margin:0;border:0;background:transparent;border-radius:0;display:flex;align-items:center;letter-spacing:.6px;white-space:normal}
.gift-spoiler{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:15px;color:var(--ink);background:var(--fill);border-radius:13px;font-size:13px;overflow:hidden;z-index:1;transition:opacity .32s ease,filter .32s ease,visibility .32s;cursor:pointer}
.gift-spoiler-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.gift-secret .gift-code.is-concealed{color:transparent!important;user-select:none}
.gift-secret.is-revealed .gift-spoiler{opacity:1;filter:none;visibility:visible;pointer-events:none}
.gift-dust-fallback{position:absolute;width:1px;height:1px;border-radius:50%;background:currentColor}
@media(max-width:359px){
 .gift-card-art.gift-flip-back{gap:7px}
 .gift-back-top .gift-card-brand{font-size:12px}
 .gift-back-secret .gift-secret .gift-code{min-height:36px;line-height:1.4;font-size:11px}
}
@media(prefers-reduced-motion:reduce){
 .gift-flip-object{--card-tilt-x:0deg;--card-tilt-y:0deg;transition:none}
}
`;
export const giftExperienceScript=String.raw`
let giftExperienceDisposers=[];
function disposeGiftExperience(){
 for(const cleanup of giftExperienceDisposers.splice(0))cleanup();
}

function createGiftPreview(card){
 const subscription=card.kind==='subscription'?card:null;
 const theme=subscription?' is-subscription':'';
 const preview=text('section','','gift-preview');
 const stage=text('div','','gift-flip-stage'+theme);
 const object=text('div','','gift-flip-object');
 const rim=text('div','','gift-card-rim');
 const front=giftArtwork(card.value,{subscription});
 const back=text('div','','gift-card-art gift-flip-face gift-flip-back'+theme);
 const trigger=text('button','','gift-flip-trigger');
 const hint=text('p','轻点卡片，查看背面','gift-view-hint');
 const top=text('div','','gift-back-top');
 const returnButton=text('button','返回正面','gift-back-return');
 const brand=text('div','Easybook','gift-card-brand');
 const logo=document.createElement('img');
 logo.className='gift-brand-logo';
 logo.src=subscription?'/favicon-light.png':'/favicon-dark.png';
 logo.alt='';
 brand.prepend(logo);
 const secret=card.code?createGiftSecretPanel(card):null;

 preview.setAttribute('aria-label','礼品卡预览');
 rim.setAttribute('aria-hidden','true');
 trigger.type=returnButton.type='button';
 trigger.setAttribute('aria-label','翻到背面查看卡号');
 front.classList.add('gift-flip-face');
 front.append(trigger);
 top.append(brand,returnButton);
 back.append(top,secret||text('p',card.status==='revoked'?'卡片已作废':'卡片已兑换','gift-back-unavailable'));
 back.setAttribute('aria-hidden','true');
 back.inert=true;
 object.append(rim,front,back);
 stage.append(object);
 hint.setAttribute('aria-live','polite');
 preview.append(stage,hint);

 let flipped=false;
 function resetTilt(){
  stage.style.removeProperty('--card-tilt-x');
  stage.style.removeProperty('--card-tilt-y');
 }
 function flip(){
  const moveFocus=object.contains(document.activeElement);
  if(flipped)secret?.concealGiftCode();
  resetTilt();
  flipped=!flipped;
  stage.classList.toggle('is-flipped',flipped);
  front.setAttribute('aria-hidden',String(flipped));
  back.setAttribute('aria-hidden',String(!flipped));
  front.inert=flipped;
  back.inert=!flipped;
  secret?.setGiftActive(flipped);
  hint.textContent=flipped?'轻点卡片空白处，返回正面':'轻点卡片，查看背面';
  if(moveFocus)(flipped?returnButton:trigger).focus({preventScroll:true});
 }
 trigger.onclick=returnButton.onclick=flip;
 back.onclick=event=>{if(!event.target.closest('button,code'))flip()};
 stage.addEventListener('pointermove',event=>{
  if(flipped||event.pointerType!=='mouse'||reducedMotion?.matches)return;
  const bounds=stage.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  const x=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));
  const y=Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height));
  stage.style.setProperty('--card-tilt-x',((.5-y)*7).toFixed(2)+'deg');
  stage.style.setProperty('--card-tilt-y',((x-.5)*10).toFixed(2)+'deg');
 });
 stage.addEventListener('pointerleave',resetTilt);
 return preview;
}

// Fine, independently fading particles occupy text line bounds, never a tiled grid.
function createGiftSpoilerDust(button,code){
 const canvas=document.createElement('canvas');canvas.className='gift-spoiler-canvas';canvas.setAttribute('aria-hidden','true');button.append(canvas);const ctx=canvas.getContext('2d');let active=false,disposed=false,frame=null,last=-100,particles=[],width=0,height=0,ink='',reveal=null,needsMeasure=true;
 function stop(){if(frame!==null){cancelAnimationFrame(frame);frame=null}}
 function seed(now){if(!code.isConnected)return;width=button.clientWidth;height=button.clientHeight;if(!width||!height)return;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.ceil(width*dpr);canvas.height=Math.ceil(height*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);ink=getComputedStyle(button).color;let bounds=[];
  // Use local font metrics: viewport rectangles distort while the card flips.
  const style=getComputedStyle(code),fontSize=parseFloat(style.fontSize)||12,lineHeight=parseFloat(style.lineHeight)||fontSize*1.5,spacing=parseFloat(style.letterSpacing)||0,left=parseFloat(style.paddingLeft)||0,top=parseFloat(style.paddingTop)||0,available=code.clientWidth-left-(parseFloat(style.paddingRight)||0);if(ctx)ctx.font=style.font;const measure=word=>(ctx?ctx.measureText(word).width:word.length*fontSize*.6)+word.length*spacing,space=measure(' ');let lineWidth=0,line=0;for(const word of (code.textContent||'').split(' ')){const w=measure(word);if(lineWidth&&lineWidth+space+w>available){bounds.push({x:left,y:top+line*lineHeight+(lineHeight-fontSize)/2,w:Math.min(available,lineWidth),h:fontSize});line++;lineWidth=0}lineWidth+=(lineWidth?space:0)+w}if(lineWidth)bounds.push({x:left,y:top+line*lineHeight+(lineHeight-fontSize)/2,w:Math.min(available,lineWidth),h:fontSize});
  if(!bounds.length)bounds=[{x:0,y:height*.3,w:width,h:height*.35}];particles=[];for(const b of bounds){const count=Math.min(450,Math.ceil(b.w*b.h*.095));for(let i=0;i<count;i++){const life=750+Math.random()*1500;particles.push({b,x:Math.random()*b.w,y:Math.random()*b.h,r:.2+Math.random()**2*.6,alpha:.2+Math.random()*.55,vx:(Math.random()-.5)*2,vy:(Math.random()-.5)*2,life,born:now-Math.random()*life})}}
  if(!ctx){for(const old of button.querySelectorAll('.gift-dust-fallback'))old.remove();for(const p of particles.slice(0,240)){const dot=text('span','','gift-dust-fallback');dot.setAttribute('aria-hidden','true');dot.style.left=(p.b.x+p.x)+'px';dot.style.top=(p.b.y+p.y)+'px';dot.style.opacity=String(p.alpha);button.append(dot)}}needsMeasure=false;
 }
 function draw(now){frame=null;if(disposed||!active||document.hidden)return;if(needsMeasure)seed(now);if(!ctx)return;if(now-last<32&&!reducedMotion?.matches){frame=requestAnimationFrame(draw);return}last=now;ctx.clearRect(0,0,width,height);const progress=reveal?Math.min(1,(now-reveal.at)/440):0;if(reveal&&(reducedMotion?.matches||progress>=1))return;ctx.fillStyle=ink;
  for(const p of particles){let age=(now-p.born)/p.life;if(age>1){p.born=now;p.x=Math.random()*p.b.w;p.y=Math.random()*p.b.h;age=0}const seconds=(now-p.born)/1000,x=p.b.x+(p.x+p.vx*seconds+p.b.w)%p.b.w,y=p.b.y+(p.y+p.vy*seconds+p.b.h)%p.b.h;let alpha=p.alpha*(.15+.85*Math.sin(Math.PI*age)**.7);if(reveal){const radius=reveal.radius*(1-(1-progress)**3),distance=Math.hypot(x-reveal.x,y-reveal.y);alpha*=Math.max(0,Math.min(1,(distance-radius)/8))}ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(x,y,p.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;if(!reducedMotion?.matches)frame=requestAnimationFrame(draw);
 }
 function resume(){stop();if(active&&!disposed&&!document.hidden)frame=requestAnimationFrame(draw)}
 const onResize=()=>{needsMeasure=true;resume()},observer=typeof ResizeObserver==='function'?new ResizeObserver(onResize):null;observer?.observe(code);if(!observer)window.addEventListener('resize',onResize);const onVisibility=()=>{if(document.hidden)stop();else resume()},onPreference=()=>resume();document.addEventListener('visibilitychange',onVisibility);reducedMotion?.addEventListener?.('change',onPreference);
 return {setActive(value){active=value;resume()},reset(){reveal=null;needsMeasure=true;for(const dot of button.querySelectorAll('.gift-dust-fallback'))dot.hidden=false;resume()},reveal(x,y){reveal={x,y,at:performance.now(),radius:Math.max(Math.hypot(x,y),Math.hypot(width-x,y),Math.hypot(x,height-y),Math.hypot(width-x,height-y))+12};for(const dot of button.querySelectorAll('.gift-dust-fallback'))dot.hidden=true;resume()},destroy(){disposed=true;stop();observer?.disconnect();window.removeEventListener('resize',onResize);document.removeEventListener('visibilitychange',onVisibility);reducedMotion?.removeEventListener?.('change',onPreference)}};
}
function createGiftSecretPanel(card){
 const panel=text('section','','gift-back-secret'),heading=text('div','','gift-code-heading'),hide=text('button','隐藏','gift-code-hide'),secret=text('div','','gift-secret'),code=text('code','','gift-code'),spoiler=text('button','','gift-spoiler'),copy=text('button','复制卡号','gift-back-copy');
 const codeId='gift-secret-'+crypto.randomUUID();code.id=codeId;spoiler.type=hide.type=copy.type='button';spoiler.setAttribute('aria-label','显示卡号');spoiler.setAttribute('aria-controls',codeId);spoiler.setAttribute('aria-expanded','false');heading.append(text('span','卡号'),hide);secret.append(code,spoiler);panel.setAttribute('aria-label','礼品卡卡号');panel.append(heading,secret,copy);
 const dust=createGiftSpoilerDust(spoiler,code);let visible=false,timer=null,copyTimer=null,disposed=false;
 function conceal(){visible=false;clearTimeout(timer);clearTimeout(copyTimer);activeMotions.get(code)?.cancel();const focused=secret.contains(document.activeElement)||document.activeElement===hide||document.activeElement===copy;code.classList.add('is-concealed');code.textContent=card.code.split('-').map(group=>'0'.repeat(group.length)).join(' ');dust.reset();code.setAttribute('aria-hidden','true');secret.classList.remove('is-revealed');spoiler.disabled=false;spoiler.tabIndex=0;spoiler.setAttribute('aria-expanded','false');hide.hidden=true;copy.disabled=true;copy.textContent='复制卡号';if(focused&&panel.isConnected&&!document.hidden&&!disposed)spoiler.focus({preventScroll:true})}
 spoiler.onclick=e=>{if(disposed||visible)return;visible=true;code.classList.remove('is-concealed');code.textContent=card.code.split('-').join(' ');code.removeAttribute('aria-hidden');secret.classList.add('is-revealed');spoiler.setAttribute('aria-expanded','true');spoiler.disabled=true;spoiler.tabIndex=-1;hide.hidden=false;copy.disabled=false;copy.textContent='复制卡号';const r=secret.getBoundingClientRect(),x=e.detail?Math.max(0,Math.min(r.width,e.clientX-r.left)):r.width/2,y=e.detail?Math.max(0,Math.min(r.height,e.clientY-r.top)):r.height/2;dust.reveal(x,y);motion(code,[{clipPath:'circle(0px at '+x+'px '+y+'px)',opacity:.3},{clipPath:'circle('+Math.hypot(r.width,r.height)+'px at '+x+'px '+y+'px)',opacity:1}],{duration:420});timer=setTimeout(conceal,30000);if(e.detail===0)copy.focus({preventScroll:true})};hide.onclick=()=>{conceal();spoiler.focus({preventScroll:true})};copy.onclick=async()=>{if(!visible||disposed)return;try{await navigator.clipboard.writeText(card.code);if(disposed||!visible)return;copy.replaceChildren(icon('check'),document.createTextNode('已复制'));notify('兑换码已复制');clearTimeout(copyTimer);copyTimer=setTimeout(()=>{if(visible&&!disposed)copy.textContent='复制卡号'},1800)}catch{if(!disposed)el('paymentMessage').textContent='请长按卡号复制。'}};panel.concealGiftCode=conceal;panel.setGiftActive=value=>dust.setActive(value);const onVisibility=()=>{if(document.hidden)conceal()};document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',conceal);conceal();giftExperienceDisposers.push(()=>{disposed=true;conceal();dust.destroy();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',conceal)});return panel;
}
`;
