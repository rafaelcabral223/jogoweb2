'use strict';

// ── Canvas ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const GW = 1280, GH = 640;
canvas.width = GW; canvas.height = GH;
ctx.imageSmoothingEnabled = false;

function fitCanvas(){
  const r=GW/GH,ww=window.innerWidth,wh=window.innerHeight;
  let cw,ch;
  if(ww/wh>r){ch=wh;cw=wh*r;}else{cw=ww;ch=ww/r;}
  canvas.style.cssText=`position:fixed;image-rendering:auto;width:${cw}px;height:${ch}px;left:${(ww-cw)/2}px;top:${(wh-ch)/2}px`;
}
window.addEventListener('resize',fitCanvas); fitCanvas();

// ── Character configs ──────────────────────────────────────────────────────────
const CHARS={
  cabral: {label:'Cabral', file:'spritesheet_cabral.png', colW:911/4,
    stand:{col:1,y:60,h:326},walk:{y:697,h:207,frames:4},jump:{y:962,h:216,col:2},
    scale:0.96,bgSat:20,bgBrMin:88,bgBrMax:180},
  bruno:  {label:'Bruno',  file:'spritesheet_bruno.png',  colW:896/4,
    stand:{col:1,y:59,h:326},walk:{y:695,h:208,frames:4},jump:{y:959,h:207,col:2},
    scale:0.96,bgSat:20,bgBrMin:88,bgBrMax:180},
  lisboa: {label:'Lisboa', file:'spritesheet_lisboa.png', colW:896/4,
    stand:{col:1,y:60,h:325},walk:{y:694,h:207,frames:4},jump:{y:957,h:209,col:2},
    scale:0.96,bgSat:20,bgBrMin:88,bgBrMax:180},
  anna:   {label:'Anna',   file:'spritesheet_anna.png',   colW:1822/4,
    stand:{col:1,y:118,h:662},walk:{y:1394,h:425,frames:4},jump:{y:1924,h:440,col:2},
    scale:0.47,bgSat:22,bgBrMin:85,bgBrMax:180},
  arcanjo:{label:'Arcanjo',file:'spritesheet_arcanjo.png',colW:1822/4,
    stand:{col:1,y:121,h:649},walk:{y:1394,h:416,frames:4},jump:{y:1924,h:433,col:2},
    scale:0.47,bgSat:22,bgBrMin:85,bgBrMax:180},
};
const CHAR_KEYS=Object.keys(CHARS);

// ── Background removal ─────────────────────────────────────────────────────────
function removeBackground(img,satT,brMin,brMax){
  const oc=document.createElement('canvas');
  oc.width=img.width; oc.height=img.height;
  const c2=oc.getContext('2d');
  c2.drawImage(img,0,0);
  const id=c2.getImageData(0,0,img.width,img.height),d=id.data;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    const sat=Math.max(r,g,b)-Math.min(r,g,b),br=(r+g+b)/3;
    if(sat<satT&&br>brMin&&br<brMax)d[i+3]=0;
  }
  c2.putImageData(id,0,0); return oc;
}

// ── Portrait bounds ────────────────────────────────────────────────────────────
function computePortraitBounds(c){
  const p=c.stand,cw=Math.ceil(c.colW),ch=p.h;
  const oc=document.createElement('canvas');
  oc.width=cw; oc.height=ch;
  const oc2=oc.getContext('2d');
  oc2.drawImage(c.canvas,p.col*c.colW,p.y,c.colW,ch,0,0,cw,ch);
  const px=oc2.getImageData(0,0,cw,ch).data;
  let x0=cw,x1=0;
  for(let y=0;y<ch;y++) for(let x=0;x<cw;x++)
    if(px[(y*cw+x)*4+3]>15){if(x<x0)x0=x;if(x>x1)x1=x;}
  const PAD=4;
  c.portBounds={x:Math.max(0,x0-PAD),w:Math.min(cw,x1+PAD)-Math.max(0,x0-PAD)};
}

// ── Loading ────────────────────────────────────────────────────────────────────
let loadedCount=0;
function loadAllChars(){
  CHAR_KEYS.forEach(key=>{
    const c=CHARS[key]; c.img=new Image();
    c.img.onload=()=>{
      c.canvas=removeBackground(c.img,c.bgSat,c.bgBrMin,c.bgBrMax);
      computePortraitBounds(c);
      if(++loadedCount===CHAR_KEYS.length) gameState='start';
    };
    c.img.onerror=()=>{
      c.canvas=Object.assign(document.createElement('canvas'),{width:1,height:1});
      if(++loadedCount===CHAR_KEYS.length) gameState='start';
    };
    c.img.src=c.file;
  });
}

// ── Constants ──────────────────────────────────────────────────────────────────
const PLAYER_X   = 220;
const GROUND_Y   = GH-120;
const BASE_SPEED = 5;
const MAX_SPEED  = 13;
const SPEED_RAMP = 18000;   // worldX over which speed goes base→max
const TIMER_START= 30;      // starting seconds
// Coffee time bonus: starts at 10s, drops 1s per 1200 world units, min 2s
function coffeeBonus(){ return Math.max(2, 10-Math.floor(worldX/1200)); }

const COIN_R   = 14;   // coin radius
const COFFEE_R = 20;   // coffee radius

// City silhouette
const BUILDINGS=[
  {rx:0,w:140,h:220},{rx:180,w:90,h:300},{rx:310,w:200,h:180},
  {rx:560,w:110,h:260},{rx:720,w:160,h:200},{rx:930,w:80,h:340},
  {rx:1060,w:190,h:220},{rx:1310,w:120,h:280},{rx:1480,w:150,h:190},
  {rx:1680,w:100,h:310},{rx:1830,w:180,h:240},{rx:2070,w:130,h:260},
  {rx:2250,w:200,h:190},{rx:2500,w:90,h:350},{rx:2640,w:160,h:210},
];
const BLDG_REPEAT=2900;
const CLOUD_REPEAT=2560;
const CLOUDS=[
  {wx:130,y:70,w:290,h:88},{wx:520,y:45,w:210,h:68},
  {wx:900,y:100,w:340,h:96},{wx:1310,y:55,w:255,h:80},
  {wx:1760,y:35,w:220,h:72},{wx:2210,y:80,w:305,h:92},
];

// ── Game state ─────────────────────────────────────────────────────────────────
let gameState='loading';
let activeChar=null;
let dCW,dWH,dJH;

let worldX=0, score=0, timeLeft=TIMER_START, timerMs=0;
let gameOverReason='', currentSpeed=BASE_SPEED;

// Separate arrays for coins and coffees
const obstacles=[], coins=[], coffees=[], popups=[];
let nextObsWX=1200, nextCoinWX=500, nextCoffeeWX=0;

// ── Player ─────────────────────────────────────────────────────────────────────
const player={
  y:GROUND_Y, vy:0, onGround:true,
  facing:'right', state:'idle',
  animFrame:0, animTimer:0, ANIM_SPEED:110,
  JUMP_VY:16, GRAVITY:0.55,
};

function resetPlayer(){
  worldX=0; score=0; timeLeft=TIMER_START; timerMs=0;
  currentSpeed=BASE_SPEED;
  obstacles.length=0; coins.length=0; coffees.length=0; popups.length=0;
  nextObsWX=1200; nextCoinWX=500;
  // First coffee appears randomly between 2000–4000 world units
  nextCoffeeWX=2000+Math.random()*2000;
  gameOverReason='';
  Object.assign(player,{y:GROUND_Y,vy:0,onGround:true,
    facing:'right',state:'idle',animFrame:0,animTimer:0});
}

// ── Input ──────────────────────────────────────────────────────────────────────
const keys={};
window.addEventListener('keydown',e=>{
  if(gameState!=='playing') return;
  if(keys[e.key]) return;
  keys[e.key]=true;
  if((e.key==='p'||e.key==='P'||e.key===' '||e.key==='ArrowUp')&&player.onGround){
    player.vy=-player.JUMP_VY;
    player.onGround=false; player.state='jumping'; player.animFrame=0;
    e.preventDefault();
  }
});
window.addEventListener('keyup',e=>{keys[e.key]=false;});

// ── Spawning ───────────────────────────────────────────────────────────────────
function spawnObjects(){
  const prog=Math.min(worldX/SPEED_RAMP,1);

  // Obstacles
  const minGap=800-prog*350, maxGap=1400-prog*400;
  while(worldX+GW>nextObsWX){
    obstacles.push({wx:nextObsWX,w:Math.floor(50+Math.random()*30),h:Math.floor(85+prog*80+Math.random()*35)});
    nextObsWX+=minGap+Math.random()*(maxGap-minGap);
  }

  // Coins — less frequent, clusters of 1–3
  while(worldX+GW>nextCoinWX){
    const cluster=1+Math.floor(Math.random()*3);
    const baseY=GROUND_Y-70-Math.random()*110;
    for(let k=0;k<cluster;k++)
      coins.push({wx:nextCoinWX+k*40, y:baseY, collected:false});
    nextCoinWX+=550+Math.random()*450;
  }

  // Coffees — rare, random gap 2000–4500 world units
  while(worldX+GW>nextCoffeeWX){
    coffees.push({wx:nextCoffeeWX, y:GROUND_Y-110-Math.random()*80, collected:false});
    nextCoffeeWX+=2000+Math.random()*2500;
  }

  // Cleanup
  while(obstacles.length&&obstacles[0].wx<worldX-200) obstacles.shift();
  while(coins.length    &&coins[0].wx    <worldX-200) coins.shift();
  while(coffees.length  &&coffees[0].wx  <worldX-200) coffees.shift();
}

function checkCollisions(){
  const px1=PLAYER_X+dCW*0.22, px2=PLAYER_X+dCW*0.78;
  const py1=player.y-dWH*0.88, py2=player.y;
  const pcx=(px1+px2)/2, pcy=(py1+py2)/2;

  // Obstacles → game over
  for(const obs of obstacles){
    const ox=obs.wx-worldX+PLAYER_X;
    if(px1<ox+obs.w&&px2>ox&&py1<GROUND_Y&&py2>GROUND_Y-obs.h){
      gameState='gameover'; gameOverReason='obstacle'; return;
    }
  }

  // Coins → score++
  for(const c of coins){
    if(c.collected) continue;
    const sx=c.wx-worldX+PLAYER_X;
    if(Math.hypot(pcx-sx,pcy-c.y)<COIN_R+dCW*0.22){
      c.collected=true; score++;
      popups.push({x:sx,y:c.y,text:'+1',color:'#ffe033',life:900,maxLife:900});
    }
  }

  // Coffees → time bonus (decreasing)
  for(const cf of coffees){
    if(cf.collected) continue;
    const sx=cf.wx-worldX+PLAYER_X;
    if(Math.hypot(pcx-sx,pcy-cf.y)<COFFEE_R+dCW*0.25){
      cf.collected=true;
      const bonus=coffeeBonus();
      timeLeft=Math.min(timeLeft+bonus,99);
      popups.push({x:sx,y:cf.y,text:`+${bonus}s`,color:'#7de8ff',life:1200,maxLife:1200});
    }
  }
}

// ── Update ─────────────────────────────────────────────────────────────────────
function update(dt){
  const prog=Math.min(worldX/SPEED_RAMP,1);
  currentSpeed=BASE_SPEED+prog*prog*(MAX_SPEED-BASE_SPEED); // quadratic: gentle start
  worldX+=currentSpeed;

  timerMs+=dt;
  if(timerMs>=1000){timerMs-=1000; timeLeft--;}
  if(timeLeft<=0){gameState='gameover'; gameOverReason='time'; return;}

  spawnObjects();

  if(!player.onGround){
    player.vy+=player.GRAVITY;
    player.y +=player.vy;
    if(player.y>=GROUND_Y){
      player.y=GROUND_Y; player.vy=0;
      player.onGround=true; player.state='idle'; player.animFrame=0;
    }
  }
  if(player.onGround) player.state='walking';
  player.facing='right';
  player.animTimer+=dt;
  if(player.animTimer>=player.ANIM_SPEED){player.animTimer-=player.ANIM_SPEED; player.animFrame++;}

  for(let i=popups.length-1;i>=0;i--){
    popups[i].life-=dt;
    if(popups[i].life<=0) popups.splice(i,1);
  }

  checkCollisions();
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
function blit(px,py,sx,sy,sw,sh,dw,dh,flipH){
  ctx.save();
  if(flipH){ctx.translate(px+dw,0);ctx.scale(-1,1);ctx.drawImage(activeChar.canvas,sx,sy,sw,sh,0,py,dw,dh);}
  else ctx.drawImage(activeChar.canvas,sx,sy,sw,sh,px,py,dw,dh);
  ctx.restore();
}

function drawPlayer(){
  const ac=activeChar,px=PLAYER_X;
  if(player.state==='jumping')
    blit(px,player.y-dJH,ac.jump.col*ac.colW,ac.jump.y,ac.colW,ac.jump.h,dCW,dJH,false);
  else
    blit(px,player.y-dWH,(player.animFrame%ac.walk.frames)*ac.colW,ac.walk.y,ac.colW,ac.walk.h,dCW,dWH,false);
}

function drawBackground(){
  const sky=ctx.createLinearGradient(0,0,0,GROUND_Y);
  sky.addColorStop(0,'#1a3a6e'); sky.addColorStop(0.6,'#4a90d9'); sky.addColorStop(1,'#a8d8f0');
  ctx.fillStyle=sky; ctx.fillRect(0,0,GW,GROUND_Y);

  ctx.fillStyle='#1e2d45';
  const co=worldX*0.05;
  BUILDINGS.forEach(b=>{
    for(let rep=-1;rep<=1;rep++){
      const bx=(b.rx-co%BLDG_REPEAT+BLDG_REPEAT*(rep+1))%BLDG_REPEAT-b.w/2;
      if(bx+b.w<0||bx>GW) return;
      ctx.fillRect(bx,GROUND_Y-b.h,b.w,b.h);
      ctx.fillStyle='rgba(255,230,100,0.15)';
      for(let wy=GROUND_Y-b.h+15;wy<GROUND_Y-20;wy+=28)
        for(let wx2=bx+12;wx2<bx+b.w-12;wx2+=22)
          ctx.fillRect(wx2,wy,10,14);
      ctx.fillStyle='#1e2d45';
    }
  });

  ctx.fillStyle='rgba(255,255,255,0.85)';
  const cOff=worldX*0.25%CLOUD_REPEAT;
  CLOUDS.forEach(cl=>{
    for(let rep=-1;rep<=1;rep++){
      const sx=cl.wx-cOff+rep*CLOUD_REPEAT;
      if(sx+cl.w<0||sx>GW) return;
      drawCloud(sx,cl.y,cl.w,cl.h);
    }
  });

  ctx.fillStyle='#5a3a1a'; ctx.fillRect(0,GROUND_Y,GW,GH-GROUND_Y);
  ctx.fillStyle='#4a9c2a'; ctx.fillRect(0,GROUND_Y,GW,12);
  ctx.fillStyle='#62c038'; ctx.fillRect(0,GROUND_Y,GW,5);
  ctx.fillStyle='rgba(0,0,0,0.1)';
  const tOff=worldX%70;
  for(let x=-tOff;x<GW;x+=70) ctx.fillRect(x,GROUND_Y+1,2,11);
}

function drawCloud(x,y,w,h){
  ctx.beginPath();
  const r=h/2;
  ctx.arc(x+w*0.25,y+r,r*0.8,Math.PI,0);
  ctx.arc(x+w*0.5, y+r*0.4,r,Math.PI,0);
  ctx.arc(x+w*0.75,y+r,r*0.7,Math.PI,0);
  ctx.closePath(); ctx.fill();
}

function drawObstacles(){
  obstacles.forEach(obs=>{
    const sx=obs.wx-worldX+PLAYER_X;
    if(sx+obs.w<0||sx>GW) return;
    const oy=GROUND_Y-obs.h;
    ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(sx+4,GROUND_Y-4,obs.w,6);
    const g=ctx.createLinearGradient(sx,oy,sx+obs.w,oy);
    g.addColorStop(0,'#8b2020'); g.addColorStop(0.5,'#c0392b'); g.addColorStop(1,'#8b2020');
    ctx.fillStyle=g; ctx.fillRect(sx,oy,obs.w,obs.h);
    ctx.fillStyle='rgba(255,255,255,0.1)'; ctx.fillRect(sx+4,oy+4,obs.w-8,6);
    ctx.strokeStyle='#6b1515'; ctx.lineWidth=2; ctx.strokeRect(sx,oy,obs.w,obs.h);
    ctx.strokeStyle='rgba(255,220,0,0.9)'; ctx.lineWidth=3;
    const cx2=sx+obs.w/2,cy2=oy+obs.h/2,s2=Math.min(obs.w,obs.h)*0.22;
    ctx.beginPath(); ctx.moveTo(cx2-s2,cy2-s2); ctx.lineTo(cx2+s2,cy2+s2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2+s2,cy2-s2); ctx.lineTo(cx2-s2,cy2+s2); ctx.stroke();
  });
}

function drawCoins(){
  coins.forEach(c=>{
    if(c.collected) return;
    const sx=c.wx-worldX+PLAYER_X;
    if(sx<-40||sx>GW+40) return;
    // Glow
    const g=ctx.createRadialGradient(sx,c.y,1,sx,c.y,COIN_R*2.2);
    g.addColorStop(0,'rgba(255,215,0,0.5)'); g.addColorStop(1,'rgba(255,215,0,0)');
    ctx.fillStyle=g; ctx.fillRect(sx-COIN_R*2.5,c.y-COIN_R*2.5,COIN_R*5,COIN_R*5);
    // Coin
    ctx.fillStyle='#d4a017';
    ctx.beginPath(); ctx.arc(sx,c.y,COIN_R,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffe033';
    ctx.beginPath(); ctx.arc(sx-2,c.y-2,COIN_R*0.72,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#a07010';
    ctx.font=`bold ${Math.floor(COIN_R*1.1)}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('★',sx,c.y+1);
    ctx.textBaseline='alphabetic';
  });
}

function drawCoffees(){
  coffees.forEach(cf=>{
    if(cf.collected) return;
    const sx=cf.wx-worldX+PLAYER_X;
    if(sx<-60||sx>GW+60) return;
    const bonus=coffeeBonus();
    // Pulsing glow
    const pulse=0.6+0.4*Math.sin(Date.now()/300);
    const g=ctx.createRadialGradient(sx,cf.y,2,sx,cf.y,COFFEE_R*2.4);
    g.addColorStop(0,`rgba(100,220,255,${0.5*pulse})`); g.addColorStop(1,'rgba(100,220,255,0)');
    ctx.fillStyle=g; ctx.fillRect(sx-COFFEE_R*2.6,cf.y-COFFEE_R*2.6,COFFEE_R*5.2,COFFEE_R*5.2);
    // Cup body
    ctx.fillStyle='#5c3317';
    ctx.beginPath(); ctx.arc(sx,cf.y,COFFEE_R,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#a0522d';
    ctx.beginPath(); ctx.arc(sx,cf.y,COFFEE_R*0.8,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#3a1a00';
    ctx.beginPath(); ctx.arc(sx,cf.y,COFFEE_R*0.45,0,Math.PI*2); ctx.fill();
    // ☕ icon
    ctx.fillStyle='#fff';
    ctx.font=`bold ${Math.floor(COFFEE_R*0.85)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('☕',sx,cf.y+1);
    ctx.textBaseline='alphabetic';
    // Bonus label below
    ctx.fillStyle='#7de8ff';
    ctx.font=`bold 13px monospace`;
    ctx.textAlign='center';
    ctx.fillText(`+${bonus}s`,sx,cf.y+COFFEE_R+14);
  });
}

function drawPopups(){
  popups.forEach(p=>{
    const t=p.life/p.maxLife, yOff=(1-t)*52;
    ctx.globalAlpha=t;
    ctx.font='bold 22px monospace'; ctx.textAlign='center';
    ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=3;
    ctx.strokeText(p.text,p.x,p.y-yOff);
    ctx.fillStyle=p.color;
    ctx.fillText(p.text,p.x,p.y-yOff);
    ctx.globalAlpha=1;
  });
}

function drawHUD(){
  ctx.fillStyle='rgba(0,0,0,0.52)'; ctx.fillRect(0,0,GW,46);

  // Timer
  const tColor=timeLeft>15?'#4ade80':timeLeft>8?'#facc15':'#f87171';
  ctx.fillStyle=tColor; ctx.font='bold 24px monospace'; ctx.textAlign='left';
  ctx.fillText(`⏱ ${timeLeft}s`,18,32);
  ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(115,13,240,18);
  ctx.fillStyle=tColor; ctx.fillRect(115,13,240*Math.min(timeLeft/TIMER_START,1),18);
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.strokeRect(115,13,240,18);

  // Score (coins)
  ctx.fillStyle='#ffe033'; ctx.font='bold 24px monospace'; ctx.textAlign='center';
  ctx.fillText(`★ ${score}`,GW/2,32);

  // Speed indicator
  const lvl=Math.min(Math.floor((currentSpeed-BASE_SPEED)/(MAX_SPEED-BASE_SPEED)*5)+1,6);
  const lvlColors=['#4ade80','#a3e635','#facc15','#fb923c','#f87171','#dc2626'];
  ctx.fillStyle=lvlColors[lvl-1]; ctx.font='bold 18px monospace'; ctx.textAlign='right';
  ctx.fillText(`VEL ${lvl}/6`,GW-18,32);

  // Next coffee bonus hint (small, subtle)
  const nb=coffeeBonus();
  ctx.fillStyle='rgba(125,232,255,0.5)'; ctx.font='12px monospace'; ctx.textAlign='right';
  ctx.fillText(`☕ próx. +${nb}s`,GW-18,GH-8);

  ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.font='13px monospace'; ctx.textAlign='center';
  ctx.fillText('P / Espaço = Pular',GW/2,GH-8);
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function rrect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

// ── Start screen ───────────────────────────────────────────────────────────────
const BTN_START={x:GW/2-130,y:GH/2+60,w:260,h:60};
let hovBtn=null;

function drawStartScreen(){
  const bg=ctx.createLinearGradient(0,0,0,GH);
  bg.addColorStop(0,'#0a0f1e'); bg.addColorStop(1,'#1a2a4a');
  ctx.fillStyle=bg; ctx.fillRect(0,0,GW,GH);
  ctx.fillStyle='rgba(255,255,255,0.6)';
  [[80,60],[200,30],[350,80],[500,45],[670,70],[820,25],[950,60],[1100,40],[1200,85],
   [130,120],[400,150],[750,110],[1050,130]].forEach(([x,y])=>ctx.fillRect(x,y,2,2));
  ctx.fillStyle='#111e35';
  [[50,180],[200,250],[360,160],[530,230],[710,190],[890,270],[1050,200],[1180,240]].forEach(([x,h],i)=>{
    const w=[120,80,160,100,140,90,160,90][i]; ctx.fillRect(x,GH-h-80,w,h);
  });
  ctx.fillStyle='#2a4a1a'; ctx.fillRect(0,GH-82,GW,12);
  ctx.textAlign='center';
  ctx.shadowColor='#4a9cff'; ctx.shadowBlur=30;
  ctx.fillStyle='#e8f4ff'; ctx.font='bold 72px monospace'; ctx.fillText('CORRIDA',GW/2,GH/2-90);
  ctx.fillStyle='#f0d060'; ctx.fillText('AO TRABALHO',GW/2,GH/2-10);
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(200,220,255,0.6)'; ctx.font='17px monospace';
  ctx.fillText('Pule os obstáculos · colete ★ moedas · pegue ☕ para ganhar tempo!',GW/2,GH/2+44);
  const hov=(hovBtn===BTN_START);
  ctx.fillStyle=hov?'#3a7fd4':'#1a5fa4';
  rrect(BTN_START.x,BTN_START.y,BTN_START.w,BTN_START.h,12); ctx.fill();
  ctx.strokeStyle=hov?'#80bfff':'#4a8fcf'; ctx.lineWidth=2;
  rrect(BTN_START.x,BTN_START.y,BTN_START.w,BTN_START.h,12); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold 26px monospace';
  ctx.fillText('▶  JOGAR',GW/2,BTN_START.y+BTN_START.h/2+9);
  ctx.fillStyle='rgba(150,180,220,0.5)'; ctx.font='13px monospace';
  ctx.fillText('Desenvolvimento Web II  —  UniLaSalle',GW/2,GH-20);
}

// ── Selection screen ───────────────────────────────────────────────────────────
const N=CHAR_KEYS.length,CW=220,CH=370,CGAP=18;
const CY=GH/2-CH/2+5, CSX=GW/2-(N*CW+(N-1)*CGAP)/2;
function cX(i){return CSX+i*(CW+CGAP);}
let hoveredCard=null;

function drawSelectScreen(){
  const bg=ctx.createLinearGradient(0,0,0,GH);
  bg.addColorStop(0,'#0d1520'); bg.addColorStop(1,'#162035');
  ctx.fillStyle=bg; ctx.fillRect(0,0,GW,GH);
  ctx.fillStyle='#e2c97a'; ctx.font='bold 26px monospace'; ctx.textAlign='center';
  ctx.fillText('SELECIONE SEU PERSONAGEM',GW/2,44);
  CHAR_KEYS.forEach((key,i)=>{
    const c=CHARS[key],cx=cX(i),hov=hoveredCard===key;
    ctx.fillStyle=hov?'#1e3050':'#111c2e';
    rrect(cx,CY,CW,CH,8); ctx.fill();
    ctx.strokeStyle=hov?'#e2c97a':'#2a4060'; ctx.lineWidth=hov?2.5:1.5;
    rrect(cx,CY,CW,CH,8); ctx.stroke();
    if(c.canvas&&c.portBounds){
      const p=c.stand,pH=310,srcX=p.col*c.colW+c.portBounds.x,srcW=c.portBounds.w;
      const pS=pH/p.h,pW=srcW*pS;
      ctx.save(); rrect(cx+2,CY+2,CW-4,CH-4,7); ctx.clip();
      ctx.drawImage(c.canvas,srcX,p.y,srcW,p.h,cx+CW/2-pW/2,CY+6,pW,pH);
      ctx.restore();
    }
    ctx.fillStyle=hov?'#e2c97a':'#8aaccc';
    ctx.font=`bold ${hov?15:13}px monospace`; ctx.textAlign='center';
    ctx.fillText(c.label,cx+CW/2,CY+CH-14);
  });
  ctx.fillStyle='#3a5070'; ctx.font='12px monospace'; ctx.textAlign='center';
  ctx.fillText('Clique em um personagem para jogar',GW/2,GH-14);
}

function drawLoadingScreen(){
  ctx.fillStyle='#0d1520'; ctx.fillRect(0,0,GW,GH);
  ctx.fillStyle='#e2c97a'; ctx.font='bold 20px monospace'; ctx.textAlign='center';
  ctx.fillText(`Carregando... ${loadedCount}/${CHAR_KEYS.length}`,GW/2,GH/2);
}

// ── Game Over ──────────────────────────────────────────────────────────────────
const BTN_RETRY={x:GW/2-150,y:GH/2+55,w:300,h:60};
const BTN_MENU ={x:GW/2-150,y:GH/2+135,w:300,h:50};

function drawGameOverScreen(){
  ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.fillRect(0,0,GW,GH);
  const pw=520,ph=350,px2=GW/2-pw/2,py2=GH/2-ph/2-20;
  ctx.fillStyle='#140a0a'; rrect(px2,py2,pw,ph,16); ctx.fill();
  ctx.strokeStyle='#8b0000'; ctx.lineWidth=3; rrect(px2,py2,pw,ph,16); ctx.stroke();
  ctx.textAlign='center';
  ctx.shadowColor='#ff0000'; ctx.shadowBlur=20;
  ctx.fillStyle='#ff3333'; ctx.font='bold 64px monospace'; ctx.fillText('GAME OVER',GW/2,py2+90);
  ctx.shadowBlur=0;
  ctx.fillStyle='#ffaaaa'; ctx.font='18px monospace';
  ctx.fillText(gameOverReason==='time'?'O tempo acabou!':'Você bateu num obstáculo!',GW/2,py2+132);
  ctx.fillStyle='#ffe033'; ctx.font='bold 28px monospace';
  ctx.fillText(`★ ${score} moeda${score!==1?'s':''}`,GW/2,py2+182);
  const hRetry=(hovBtn===BTN_RETRY);
  ctx.fillStyle=hRetry?'#2a6b2a':'#1a4a1a';
  rrect(BTN_RETRY.x,BTN_RETRY.y,BTN_RETRY.w,BTN_RETRY.h,12); ctx.fill();
  ctx.strokeStyle=hRetry?'#5adb5a':'#3a8a3a'; ctx.lineWidth=2;
  rrect(BTN_RETRY.x,BTN_RETRY.y,BTN_RETRY.w,BTN_RETRY.h,12); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold 24px monospace';
  ctx.fillText('↺  REINICIAR',GW/2,BTN_RETRY.y+BTN_RETRY.h/2+8);
  const hMenu=(hovBtn===BTN_MENU);
  ctx.fillStyle=hMenu?'#2a2a5a':'#1a1a3a';
  rrect(BTN_MENU.x,BTN_MENU.y,BTN_MENU.w,BTN_MENU.h,10); ctx.fill();
  ctx.strokeStyle=hMenu?'#8080cc':'#4a4a8a'; ctx.lineWidth=1.5;
  rrect(BTN_MENU.x,BTN_MENU.y,BTN_MENU.w,BTN_MENU.h,10); ctx.stroke();
  ctx.fillStyle='#aabbdd'; ctx.font='18px monospace';
  ctx.fillText('Menu principal',GW/2,BTN_MENU.y+BTN_MENU.h/2+6);
}

// ── Mouse ──────────────────────────────────────────────────────────────────────
function canvasXY(e){
  const r=canvas.getBoundingClientRect();
  return{x:(e.clientX-r.left)*(GW/r.width),y:(e.clientY-r.top)*(GH/r.height)};
}
function inBtn(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}

canvas.addEventListener('mousemove',e=>{
  const pos=canvasXY(e); hovBtn=null; hoveredCard=null;
  if(gameState==='start')     hovBtn=inBtn(pos,BTN_START)?BTN_START:null;
  else if(gameState==='select') CHAR_KEYS.forEach((k,i)=>{const cx=cX(i);if(pos.x>=cx&&pos.x<=cx+CW&&pos.y>=CY&&pos.y<=CY+CH)hoveredCard=k;});
  else if(gameState==='gameover') hovBtn=inBtn(pos,BTN_RETRY)?BTN_RETRY:inBtn(pos,BTN_MENU)?BTN_MENU:null;
  canvas.style.cursor=(hovBtn||hoveredCard)?'pointer':'default';
});

canvas.addEventListener('click',e=>{
  const pos=canvasXY(e);
  if(gameState==='start'&&inBtn(pos,BTN_START)) gameState='select';
  else if(gameState==='select')
    CHAR_KEYS.forEach((k,i)=>{const cx=cX(i);if(pos.x>=cx&&pos.x<=cx+CW&&pos.y>=CY&&pos.y<=CY+CH)startGame(k);});
  else if(gameState==='gameover'){
    if(inBtn(pos,BTN_RETRY)){resetPlayer();gameState='playing';}
    else if(inBtn(pos,BTN_MENU)){resetPlayer();gameState='select';}
  }
});

function startGame(key){
  activeChar=CHARS[key];
  dCW=activeChar.colW*activeChar.scale;
  dWH=activeChar.walk.h*activeChar.scale;
  dJH=activeChar.jump.h*activeChar.scale;
  resetPlayer(); canvas.style.cursor='default'; gameState='playing';
}

// ── Game loop ──────────────────────────────────────────────────────────────────
let lastTs=0;
function loop(ts){
  const dt=Math.min(ts-lastTs,50); lastTs=ts;
  ctx.imageSmoothingEnabled=false;
  switch(gameState){
    case 'loading': drawLoadingScreen(); break;
    case 'start':   drawStartScreen();   break;
    case 'select':  drawSelectScreen();  break;
    case 'playing':
      update(dt);
      drawBackground(); drawObstacles(); drawCoins(); drawCoffees();
      drawPlayer(); drawPopups(); drawHUD();
      break;
    case 'gameover':
      drawBackground(); drawObstacles(); drawCoins(); drawCoffees();
      drawPlayer(); drawGameOverScreen();
      break;
  }
  requestAnimationFrame(loop);
}

loadAllChars();
requestAnimationFrame(loop);
