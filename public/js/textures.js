// ============================================================
//  Procedural pixel-art textures (HTML5 Canvas -> THREE.CanvasTexture)
//  No image files: everything is painted pixel by pixel here.
// ============================================================
import * as THREE from 'three';
import { drawText, measureText } from './pixelfont.js';

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Wrap a canvas into a nearest-filtered texture (the core of the dot-art look). */
export function pixelTexture(canvas, { repeat = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapNearestFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgb(r, g, b, a = 1) {
  const c = v => Math.max(0, Math.min(255, Math.round(v)));
  return a === 1 ? `rgb(${c(r)},${c(g)},${c(b)})` : `rgba(${c(r)},${c(g)},${c(b)},${a})`;
}
export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  return f >= 1 ? rgb(r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)) : rgb(r * f, g * f, b * f);
}

/** Fill with per-"block" noise around a base colour. */
function noiseFill(g, w, h, base, amp, rand, block = 1) {
  for (let y = 0; y < h; y += block) {
    for (let x = 0; x < w; x += block) {
      const n = (rand() - 0.5) * 2 * amp;
      g.fillStyle = rgb(base[0] + n, base[1] + n, base[2] + n * 0.8);
      g.fillRect(x, y, block, block);
    }
  }
}

function dot(g, x, y, col, w = 1, h = 1) {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
}

const memo = new Map();
function once(key, fn) {
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

// ---------------- Ground surfaces ----------------
export function roadTex() {
  return once('road', () => {
    const [c, g] = makeCanvas(64, 64);
    const r = mulberry32(11);
    noiseFill(g, 64, 64, [92, 92, 100], 7, r, 2);
    // rubbered racing line
    for (let y = 0; y < 64; y++) {
      for (let x = 20; x < 44; x++) {
        if (r() < 0.35) dot(g, x, y, 'rgba(40,40,46,0.35)');
      }
    }
    for (let i = 0; i < 70; i++) dot(g, Math.floor(r() * 64), Math.floor(r() * 64), r() < 0.5 ? '#a8a8b0' : '#4c4c54');
    // white edge lines
    dot(g, 2, 0, '#e8e8e8', 2, 64);
    dot(g, 60, 0, '#e8e8e8', 2, 64);
    return pixelTexture(c);
  });
}

export function curbTex() {
  return once('curb', () => {
    const [c, g] = makeCanvas(8, 16);
    dot(g, 0, 0, '#d82828', 8, 8);
    dot(g, 0, 8, '#f0f0f0', 8, 8);
    dot(g, 0, 0, '#a01818', 1, 8);
    dot(g, 0, 8, '#b8b8b8', 1, 8);
    return pixelTexture(c);
  });
}

// ---------------- Course themes (ground / trees / mountains palettes) ----------------
export const THEMES = {
  green: { ground: [72, 142, 58], tuft: '#3e7a32', light: '#8cc86a', dots: ['#f4e45a', '#ffffff'], pine: 0.6,
    leaves: ['#3e8a3c', '#2e6c2c', '#5aa850'], mtn: ['#7c98b8', '#4f7a5c'], snowCaps: true },
  meadow: { ground: [98, 162, 66], tuft: '#5a9440', light: '#a8dc7a', dots: ['#f4e45a', '#ff8ad0', '#ffffff', '#f4e45a'], pine: 0.2,
    leaves: ['#4e9e44', '#3a7e36', '#74c060'], mtn: ['#8aa8c8', '#6a9a5c'], snowCaps: true },
  autumn: { ground: [128, 126, 60], tuft: '#76682e', light: '#b4a45c', dots: ['#d06030', '#e8b040'], pine: 0.2,
    leaves: ['#d9822b', '#b8452a', '#e8b83a'], mtn: ['#9a8aa8', '#8a5a3a'], snowCaps: true },
  snow: { ground: [226, 232, 242], tuft: '#c4d0e0', light: '#ffffff', dots: ['#b8c8e0'], pine: 1, snowy: true,
    leaves: ['#3e8a5c', '#2e6c4c', '#5aa870'], mtn: ['#c8d8ec', '#94aac4'], snowCaps: true },
  desert: { ground: [214, 178, 118], tuft: '#c09858', light: '#ecd09a', dots: ['#a07040', '#8a6038'], pine: 0, cactus: true,
    leaves: ['#8a9a50', '#6a7a3a', '#a8b060'], mtn: ['#d08a5a', '#b0603c'], snowCaps: false },
  forest: { ground: [56, 114, 52], tuft: '#2e5e2a', light: '#6aa25a', dots: ['#f4e45a'], pine: 0.85,
    leaves: ['#2e7a3a', '#245e2c', '#3e8a42'], mtn: ['#6a88a8', '#3a6448'], snowCaps: true },
  flower: { ground: [90, 160, 70], tuft: '#4e8a3a', light: '#9ed47a', dots: ['#ff6ab0', '#ffe24a', '#ffffff', '#ff8a3a', '#b08aff'],
    dotCount: 70, pine: 0.15, leaves: ['#5aa84e', '#3e8a3c', '#7cc860'], mtn: ['#9ab0d8', '#78a868'], snowCaps: true },
};

export function grassTex(theme = 'green') {
  return once('grass' + theme, () => {
    const T = THEMES[theme] || THEMES.green;
    const [c, g] = makeCanvas(64, 64);
    const r = mulberry32(21);
    noiseFill(g, 64, 64, T.ground, theme === 'snow' ? 5 : 9, r, 2);
    for (let i = 0; i < 160; i++) {
      const x = Math.floor(r() * 64), y = Math.floor(r() * 64);
      dot(g, x, y, T.tuft, 1, 2);
    }
    for (let i = 0; i < 70; i++) dot(g, Math.floor(r() * 64), Math.floor(r() * 64), T.light);
    for (let i = 0; i < (T.dotCount || 8); i++) dot(g, Math.floor(r() * 64), Math.floor(r() * 64), T.dots[Math.floor(r() * T.dots.length)]);
    return pixelTexture(c);
  });
}

export function dirtTex() {
  return once('dirt', () => {
    const [c, g] = makeCanvas(64, 64);
    const r = mulberry32(31);
    noiseFill(g, 64, 64, [154, 112, 70], 14, r, 2);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * 63), y = Math.floor(r() * 63);
      dot(g, x, y, r() < 0.5 ? '#7c6a5a' : '#c4a27a', 2, 2);
    }
    for (let i = 0; i < 50; i++) dot(g, Math.floor(r() * 64), Math.floor(r() * 64), '#5e4026');
    // tyre ruts
    for (let y = 0; y < 64; y++) {
      if (r() < 0.8) dot(g, 18, y, 'rgba(90,60,35,0.6)', 3, 1);
      if (r() < 0.8) dot(g, 42, y, 'rgba(90,60,35,0.6)', 3, 1);
    }
    return pixelTexture(c);
  });
}

export function pitLaneTex() {
  return once('pit', () => {
    const [c, g] = makeCanvas(64, 64);
    const r = mulberry32(41);
    noiseFill(g, 64, 64, [72, 72, 82], 6, r, 2);
    dot(g, 1, 0, '#f0c020', 2, 64);
    dot(g, 61, 0, '#f0c020', 2, 64);
    return pixelTexture(c);
  });
}

export function checkerTex() {
  return once('checker', () => {
    const [c, g] = makeCanvas(32, 4);
    for (let y = 0; y < 4; y += 2) {
      for (let x = 0; x < 32; x += 2) {
        dot(g, x, y, ((x + y) / 2) % 2 ? '#111' : '#f4f4f4', 2, 2);
      }
    }
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function gridMarkTex() {
  return once('gridmark', () => {
    const [c, g] = makeCanvas(16, 16);
    dot(g, 0, 0, '#f0f0f0', 16, 2);
    dot(g, 0, 0, '#f0f0f0', 2, 8);
    dot(g, 14, 0, '#f0f0f0', 2, 8);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function pitBoxTex(n, colorHex) {
  return once('box' + n, () => {
    const [c, g] = makeCanvas(32, 32);
    const [r0, g0, b0] = hexToRgb(colorHex);
    dot(g, 0, 0, rgb(r0, g0, b0, 0.28), 32, 32);
    // frame
    dot(g, 0, 0, '#f4f4f4', 32, 2);
    dot(g, 0, 30, '#f4f4f4', 32, 2);
    dot(g, 0, 0, '#f4f4f4', 2, 32);
    dot(g, 30, 0, '#f4f4f4', 2, 32);
    // stop target line (centre)
    dot(g, 4, 15, '#ffd23b', 24, 2);
    dot(g, 2, 13, '#ffd23b', 2, 6);
    dot(g, 28, 13, '#ffd23b', 2, 6);
    drawText(g, String(n), 16, 4, 1, '#ffffff', 'center', null);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function dashTex() {
  return once('dash', () => {
    const [c, g] = makeCanvas(32, 32);
    dot(g, 0, 0, '#f07818', 32, 32);
    dot(g, 0, 0, '#b04c08', 2, 32);
    dot(g, 30, 0, '#b04c08', 2, 32);
    // chevrons pointing "up" (= forward)
    for (let k = 0; k < 2; k++) {
      const oy = k * 16 + 3;
      for (let i = 0; i < 8; i++) {
        dot(g, 15 - i - 1, oy + i, '#ffe84a', 3, 2);
        dot(g, 16 + i - 1, oy + i, '#ffe84a', 3, 2);
      }
    }
    return pixelTexture(c, { mip: false });
  });
}

export function paintTextTex(text, fg = '#ffffff', bg = null, pad = 2) {
  return once('ptext' + text + fg + bg, () => {
    const w = measureText(text, 1) + pad * 2;
    const [c, g] = makeCanvas(w, 7 + pad * 2);
    if (bg) dot(g, 0, 0, bg, w, 7 + pad * 2);
    drawText(g, text, pad, pad, 1, fg, 'left', null);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

// ---------------- Walls / buildings ----------------
export function tyreWallTex() {
  return once('tyrewall', () => {
    const [c, g] = makeCanvas(32, 32);
    // top band red/white
    for (let x = 0; x < 32; x += 8) dot(g, x, 0, (x / 8) % 2 ? '#f0f0f0' : '#d82828', 8, 9);
    dot(g, 0, 9, '#202024', 32, 23);
    // stacked tyres
    for (let row = 0; row < 3; row++) {
      for (let x = 0; x < 32; x += 8) {
        const oy = 10 + row * 7 + (row % 2) * 0;
        dot(g, x + 1, oy, '#3a3a40', 6, 6);
        dot(g, x + 2, oy + 1, '#55555c', 4, 1);
        dot(g, x + 3, oy + 2, '#141416', 2, 2);
      }
    }
    return pixelTexture(c);
  });
}

export function concreteTex() {
  return once('concrete', () => {
    const [c, g] = makeCanvas(32, 32);
    const r = mulberry32(51);
    noiseFill(g, 32, 32, [176, 176, 180], 8, r, 2);
    dot(g, 0, 0, '#d0d0d4', 32, 2);
    dot(g, 31, 0, '#8c8c92', 1, 32);
    dot(g, 0, 22, '#2a5cc8', 32, 4);
    return pixelTexture(c);
  });
}

export function crowdTex() {
  return once('crowd', () => {
    const [c, g] = makeCanvas(64, 32);
    const r = mulberry32(61);
    dot(g, 0, 0, '#3a3a48', 64, 32);
    const cols = ['#e83b3b', '#3b6ee8', '#f0d040', '#ffffff', '#40c060', '#f08030', '#c050e0', '#f4c8a0', '#202020'];
    for (let y = 2; y < 32; y += 6) {
      dot(g, 0, y + 4, '#5a5a68', 64, 1);
      for (let x = 1; x < 64; x += 3) {
        if (r() < 0.85) {
          dot(g, x, y + 1, cols[Math.floor(r() * cols.length)], 2, 2);
          dot(g, x, y, '#e8c098', 2, 1);
        }
      }
    }
    return pixelTexture(c);
  });
}

export function garageTex() {
  return once('garage', () => {
    const [c, g] = makeCanvas(64, 32);
    dot(g, 0, 0, '#d4d4dc', 64, 32);
    dot(g, 0, 0, '#2a5cc8', 64, 4);
    dot(g, 0, 4, '#f0f0f0', 64, 1);
    // door opening
    dot(g, 14, 10, '#1c1c24', 36, 22);
    for (let y = 11; y < 32; y += 3) dot(g, 14, y, '#2c2c36', 36, 1);
    dot(g, 12, 8, '#8c8c96', 40, 2);
    // lights
    dot(g, 4, 12, '#ffe890', 4, 2);
    dot(g, 56, 12, '#ffe890', 4, 2);
    dot(g, 63, 0, '#9a9aa4', 1, 32);
    return pixelTexture(c);
  });
}

// ---------------- Scenery sprites ----------------
export function pineTex(snowy = false) {
  return once('pine' + snowy, () => {
    const [c, g] = makeCanvas(32, 48);
    dot(g, 14, 38, '#6a4424', 4, 10);
    dot(g, 15, 38, '#8a5a30', 1, 10);
    const layers = [[6, 36, 13], [12, 28, 11], [18, 20, 9], [24, 12, 6]];
    for (const [top, bottom, half] of layers) {
      for (let y = top - 6; y < bottom; y++) {
        const t = (y - (top - 6)) / (bottom - (top - 6));
        const w = Math.max(1, Math.round(half * t));
        dot(g, 16 - w, y, '#2c6a34', w * 2, 1);
        dot(g, 16 - w, y, '#3e8a42', Math.max(1, Math.round(w * 0.7)), 1);
        if (snowy && y < top - 3) dot(g, 16 - w, y, '#f4f8ff', w * 2, 1);
      }
      if (snowy) dot(g, 16 - half, bottom - 1, '#dce8f8', half * 2, 1);
    }
    dot(g, 15, 0, snowy ? '#f4f8ff' : '#3e8a42', 2, 3);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function roundTreeTex(leaves = ['#3e8a3c', '#2e6c2c', '#5aa850'], variant = 0) {
  return once('roundtree' + leaves.join() + variant, () => {
    const [c, g] = makeCanvas(32, 40);
    dot(g, 14, 26, '#6a4424', 4, 14);
    const r = mulberry32(71 + variant * 13);
    const [mid, dark, light] = leaves;
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x - 16, dy = y - 14;
        const d = Math.sqrt(dx * dx * 1.0 + dy * dy * 1.2);
        if (d < 13 + r() * 1.5) {
          const hl = dx < -2 && dy < -2;
          dot(g, x, y, hl ? light : (r() < 0.2 ? dark : mid));
        }
      }
    }
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function cactusTex() {
  return once('cactus', () => {
    const [c, g] = makeCanvas(24, 40);
    const body = '#4f8a3a', dark = '#2f6a2a', light = '#7cb85a';
    dot(g, 9, 4, body, 6, 36);
    dot(g, 9, 4, light, 2, 36);
    dot(g, 14, 4, dark, 1, 36);
    dot(g, 10, 2, body, 4, 2);
    // arms
    dot(g, 2, 14, body, 7, 4); dot(g, 2, 6, body, 4, 10); dot(g, 2, 6, light, 1, 10);
    dot(g, 15, 20, body, 6, 4); dot(g, 18, 10, body, 4, 12); dot(g, 21, 10, dark, 1, 12);
    for (let y = 6; y < 38; y += 5) dot(g, 11, y, '#e8e0a0', 1, 1);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function smokeTex() {
  return once('smoke', () => {
    const [c, g] = makeCanvas(32, 32);
    const r = mulberry32(81);
    const blobs = [[16, 16, 11], [10, 13, 7], [22, 12, 7], [12, 21, 7], [21, 21, 7]];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        let inside = false, edge = false;
        for (const [bx, by, br] of blobs) {
          const d = Math.hypot(x - bx, y - by);
          if (d < br) { inside = true; if (d > br - 2) edge = true; }
        }
        if (inside) {
          const v = edge ? 150 : 200 + r() * 25;
          dot(g, x, y, rgb(v, v, v + 5, 1));
        }
      }
    }
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

// ---------------- Sky & horizon ----------------
export const SKY_HORIZON = 0xaad7fa;

export function skyTex() {
  return once('sky', () => {
    const W = 256, H = 128;
    const [c, g] = makeCanvas(W, H);
    const top = [40, 92, 200], hor = [170, 215, 250];
    // banded gradient (dithered) for the retro look
    for (let y = 0; y < H; y++) {
      const t = Math.min(1, y / (H * 0.5));
      for (let x = 0; x < W; x++) {
        const dither = ((x + y) % 2) * 0.03;
        const tt = Math.min(1, Math.floor((t + dither) * 12) / 12);
        dot(g, x, y, rgb(top[0] + (hor[0] - top[0]) * tt, top[1] + (hor[1] - top[1]) * tt, top[2] + (hor[2] - top[2]) * tt));
      }
    }
    // clouds
    const r = mulberry32(91);
    for (let i = 0; i < 22; i++) {
      const cx = r() * W, cy = 28 + r() * 30, w = 10 + r() * 22;
      for (let k = 0; k < 5; k++) {
        const bx = cx + (r() - 0.5) * w, by = cy + (r() - 0.5) * 4, bw = 6 + r() * w * 0.6, bh = 3 + r() * 3;
        dot(g, Math.round(bx), Math.round(by), '#ffffff', Math.round(bw), Math.round(bh));
        dot(g, Math.round(bx), Math.round(by + bh), '#dfe9f6', Math.round(bw), 1);
      }
    }
    const t = pixelTexture(c, { mip: false });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export function mountainTex(theme = 'green') {
  return once('mountains' + theme, () => {
    const T = THEMES[theme] || THEMES.green;
    const W = 256, H = 48;
    const [c, g] = makeCanvas(W, H);
    const r = mulberry32(101);
    const mesa = theme === 'desert';
    const ridge = (base, rough, col, snow) => {
      let h = base;
      for (let x = 0; x < W; x++) {
        h += (r() - 0.5) * rough;
        // keep periodic
        const wrapPull = (base - h) * 0.04;
        h += wrapPull;
        h = Math.max(4, Math.min(H - 2, h));
        const hh = mesa ? Math.round(h / 6) * 6 : h; // flat-topped mesas in the desert
        const top = Math.round(H - hh);
        dot(g, x, top, col, 1, H - top);
        if (snow && h > base + 5) dot(g, x, top, '#f4f8ff', 1, 2);
        if (mesa) dot(g, x, top, shade(col, 1.25), 1, 1);
      }
    };
    ridge(26, 5, T.mtn[0], T.snowCaps);
    ridge(14, 3.5, T.mtn[1], false);
    const t = pixelTexture(c, { mip: false });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// ---------------- Night ----------------
export const NIGHT_HORIZON = 0x141c38;

export function skyNightTex() {
  return once('skynight', () => {
    const W = 256, H = 128;
    const [c, g] = makeCanvas(W, H);
    const top = [4, 6, 20], hor = [20, 28, 56];
    for (let y = 0; y < H; y++) {
      const t = Math.min(1, y / (H * 0.5));
      for (let x = 0; x < W; x++) {
        const dither = ((x + y) % 2) * 0.04;
        const tt = Math.min(1, Math.floor((t + dither) * 10) / 10);
        dot(g, x, y, rgb(top[0] + (hor[0] - top[0]) * tt, top[1] + (hor[1] - top[1]) * tt, top[2] + (hor[2] - top[2]) * tt));
      }
    }
    const r = mulberry32(303);
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(r() * W), y = Math.floor(r() * 58);
      const b = r();
      dot(g, x, y, b > 0.92 ? '#ffffff' : b > 0.6 ? '#c8d0f0' : '#7880a8');
    }
    // moon
    const mx = 60, my = 26;
    for (let y = -7; y <= 7; y++) {
      for (let x = -7; x <= 7; x++) {
        const d = Math.hypot(x, y);
        if (d <= 6.5) dot(g, mx + x, my + y, (x > 2 && y < -1) ? '#c8c8b0' : '#f4f0d0');
      }
    }
    dot(g, mx - 2, my + 1, '#d8d4b8', 2, 2);
    dot(g, mx + 1, my - 3, '#d8d4b8', 1, 1);
    const t = pixelTexture(c, { mip: false });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/** banded radial glow (for lamp pools on the road, additive blending) */
export function lightPoolTex() {
  return once('lightpool', () => {
    const S = 32;
    const [c, g] = makeCanvas(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
        if (d >= 1) continue;
        const band = Math.floor((1 - d) * 4) / 4; // 4 hard bands
        const v = Math.round(255 * band);
        dot(g, x, y, rgb(v, v, v));
      }
    }
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

/** headlight beam on the road: wide at the far end (canvas top), banded */
export function headBeamTex() {
  return once('headbeam', () => {
    const W = 32, H = 32;
    const [c, g] = makeCanvas(W, H);
    for (let y = 0; y < H; y++) {
      const along = 1 - y / H;              // 0 near the kart (bottom) .. 1 far (top)
      const half = 4 + along * 12;
      const fade = along < 0.15 ? along / 0.15 : 1 - Math.max(0, (along - 0.6) / 0.4);
      for (let x = 0; x < W; x++) {
        const across = Math.abs(x - W / 2 + 0.5) / half;
        if (across >= 1) continue;
        const v = Math.round(255 * Math.floor(Math.max(0, fade * (1 - across * 0.6)) * 4) / 4);
        dot(g, x, y, rgb(v, v, v));
      }
    }
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

// ---------------- Kart parts ----------------
export function kartBodyTex(colorHex, num) {
  return once('kart' + colorHex + num, () => {
    const [c, g] = makeCanvas(32, 32);
    dot(g, 0, 0, shade(colorHex, 1.0), 32, 32);
    dot(g, 0, 0, shade(colorHex, 1.25), 32, 6);
    dot(g, 0, 26, shade(colorHex, 0.7), 32, 6);
    dot(g, 0, 12, '#f4f4f4', 32, 2);
    dot(g, 0, 18, '#f4f4f4', 32, 1);
    // number roundel
    dot(g, 10, 8, '#f4f4f4', 12, 14);
    dot(g, 9, 9, '#f4f4f4', 14, 12);
    drawText(g, String(num), 16, 12, 1, '#101010', 'center', null);
    return pixelTexture(c, { mip: false });
  });
}

export function wheelTex() {
  return once('wheel', () => {
    const [c, g] = makeCanvas(16, 16);
    dot(g, 0, 0, '#26262a', 16, 16);
    for (let x = 0; x < 16; x += 3) dot(g, x, 0, '#3c3c42', 1, 16);
    return pixelTexture(c, { mip: false });
  });
}

export function steeringTex(accentHex) {
  return once('steer' + accentHex, () => {
    const S = 64;
    const [c, g] = makeCanvas(S, S);
    const cx = 31.5, cy = 31.5;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= 30 && d >= 24) {
          const hl = (x < cx - 8 && y < cy - 8 && d > 26 && d < 28);
          dot(g, x, y, hl ? '#6c6c78' : (d > 29 || d < 25 ? '#18181c' : '#34343c'));
        }
      }
    }
    // spokes (3-spoke)
    dot(g, 6, 29, '#2a2a30', 52, 6);
    dot(g, 6, 30, '#50505a', 52, 1);
    dot(g, 29, 32, '#2a2a30', 6, 24);
    // hub
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 9) dot(g, x, y, d < 7 ? shade(accentHex, 1.0) : '#18181c');
      }
    }
    dot(g, 29, 29, '#f4f4f4', 6, 6);
    dot(g, 30, 30, shade(accentHex, 0.7), 4, 4);
    // top centre marker
    dot(g, 29, 1, '#ffd23b', 6, 6);
    // gloves at 9 & 3 o'clock
    const glove = (gx) => {
      dot(g, gx, 22, '#141418', 10, 20);
      dot(g, gx + 1, 23, shade(accentHex, 0.9), 8, 18);
      dot(g, gx + 1, 23, shade(accentHex, 1.2), 8, 3);
      for (let k = 0; k < 4; k++) dot(g, gx + 1, 27 + k * 4, shade(accentHex, 0.6), 8, 1);
    };
    glove(0);
    glove(54);
    return pixelTexture(c, { repeat: false, mip: false });
  });
}

export function nameTagTex(name, colorHex) {
  const [c, g] = makeCanvas(128, 24);
  g.font = 'bold 16px "MS Gothic", "Osaka", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(124, g.measureText(name).width + 12);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(64 - w / 2, 2, w, 20);
  g.fillStyle = colorHex;
  g.fillRect(64 - w / 2, 2, 3, 20);
  g.fillStyle = '#ffffff';
  g.fillText(name, 64 + 1, 13);
  return pixelTexture(c, { repeat: false, mip: false });
}

/** chevron board: "<" for a left hairpin, ">" when right = true */
export function chevronTex(right = false) {
  return once('chevron' + right, () => {
    const [c, g] = makeCanvas(16, 16);
    dot(g, 0, 0, '#d82828', 16, 16);
    for (let i = 0; i < 6; i++) {
      const x = right ? 4 + i : 10 - i;
      dot(g, x, 2 + i, '#f4f4f4', 3, 1);
      dot(g, x, 13 - i, '#f4f4f4', 3, 1);
    }
    return pixelTexture(c, { mip: false });
  });
}
