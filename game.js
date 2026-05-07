'use strict';

// ── Canvas ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const GW = 1280, GH = 640;
canvas.width = GW; canvas.height = GH;
// Draw sprites crisp within canvas; let CSS scale smoothly to screen
ctx.imageSmoothingEnabled = false;

function fitCanvas() {
  const r = GW / GH, ww = window.innerWidth, wh = window.innerHeight;
  let cw, ch;
  if (ww / wh > r) { ch = wh; cw = wh * r; } else { cw = ww; ch = ww / r; }
  canvas.style.cssText = `position:fixed;image-rendering:auto;
    width:${cw}px;height:${ch}px;left:${(ww-cw)/2}px;top:${(wh-ch)/2}px`;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ── Character configs ──────────────────────────────────────────────────────────
// All sheets share the same 4-col, 4-row labelled layout.
// Sections found via pixel analysis (sat<20, 85<bright<180 = background).
// walk = Profile Right Walk section (4 frames), jump = Jump Right (col 2).
const CHARS = {
  cabral: {
    label:'Cabral', file:'spritesheet_cabral.png', colW:911/4,
    stand:{col:1,y:60,h:326}, walk:{y:697,h:207,frames:4}, jump:{y:962,h:216,col:2},
    scale:0.96, bgSat:20, bgBrMin:88, bgBrMax:180,
  },
  bruno: {
    label:'Bruno', file:'spritesheet_bruno.png', colW:896/4,
    stand:{col:1,y:59,h:326}, walk:{y:695,h:208,frames:4}, jump:{y:959,h:207,col:2},
    scale:0.96, bgSat:20, bgBrMin:88, bgBrMax:180,
  },
  lisboa: {
    label:'Lisboa', file:'spritesheet_lisboa.png', colW:896/4,
    stand:{col:1,y:60,h:325}, walk:{y:694,h:207,frames:4}, jump:{y:957,h:209,col:2},
    scale:0.96, bgSat:20, bgBrMin:88, bgBrMax:180,
  },
  anna: {
    label:'Anna', file:'spritesheet_anna.png', colW:1822/4,
    stand:{col:1,y:118,h:662}, walk:{y:1394,h:425,frames:4}, jump:{y:1924,h:440,col:2},
    scale:0.47, bgSat:22, bgBrMin:85, bgBrMax:180,
  },
  arcanjo: {
    label:'Arcanjo', file:'spritesheet_arcanjo.png', colW:1822/4,
    stand:{col:1,y:121,h:649}, walk:{y:1394,h:416,frames:4}, jump:{y:1924,h:433,col:2},
    scale:0.47, bgSat:22, bgBrMin:85, bgBrMax:180,
  },
};
const CHAR_KEYS = Object.keys(CHARS);

// ── Background removal (done in JS at runtime — no pre-generated files needed) ─
function removeBackground(img, satT, brMin, brMax) {
  const oc = document.createElement('canvas');
  oc.width = img.width; oc.height = img.height;
  const c2 = oc.getContext('2d');
  c2.drawImage(img, 0, 0);
  const id = c2.getImageData(0, 0, img.width, img.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r=d[i],g=d[i+1],b=d[i+2];
    const sat=Math.max(r,g,b)-Math.min(r,g,b), br=(r+g+b)/3;
    if (sat<satT && br>brMin && br<brMax) d[i+3]=0;
  }
  c2.putImageData(id, 0, 0);
  return oc;
}

// ── Portrait bounds ────────────────────────────────────────────────────────────
// After background removal, find the tight bounding box of the character pixels
// within the portrait cell so we can CENTER the actual character in the card.
function computePortraitBounds(c) {
  const p   = c.stand;
  const cw  = Math.ceil(c.colW);
  const ch  = p.h;
  const oc  = document.createElement('canvas');
  oc.width  = cw; oc.height = ch;
  const oc2 = oc.getContext('2d');
  oc2.drawImage(c.canvas, p.col * c.colW, p.y, c.colW, ch, 0, 0, cw, ch);
  const px  = oc2.getImageData(0, 0, cw, ch).data;

  let x0 = cw, x1 = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (px[(y * cw + x) * 4 + 3] > 15) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  const PAD = 4;
  c.portBounds = {
    x: Math.max(0, x0 - PAD),
    w: Math.min(cw, x1 + PAD) - Math.max(0, x0 - PAD),
  };
}

// ── Loading ────────────────────────────────────────────────────────────────────
let loadedCount = 0;
function loadAllChars() {
  CHAR_KEYS.forEach(key => {
    const c = CHARS[key];
    c.img = new Image();
    c.img.onload = () => {
      c.canvas = removeBackground(c.img, c.bgSat, c.bgBrMin, c.bgBrMax);
      computePortraitBounds(c);   // find tight x-bounds for centered portrait
      if (++loadedCount === CHAR_KEYS.length) gameState = 'select';
    };
    c.img.onerror = () => {
      c.canvas = Object.assign(document.createElement('canvas'),{width:1,height:1});
      if (++loadedCount === CHAR_KEYS.length) gameState = 'select';
    };
    c.img.src = c.file;
  });
}

// ── State ──────────────────────────────────────────────────────────────────────
let gameState  = 'loading';
let activeChar = null;
let dCW, dWH, dJH;  // display col-width, walk-height, jump-height

// ── World / Camera ─────────────────────────────────────────────────────────────
// Character is fixed at PLAYER_X on screen; the world scrolls.
const PLAYER_X  = 200;
const GROUND_Y  = GH - 120;
let   worldX    = 0;   // world offset (increases as player moves right)
const WALK_SPD  = 6;

// ── Parallax clouds ────────────────────────────────────────────────────────────
const CLOUD_REPEAT = 2560;
const CLOUDS = [
  {wx:130,  y:70,  w:290,h:88},
  {wx:520,  y:45,  w:210,h:68},
  {wx:900,  y:100, w:340,h:96},
  {wx:1310, y:55,  w:255,h:80},
  {wx:1760, y:35,  w:220,h:72},
  {wx:2210, y:80,  w:305,h:92},
];
const CLOUD_PARALLAX = 0.25;

// ── Player ─────────────────────────────────────────────────────────────────────
const player = {
  y:GROUND_Y, vy:0, jumpVx:0, onGround:true,
  facing:'right', state:'idle',
  animFrame:0, animTimer:0, ANIM_SPEED:110,
  chargeStart:null, chargeLevel:0, MAX_CHARGE_MS:1000,
  JUMP_VY_MIN:9, JUMP_VY_MAX:18, JUMP_VX_MAX:10, GRAVITY:0.55,
};
function resetPlayer() {
  worldX=0;
  Object.assign(player,{y:GROUND_Y,vy:0,jumpVx:0,onGround:true,facing:'right',state:'idle',
    animFrame:0,animTimer:0,chargeStart:null,chargeLevel:0});
}

// ── Input ──────────────────────────────────────────────────────────────────────
const keys = {};
window.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  const was = keys[e.key]; keys[e.key] = true;
  if (!was && (e.key==='p'||e.key==='P') && player.onGround && player.state!=='charging') {
    player.state='charging'; player.chargeStart=performance.now(); player.chargeLevel=0;
  }
});
window.addEventListener('keyup', e => {
  keys[e.key] = false;
  if (gameState==='playing' && (e.key==='p'||e.key==='P') && player.state==='charging')
    executeJump();
});

function executeJump() {
  const t = Math.min((performance.now()-player.chargeStart)/player.MAX_CHARGE_MS,1);
  player.chargeLevel = t;
  player.vy    = -(player.JUMP_VY_MIN + t*(player.JUMP_VY_MAX-player.JUMP_VY_MIN));
  // Always jump forward in the facing direction; charge increases distance
  player.jumpVx = (player.facing==='right'?1:-1) * (0.4 + t*0.6) * player.JUMP_VX_MAX;
  player.onGround=false; player.state='jumping'; player.animFrame=0;
}

// ── Update ─────────────────────────────────────────────────────────────────────
function update(dt) {
  const goL = keys['ArrowLeft'] ||keys['a']||keys['A'];
  const goR = keys['ArrowRight']||keys['d']||keys['D'];

  if (player.state !== 'charging') {
    if (goR) {
      worldX += WALK_SPD; player.facing='right';
      if (player.state!=='walking'&&player.onGround){player.state='walking';player.animFrame=0;}
    } else if (goL) {
      worldX -= WALK_SPD; player.facing='left';
      if (player.state!=='walking'&&player.onGround){player.state='walking';player.animFrame=0;}
    } else if (player.state==='walking') {
      player.state='idle'; player.animFrame=0;
    }
  }

  if (!player.onGround) {
    worldX    += player.jumpVx;          // horizontal arc
    player.jumpVx *= 0.97;               // slight air friction
    player.vy += player.GRAVITY;
    player.y  += player.vy;
    if (player.y >= GROUND_Y) {
      player.y=GROUND_Y; player.vy=0; player.jumpVx=0;
      player.onGround=true; player.state='idle'; player.animFrame=0;
    }
  }

  if (player.state==='charging' && player.chargeStart)
    player.chargeLevel = Math.min((performance.now()-player.chargeStart)/player.MAX_CHARGE_MS,1);

  player.animTimer += dt;
  if (player.animTimer >= player.ANIM_SPEED) { player.animTimer-=player.ANIM_SPEED; player.animFrame++; }
}

// ── Draw helpers ───────────────────────────────────────────────────────────────
function blit(px,py,sx,sy,sw,sh,dw,dh,flipH) {
  ctx.save();
  if (flipH) { ctx.translate(px+dw,0); ctx.scale(-1,1); ctx.drawImage(activeChar.canvas,sx,sy,sw,sh,0,py,dw,dh); }
  else ctx.drawImage(activeChar.canvas,sx,sy,sw,sh,px,py,dw,dh);
  ctx.restore();
}

function drawPlayer() {
  const ac=activeChar, flipH=player.facing==='left', px=PLAYER_X;
  if (player.state==='jumping') {          // só airborne usa sprite de pulo
    blit(px,player.y-dJH,ac.jump.col*ac.colW,ac.jump.y,ac.colW,ac.jump.h,dCW,dJH,flipH);
  } else {                                  // charging, walking, idle: sprite no chão
    const frames=player.state==='walking'?ac.walk.frames:1;
    blit(px,player.y-dWH,(player.animFrame%frames)*ac.colW,ac.walk.y,ac.colW,ac.walk.h,dCW,dWH,flipH);
  }
}

function drawPowerBar() {
  if (player.state!=='charging') return;
  const bw=80,bh=10, bx=PLAYER_X+dCW/2-bw/2, by=player.y-dWH-24;
  ctx.fillStyle='rgba(0,0,0,.65)'; ctx.fillRect(bx-3,by-14,bw+6,bh+18);
  ctx.fillStyle='#fff'; ctx.font='bold 9px monospace'; ctx.textAlign='center';
  ctx.fillText('FORCA',bx+bw/2,by-2);
  ctx.fillStyle='#333'; ctx.fillRect(bx,by,bw,bh);
  const t=player.chargeLevel;
  ctx.fillStyle=`rgb(${Math.round(255*Math.min(t*2,1))},${Math.round(255*Math.min((1-t)*2,1))},0)`;
  ctx.fillRect(bx,by,bw*t,bh);
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.strokeRect(bx,by,bw,bh);
}

function drawBackground() {
  // Sky
  const sky=ctx.createLinearGradient(0,0,0,GROUND_Y);
  sky.addColorStop(0,'#3a78c9'); sky.addColorStop(1,'#a8d8f0');
  ctx.fillStyle=sky; ctx.fillRect(0,0,GW,GROUND_Y);

  // Clouds (parallax layer — scroll at CLOUD_PARALLAX * worldX, wrapping)
  ctx.fillStyle='rgba(255,255,255,0.88)';
  const cOff = (worldX*CLOUD_PARALLAX) % CLOUD_REPEAT;
  CLOUDS.forEach(cl => {
    // Draw potentially twice so it wraps
    for (let rep=-1; rep<=1; rep++) {
      const sx = cl.wx - cOff + rep*CLOUD_REPEAT;
      if (sx+cl.w < 0 || sx > GW) continue;
      drawCloud(sx, cl.y, cl.w, cl.h);
    }
  });

  // Ground
  ctx.fillStyle='#7a5230'; ctx.fillRect(0,GROUND_Y,GW,GH-GROUND_Y);
  ctx.fillStyle='#5aab2e'; ctx.fillRect(0,GROUND_Y,GW,10);
  ctx.fillStyle='#70cf3a'; ctx.fillRect(0,GROUND_Y,GW,4);

  // Ground tile marks (scroll at full speed to show movement)
  ctx.fillStyle='rgba(0,0,0,0.08)';
  const tileW=60, tileOff=worldX%tileW;
  for (let x=-tileOff; x<GW; x+=tileW)
    ctx.fillRect(x,GROUND_Y,2,10);
}

function drawCloud(x,y,w,h) {
  ctx.beginPath();
  const r=h/2;
  ctx.arc(x+w*0.25,y+r,r*0.8,Math.PI,0);
  ctx.arc(x+w*0.5, y+r*0.5,r,Math.PI,0);
  ctx.arc(x+w*0.75,y+r,r*0.7,Math.PI,0);
  ctx.closePath(); ctx.fill();
}

function drawHUD() {
  ctx.font='13px monospace'; ctx.textAlign='center';
  const txt='< > Andar  |  P (segurar 1s) Pular';
  const tw=ctx.measureText(txt).width;
  ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(GW/2-tw/2-10,8,tw+20,24);
  ctx.fillStyle='#eee'; ctx.fillText(txt,GW/2,26);
}

// ── Selection screen ───────────────────────────────────────────────────────────
const N = CHAR_KEYS.length;
const CW=220, CH=370, CGAP=18;
const CY=GH/2-CH/2+5;
const CSX=GW/2-(N*CW+(N-1)*CGAP)/2;
function cX(i){return CSX+i*(CW+CGAP);}
let hoveredCard=null;

function rrect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function drawSelectScreen() {
  const bg=ctx.createLinearGradient(0,0,0,GH);
  bg.addColorStop(0,'#0d1520'); bg.addColorStop(1,'#162035');
  ctx.fillStyle=bg; ctx.fillRect(0,0,GW,GH);

  ctx.fillStyle='#e2c97a'; ctx.font='bold 20px monospace'; ctx.textAlign='center';
  ctx.fillText('SELECIONE SEU PERSONAGEM',GW/2,36);

  CHAR_KEYS.forEach((key,i)=>{
    const c=CHARS[key], cx=cX(i), hov=hoveredCard===key;
    ctx.fillStyle=hov?'#1e3050':'#111c2e';
    rrect(cx,CY,CW,CH,8); ctx.fill();
    ctx.strokeStyle=hov?'#e2c97a':'#2a4060'; ctx.lineWidth=hov?2:1.5;
    rrect(cx,CY,CW,CH,8); ctx.stroke();

    if (c.canvas && c.portBounds) {
      const p   = c.stand, pH = 310;
      // Use tight character bounds so the actual figure is centered in the card
      const srcX = p.col * c.colW + c.portBounds.x;
      const srcW = c.portBounds.w;
      const pS   = pH / p.h;
      const pW   = srcW * pS;
      ctx.save();
      rrect(cx+2, CY+2, CW-4, CH-4, 7); ctx.clip();
      ctx.drawImage(c.canvas, srcX, p.y, srcW, p.h, cx+CW/2-pW/2, CY+6, pW, pH);
      ctx.restore();
    }
    ctx.fillStyle=hov?'#e2c97a':'#8aaccc';
    ctx.font=`bold ${hov?15:13}px monospace`; ctx.textAlign='center';
    ctx.fillText(c.label,cx+CW/2,CY+CH-14);
  });

  ctx.fillStyle='#3a5070'; ctx.font='11px monospace'; ctx.textAlign='center';
  ctx.fillText('Clique em um personagem para jogar',GW/2,GH-10);
}

function drawLoadingScreen() {
  ctx.fillStyle='#0d1520'; ctx.fillRect(0,0,GW,GH);
  ctx.fillStyle='#e2c97a'; ctx.font='bold 18px monospace'; ctx.textAlign='center';
  ctx.fillText(`Carregando... ${loadedCount}/${CHAR_KEYS.length}`,GW/2,GH/2);
}

// ── Mouse ──────────────────────────────────────────────────────────────────────
function canvasXY(e) {
  const r=canvas.getBoundingClientRect();
  return {x:(e.clientX-r.left)*(GW/r.width), y:(e.clientY-r.top)*(GH/r.height)};
}
canvas.addEventListener('mousemove',e=>{
  if (gameState!=='select') return;
  const {x,y}=canvasXY(e); hoveredCard=null;
  CHAR_KEYS.forEach((k,i)=>{ const cx=cX(i); if(x>=cx&&x<=cx+CW&&y>=CY&&y<=CY+CH) hoveredCard=k; });
  canvas.style.cursor=hoveredCard?'pointer':'default';
});
canvas.addEventListener('click',e=>{
  if (gameState!=='select') return;
  const {x,y}=canvasXY(e);
  CHAR_KEYS.forEach((k,i)=>{ const cx=cX(i); if(x>=cx&&x<=cx+CW&&y>=CY&&y<=CY+CH) startGame(k); });
});

function startGame(key) {
  activeChar=CHARS[key];
  dCW=activeChar.colW*activeChar.scale;
  dWH=activeChar.walk.h*activeChar.scale;
  dJH=activeChar.jump.h*activeChar.scale;
  resetPlayer(); canvas.style.cursor='default'; gameState='playing';
}

let lastTs=0;
function loop(ts) {
  const dt=Math.min(ts-lastTs,50); lastTs=ts;
  ctx.imageSmoothingEnabled=false;
  if (gameState==='loading')     drawLoadingScreen();
  else if (gameState==='select') drawSelectScreen();
  else { update(dt); drawBackground(); drawPlayer(); drawPowerBar(); drawHUD(); }
  requestAnimationFrame(loop);
}

loadAllChars();
requestAnimationFrame(loop);
