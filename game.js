'use strict';

// ── Canvas & fullscreen ────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const GW = 800, GH = 400;
canvas.width  = GW;
canvas.height = GH;

function fitCanvas() {
  const r = GW / GH;
  const ww = window.innerWidth, wh = window.innerHeight;
  let cw, ch;
  if (ww / wh > r) { ch = wh; cw = wh * r; }
  else              { cw = ww; ch = ww / r; }
  canvas.style.width  = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.style.left   = ((ww - cw) / 2) + 'px';
  canvas.style.top    = ((wh - ch) / 2) + 'px';
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ── Character definitions ──────────────────────────────────────────────────────
/*
  All sheets follow the same 4-col layout (measured via pixel analysis):
    Standing poses  → col 1 = Profile Right Standing  (portrait)
    Profile Walk    → row 2, cols 0-3 = 4-frame walk cycle
    Jump & Actions  → row 3, col 2   = Jump Right
*/
const CHARS = {
  cabral: {
    label:   'Cabral',
    file:    'spritesheet_cabral.png',
    colW:    787 / 4,          // 196.75 px per column
    stand:   { col: 1, y:  51, h: 282 },   // portrait source
    walk:    { y: 603, h: 179, frames: 4 },
    jump:    { y: 832, h: 187, col: 2 },
    scale:   0.65,
    bgSat:   20, bgBrMin:  88, bgBrMax: 180,
  },
  bruno: {
    label:   'Bruno',
    file:    'spritesheet_bruno.png',
    colW:    896 / 4,          // 224 px per column
    stand:   { col: 1, y:  59, h: 326 },
    walk:    { y: 695, h: 208, frames: 4 },
    jump:    { y: 959, h: 207, col: 2 },
    scale:   0.55,
    bgSat:   20, bgBrMin:  88, bgBrMax: 180,
  },
  lisboa: {
    label:   'Lisboa',
    file:    'spritesheet_lisboa.png',
    colW:    896 / 4,
    stand:   { col: 1, y:  60, h: 325 },
    walk:    { y: 694, h: 207, frames: 4 },
    jump:    { y: 957, h: 209, col: 2 },
    scale:   0.55,
    bgSat:   20, bgBrMin:  88, bgBrMax: 180,
  },
};
const CHAR_KEYS = Object.keys(CHARS);   // ['cabral','bruno','lisboa']

// ── Background removal (runs in JS at load time — no pre-generated _t.png needed)
function removeBackground(img, satThresh, brMin, brMax) {
  const oc = document.createElement('canvas');
  oc.width  = img.width;
  oc.height = img.height;
  const oc2 = oc.getContext('2d');
  oc2.drawImage(img, 0, 0);
  const id = oc2.getImageData(0, 0, img.width, img.height);
  const d  = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const br  = (r + g + b) / 3;
    if (sat < satThresh && br > brMin && br < brMax) d[i+3] = 0;
  }
  oc2.putImageData(id, 0, 0);
  return oc;   // OffscreenCanvas — usable in drawImage()
}

// ── Loading ────────────────────────────────────────────────────────────────────
let loadedCount = 0;

function loadAllChars() {
  CHAR_KEYS.forEach(key => {
    const c = CHARS[key];
    c.img = new Image();
    c.img.onload = () => {
      c.canvas = removeBackground(c.img, c.bgSat, c.bgBrMin, c.bgBrMax);
      loadedCount++;
      if (loadedCount === CHAR_KEYS.length) gameState = 'select';
    };
    c.img.onerror = () => {
      // If image fails (e.g. missing file), skip bg removal and use raw img
      c.canvas = document.createElement('canvas');
      c.canvas.width = 1; c.canvas.height = 1;
      loadedCount++;
      if (loadedCount === CHAR_KEYS.length) gameState = 'select';
    };
    c.img.src = c.file;
  });
}

// ── Game state ─────────────────────────────────────────────────────────────────
let gameState   = 'loading';  // 'loading' | 'select' | 'playing'
let activeChar  = null;       // reference to one of CHARS[key]
let dispColW, dispWalkH, dispJumpH;

// ── World ──────────────────────────────────────────────────────────────────────
const GROUND_Y = GH - 80;

// ── Player ─────────────────────────────────────────────────────────────────────
const player = {
  x: 80, y: GROUND_Y,
  vy: 0, vx: 0,
  onGround: true,
  facing: 'right',
  state:  'idle',
  animFrame: 0, animTimer: 0,
  ANIM_SPEED: 130,
  chargeStart: null, chargeLevel: 0, MAX_CHARGE_MS: 5000,
  WALK_SPEED: 3,
  JUMP_VY_MIN: 7, JUMP_VY_MAX: 16,
  JUMP_VX_MAX: 6,
  GRAVITY: 0.45,
};

function resetPlayer() {
  player.x = 80; player.y = GROUND_Y;
  player.vy = player.vx = 0;
  player.onGround = true;
  player.facing = 'right';
  player.state  = 'idle';
  player.animFrame = player.animTimer = 0;
  player.chargeStart = null; player.chargeLevel = 0;
}

// ── Input ──────────────────────────────────────────────────────────────────────
const keys = {};

window.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  const was = keys[e.key];
  keys[e.key] = true;
  if (!was && (e.key === 'p' || e.key === 'P')) {
    if (player.onGround && player.state !== 'charging') {
      player.state = 'charging';
      player.chargeStart = performance.now();
      player.chargeLevel = 0;
      player.animFrame   = 0;
    }
  }
});
window.addEventListener('keyup', e => {
  keys[e.key] = false;
  if (gameState !== 'playing') return;
  if ((e.key === 'p' || e.key === 'P') && player.state === 'charging') {
    executeJump();
  }
});

function executeJump() {
  const t = Math.min((performance.now() - player.chargeStart) / player.MAX_CHARGE_MS, 1);
  player.chargeLevel = t;
  player.vy = -(player.JUMP_VY_MIN + t * (player.JUMP_VY_MAX - player.JUMP_VY_MIN));
  player.vx = (player.facing === 'right' ? 1 : -1) * t * player.JUMP_VX_MAX;
  player.onGround = false;
  player.state    = 'jumping';
  player.animFrame = 0;
}

// ── Update ─────────────────────────────────────────────────────────────────────
function update(dt) {
  const goLeft  = keys['ArrowLeft']  || keys['a'] || keys['A'];
  const goRight = keys['ArrowRight'] || keys['d'] || keys['D'];

  if (player.onGround && player.state !== 'charging') {
    if (goRight) {
      player.x += player.WALK_SPEED; player.facing = 'right';
      if (player.state !== 'walking') { player.state = 'walking'; player.animFrame = 0; }
    } else if (goLeft) {
      player.x -= player.WALK_SPEED; player.facing = 'left';
      if (player.state !== 'walking') { player.state = 'walking'; player.animFrame = 0; }
    } else {
      if (player.state === 'walking') { player.state = 'idle'; player.animFrame = 0; }
    }
  }

  if (!player.onGround) {
    player.x  += player.vx;
    player.vx *= 0.97;
    player.vy += player.GRAVITY;
    player.y  += player.vy;
    if (player.y >= GROUND_Y) {
      player.y = GROUND_Y; player.vy = player.vx = 0;
      player.onGround = true; player.state = 'idle'; player.animFrame = 0;
    }
  }

  player.x = Math.max(0, Math.min(GW - dispColW, player.x));

  if (player.state === 'charging' && player.chargeStart) {
    player.chargeLevel = Math.min(
      (performance.now() - player.chargeStart) / player.MAX_CHARGE_MS, 1
    );
  }

  player.animTimer += dt;
  if (player.animTimer >= player.ANIM_SPEED) {
    player.animTimer -= player.ANIM_SPEED;
    player.animFrame++;
  }
}

// ── Draw: helpers ──────────────────────────────────────────────────────────────
function blit(px, py, sx, sy, sw, sh, dw, dh, flipH) {
  ctx.save();
  if (flipH) {
    ctx.translate(px + dw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(activeChar.canvas, sx, sy, sw, sh, 0, py, dw, dh);
  } else {
    ctx.drawImage(activeChar.canvas, sx, sy, sw, sh, px, py, dw, dh);
  }
  ctx.restore();
}

function drawPlayer() {
  if (!activeChar) return;
  const ac    = activeChar;
  const flipH = player.facing === 'left';
  const px    = player.x;

  if (player.state === 'jumping' || player.state === 'charging') {
    const sx = ac.jump.col * ac.colW;
    blit(px, player.y - dispJumpH, sx, ac.jump.y, ac.colW, ac.jump.h, dispColW, dispJumpH, flipH);
  } else {
    const frames = player.state === 'walking' ? ac.walk.frames : 1;
    const sx     = (player.animFrame % frames) * ac.colW;
    blit(px, player.y - dispWalkH, sx, ac.walk.y, ac.colW, ac.walk.h, dispColW, dispWalkH, flipH);
  }
}

function drawPowerBar() {
  if (player.state !== 'charging') return;
  const BAR_W = 80, BAR_H = 10;
  const bx = player.x + dispColW / 2 - BAR_W / 2;
  const by = player.y - dispWalkH - 24;

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(bx - 3, by - 14, BAR_W + 6, BAR_H + 18);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FORCA', bx + BAR_W / 2, by - 2);
  ctx.fillStyle = '#222';
  ctx.fillRect(bx, by, BAR_W, BAR_H);
  const t   = player.chargeLevel;
  const red = Math.round(255 * Math.min(t * 2, 1));
  const grn = Math.round(255 * Math.min((1 - t) * 2, 1));
  ctx.fillStyle = `rgb(${red},${grn},0)`;
  ctx.fillRect(bx, by, BAR_W * t, BAR_H);
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, BAR_W, BAR_H);
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, '#3a78c9');
  sky.addColorStop(1, '#a8d8f0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, GW, GROUND_Y);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(0, GROUND_Y, GW, GH - GROUND_Y);
  ctx.fillStyle = '#5aab2e';
  ctx.fillRect(0, GROUND_Y, GW, 10);
  ctx.fillStyle = '#70cf3a';
  ctx.fillRect(0, GROUND_Y, GW, 4);
}

function drawHUD() {
  const text = '< >  Andar    |    P (segurar) Pular';
  ctx.font = '13px monospace'; ctx.textAlign = 'center';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(GW/2 - tw/2 - 10, 8, tw + 20, 24);
  ctx.fillStyle = '#eee';
  ctx.fillText(text, GW/2, 26);
}

// ── Draw: Selection screen ─────────────────────────────────────────────────────
const CARD_W = 180, CARD_H = 265;
const CARD_Y = GH / 2 - CARD_H / 2;
const CARD_GAP = 30;
const TOTAL_W = CHAR_KEYS.length * CARD_W + (CHAR_KEYS.length - 1) * CARD_GAP;
const CARD_START_X = GW / 2 - TOTAL_W / 2;

function cardX(i) { return CARD_START_X + i * (CARD_W + CARD_GAP); }

let hoveredCard = null;

function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSelectScreen() {
  const bg = ctx.createLinearGradient(0, 0, 0, GH);
  bg.addColorStop(0, '#0d1520');
  bg.addColorStop(1, '#162035');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, GW, GH);

  ctx.fillStyle = '#e2c97a';
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SELECIONE SEU PERSONAGEM', GW / 2, 42);

  CHAR_KEYS.forEach((key, i) => {
    const c = CHARS[key];
    const cx = cardX(i);
    const hovered = hoveredCard === key;

    ctx.fillStyle = hovered ? '#1e3050' : '#131e30';
    rrect(cx, CARD_Y, CARD_W, CARD_H, 10);
    ctx.fill();

    ctx.strokeStyle = hovered ? '#e2c97a' : '#2a4060';
    ctx.lineWidth   = hovered ? 2.5 : 1.5;
    rrect(cx, CARD_Y, CARD_W, CARD_H, 10);
    ctx.stroke();

    if (c.canvas && c.canvas.width > 1) {
      const p = c.stand;
      const srcX = p.col * c.colW;
      const portH = 195, portS = portH / p.h;
      const portW = c.colW * portS;
      ctx.drawImage(c.canvas, srcX, p.y, c.colW, p.h,
        cx + CARD_W / 2 - portW / 2, CARD_Y + 8, portW, portH);
    }

    ctx.fillStyle = hovered ? '#e2c97a' : '#8aaccc';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(c.label, cx + CARD_W / 2, CARD_Y + CARD_H - 14);
  });

  ctx.fillStyle = '#3a5070';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Clique em um personagem para jogar', GW / 2, GH - 12);
}

function drawLoadingScreen() {
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, GW, GH);
  ctx.fillStyle = '#e2c97a';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Carregando... ' + loadedCount + ' / ' + CHAR_KEYS.length, GW / 2, GH / 2);
}

// ── Mouse interaction ──────────────────────────────────────────────────────────
function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (GW / rect.width),
    y: (e.clientY - rect.top)  * (GH / rect.height),
  };
}

canvas.addEventListener('mousemove', e => {
  if (gameState !== 'select') return;
  const { x, y } = canvasCoords(e);
  hoveredCard = null;
  CHAR_KEYS.forEach((key, i) => {
    const cx = cardX(i);
    if (x >= cx && x <= cx + CARD_W && y >= CARD_Y && y <= CARD_Y + CARD_H) {
      hoveredCard = key;
    }
  });
  canvas.style.cursor = hoveredCard ? 'pointer' : 'default';
});

canvas.addEventListener('click', e => {
  if (gameState !== 'select') return;
  const { x, y } = canvasCoords(e);
  CHAR_KEYS.forEach((key, i) => {
    const cx = cardX(i);
    if (x >= cx && x <= cx + CARD_W && y >= CARD_Y && y <= CARD_Y + CARD_H) {
      startGame(key);
    }
  });
});

function startGame(key) {
  activeChar = CHARS[key];
  dispColW  = activeChar.colW   * activeChar.scale;
  dispWalkH = activeChar.walk.h * activeChar.scale;
  dispJumpH = activeChar.jump.h * activeChar.scale;
  resetPlayer();
  canvas.style.cursor = 'default';
  gameState = 'playing';
}

// ── Game loop ──────────────────────────────────────────────────────────────────
let lastTs = 0;
function loop(ts) {
  const dt = Math.min(ts - lastTs, 50);
  lastTs = ts;
  switch (gameState) {
    case 'loading': drawLoadingScreen(); break;
    case 'select':  drawSelectScreen();  break;
    case 'playing':
      update(dt);
      drawBackground();
      drawPlayer();
      drawPowerBar();
      drawHUD();
      break;
  }
  requestAnimationFrame(loop);
}

loadAllChars();
requestAnimationFrame(loop);
