// ============================================================
//  HUD – drawn every frame on a low-res 2D canvas (960x540),
//  upscaled with image-rendering: pixelated over the 3D view.
// ============================================================
import { HUD_W, HUD_H, MIRROR, RENDER_W, TYRES, PIT, KART_COLORS } from './config.js';
import { drawText, measureText } from './pixelfont.js';

const JP_FONT = '"MS Gothic", "Osaka-Mono", "Noto Sans Mono CJK JP", monospace';
const S = HUD_W / RENDER_W; // HUD pixels per render pixel (2)

function fmtTime(sec, tenths = true) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}${tenths ? '.' + t : ''}`;
}
export function fmtLap(sec) {
  if (!sec) return '-:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function ordinal(n) {
  return n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`;
}

/**
 * Pixel map of a track: road, dirt shortcut (brown), pit lane (yellow),
 * dash panels (orange arrows) and the start line (red).
 * Returns { canvas, transform: {ox, oz, sc} } so karts can be plotted on top.
 */
export function renderTrackMap(tr, W, H, { background = null, pad = 8, dot = 2, dashSize = 5 } = {}) {
  const { minX, maxX, minZ, maxZ } = tr.bbox;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = pad + ((W - pad * 2) - (maxX - minX) * sc) / 2 - minX * sc;
  const oz = pad + ((H - pad * 2) - (maxZ - minZ) * sc) / 2 - minZ * sc;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (background) { g.fillStyle = background; g.fillRect(0, 0, W, H); }
  const P = (x, z) => [Math.round(ox + x * sc), Math.round(oz + z * sc)];
  // dirt shortcut
  const a = P(tr.dirtA.x, tr.dirtA.z), b = P(tr.dirtB.x, tr.dirtB.z);
  g.strokeStyle = '#b07a40';
  g.lineWidth = dot;
  g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  // track (crisp pixel dots)
  g.fillStyle = '#e8e8f0';
  for (let i = 0; i < tr.N; i += 1) {
    const [x, y] = P(tr.cx[i], tr.cz[i]);
    g.fillRect(x - (dot >> 1), y - (dot >> 1), dot, dot);
  }
  // pit lane
  g.fillStyle = '#f0c020';
  for (let u = PIT.U0; u <= PIT.U1; u += 2) {
    const p = tr.pointAt(tr.uToDist(u), tr.pitCenter(u));
    const [x, y] = P(p.x, p.z);
    g.fillRect(x, y, 1, 1);
  }
  // dash panels: small orange arrowheads pointing along the travel direction
  const hs = dashSize >> 1;
  for (const d of tr.dash) {
    const p = tr.pointAt(d.dist, d.d);
    const [x, y] = P(p.x, p.z);
    g.fillStyle = '#000000';
    g.fillRect(x - hs - 1, y - hs - 1, dashSize + 2, dashSize + 2);
    g.fillStyle = '#ff8a1e';
    g.fillRect(x - hs, y - hs, dashSize, dashSize);
    // yellow tick pointing along the travel direction
    g.fillStyle = '#ffe84a';
    for (let k = 0; k <= hs; k++) g.fillRect(x + Math.round(p.tx * k), y + Math.round(p.tz * k), 1, 1);
  }
  // start line
  const s = P(0, 0);
  g.fillStyle = '#ff4040';
  g.fillRect(s[0] - 1, s[1] - 3, 2, 6);
  return { canvas: c, transform: { ox, oz, sc } };
}

// Panel positions. On touch devices the bottom corners belong to the thumbs,
// so speed moves to the bottom centre and tyre/minimap stack on the left.
const LAYOUTS = {
  desktop: { tyre: [10, 420], skill: [10, 350], minimap: [800, 250], speed: [710, 404, 240, 124] },
  touch: { tyre: [10, 154], skill: null, minimap: [10, 270], speed: [350, 448, 260, 84] },
};

export class Hud {
  constructor(canvas, track) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.track = track;
    this.messages = [];
    this.visible = false;
    this.L = LAYOUTS.desktop;
    this._buildMinimap();
    this._buildSmoke();
  }

  setTouch(on) { this.L = on ? LAYOUTS.touch : LAYOUTS.desktop; }

  message(text, color = '#ffffff', dur = 1.6, scale = 6) {
    this.messages = this.messages.filter(m => m.text !== text);
    this.messages.push({ text, color, t: 0, dur, scale });
    if (this.messages.length > 3) this.messages.shift();
  }

  clear() {
    this.g.clearRect(0, 0, HUD_W, HUD_H);
  }

  // ---------------- static layers ----------------
  setTrack(track) {
    this.track = track;
    this._buildMinimap();
  }

  _buildMinimap() {
    const m = renderTrackMap(this.track, 150, 120, { background: 'rgba(10,14,30,0.6)', dashSize: 7 });
    this.mm = m.transform;
    this.mmCanvas = m.canvas;
  }

  _buildSmoke() {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const g = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 160, y = rnd() * 90, r = 6 + rnd() * 16;
      const v = 150 + Math.floor(rnd() * 70);
      g.fillStyle = `rgb(${v},${v},${v + 6})`;
      for (let yy = -r; yy <= r; yy += 2) {
        const w = Math.sqrt(r * r - yy * yy);
        g.fillRect(Math.round(x - w), Math.round(y + yy), Math.round(w * 2), 2);
      }
    }
    this.smokeCanvas = c;
  }

  // ---------------- main draw ----------------
  draw(st, dt) {
    const g = this.g;
    g.clearRect(0, 0, HUD_W, HUD_H);
    const time = st.time;

    // full-screen effects first (under the panels)
    if (st.smoke > 0) this._drawSmoke(st.smoke, time);
    if (st.boost) this._drawSpeedLines(time);
    if (st.slip > 0.05) this._drawWind(st.slip, time);
    if (st.spurt) this._drawSpurtFrame(time);
    if (st.tyre <= 30 && st.phase === 'race') this._drawLowTyreEdge(st.tyre, time);

    this._drawMirrorDecor(st, time);
    this._drawTimer(st, time);
    this._drawStandings(st);
    this._drawMinimap(st);
    this._drawSpeed(st, time);
    this._drawTyre(st, time);
    this._drawSkill(st, time);
    if (st.pitInfo) this._drawPit(st.pitInfo, time);
    if (st.countdown !== null) this._drawCountdown(st.countdown);
    this._drawMessages(dt);
  }

  _panel(x, y, w, h) {
    const g = this.g;
    g.fillStyle = 'rgba(8,10,24,0.62)';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x, y, w, 2);
    g.fillRect(x, y, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, y + h - 2, w, 2);
    g.fillRect(x + w - 2, y, 2, h);
  }

  _drawMirrorDecor(st, time) {
    const g = this.g;
    const x = MIRROR.x * S, y = MIRROR.y * S, w = MIRROR.w * S, h = MIRROR.h * S;
    if (st.rearWarn > 0 && Math.floor(time * 6) % 2 === 0) {
      g.fillStyle = '#ff3030';
      // arrows on both sides of the mirror
      for (let k = 0; k < 4; k++) {
        g.fillRect(x - 14 + k * 2, y + h / 2 - 8 + k * 2, 2, 16 - k * 4);
        g.fillRect(x + w + 12 - k * 2, y + h / 2 - 8 + k * 2, 2, 16 - k * 4);
      }
    }
    if (st.slip > 0.05) {
      const label = 'SLIPSTREAM';
      drawText(g, label, HUD_W / 2, y + h + 10, 2, st.slip >= 1 ? '#7cf0ff' : '#c8f8ff', 'center');
      const bw = 120;
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(HUD_W / 2 - bw / 2, y + h + 28, bw, 6);
      g.fillStyle = '#7cf0ff';
      g.fillRect(HUD_W / 2 - bw / 2, y + h + 28, Math.round(bw * st.slip), 6);
    }
  }

  _drawTimer(st, time) {
    const g = this.g;
    this._panel(10, 10, 230, 118);
    drawText(g, 'TIME LEFT', 22, 20, 2, '#a8c8ff');
    const red = st.remaining <= 30 && st.phase === 'race';
    const blinkOff = red && Math.floor(time * 4) % 2 === 1;
    if (!blinkOff) drawText(g, fmtTime(st.remaining), 22, 40, 5, red ? '#ff3a3a' : '#ffffff');
    drawText(g, `LAP ${Math.max(1, st.lap)}`, 22, 86, 3, '#ffe060');
    drawText(g, `BEST ${fmtLap(st.bestLap)}`, 120, 92, 1, '#c0c0d0');
    drawText(g, `LAST ${fmtLap(st.lastLap)}`, 120, 104, 1, '#c0c0d0');
    if (st.spurtLabel) {
      const on = Math.floor(time * 3) % 2 === 0;
      drawText(g, st.spurtLabel, 22, 136, 2, on ? '#ff5050' : '#ffd0d0');
    }
  }

  _drawStandings(st) {
    const g = this.g;
    const x = 760, y = 10, w = 190;
    this._panel(x, y, w, 64);
    drawText(g, 'POS', x + 12, y + 10, 2, '#a8c8ff');
    drawText(g, ordinal(st.position), x + 12, y + 26, 4, st.position === 1 ? '#ffd23b' : '#ffffff');
    drawText(g, `/${st.total}`, x + 12 + measureText(ordinal(st.position), 4) + 6, y + 40, 2, '#c0c0d0');
    const rows = st.standings.slice(0, 8);
    const rh = 18;
    this._panel(x, y + 70, w, rows.length * rh + 10);
    g.font = `bold 13px ${JP_FONT}`;
    g.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const ry = y + 76 + i * rh;
      if (r.isMe) {
        g.fillStyle = 'rgba(255,255,255,0.15)';
        g.fillRect(x + 4, ry - 1, w - 8, rh);
      }
      drawText(g, String(i + 1), x + 10, ry + 4, 1, '#ffffff');
      g.fillStyle = r.color;
      g.fillRect(x + 20, ry + 2, 6, 12);
      g.fillStyle = r.isMe ? '#ffe060' : '#ffffff';
      g.fillText(r.name.slice(0, 8), x + 32, ry + 9);
      const gap = i === 0 ? `L${Math.max(1, r.lap + 1)}` : `-${Math.round(r.gapM)}M`;
      drawText(g, r.pit ? 'PIT' : gap, x + w - 10, ry + 4, 1, r.pit ? '#f0c020' : '#a0a0b8', 'right');
    });
  }

  _drawMinimap(st) {
    const g = this.g;
    const [x, y] = this.L.minimap;
    g.drawImage(this.mmCanvas, x, y);
    const { ox, oz, sc } = this.mm;
    for (const k of st.karts) {
      const px = Math.round(x + ox + k.x * sc), py = Math.round(y + oz + k.z * sc);
      g.fillStyle = '#000';
      g.fillRect(px - 3, py - 3, k.isMe ? 7 : 6, k.isMe ? 7 : 6);
      g.fillStyle = k.color;
      g.fillRect(px - 2, py - 2, k.isMe ? 5 : 4, k.isMe ? 5 : 4);
    }
  }

  /** rev-counter LEDs: green -> yellow -> red; flashes cyan as a shift light */
  _drawRevBar(x, y, w, h, rpm, shiftLight, time) {
    const g = this.g;
    const segs = 24;
    const step = w / segs;
    const flash = shiftLight && Math.floor(time * 12) % 2 === 0;
    for (let i = 0; i < segs; i++) {
      const f = (i + 1) / segs;
      const on = rpm >= f - 0.5 / segs;
      let col = f <= 0.6 ? '#30e070' : f <= 0.85 ? '#f0d030' : '#ff4040';
      if (flash && on) col = '#7cf0ff';
      g.fillStyle = on ? col : (f > 0.85 ? 'rgba(255,64,64,0.18)' : 'rgba(255,255,255,0.08)');
      g.fillRect(Math.round(x + i * step), y, Math.max(2, Math.round(step) - 2), h);
    }
  }

  _drawGearBox(x, y, w, h, gear, scale) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#ffd23b';
    g.fillRect(x, y, w, 2); g.fillRect(x, y + h - 2, w, 2); g.fillRect(x, y, 2, h); g.fillRect(x + w - 2, y, 2, h);
    drawText(g, String(gear), x + w / 2, y + Math.round((h - 7 * scale) / 2), scale, gear === 'R' ? '#ff6060' : '#ffffff', 'center');
  }

  _drawSpeed(st, time) {
    const g = this.g;
    const [x, y, w, h] = this.L.speed;
    const spd = String(Math.round(st.speedKmh)).padStart(3, ' ');
    const rpmText = String(Math.round(st.rpmValue / 100) * 100);
    this._panel(x, y, w, h);
    if (h < 100) {
      // compact (touch layout): rev bar on top, gear left, speed right
      this._drawRevBar(x + 8, y + 8, w - 16, 8, st.rpm, st.shiftLight, time);
      this._drawGearBox(x + 8, y + 22, 46, 54, st.gear, 6);
      drawText(g, `${rpmText} RPM`, x + 62, y + 24, 1, '#a8c8ff');
      drawText(g, 'GEAR', x + 62, y + 66, 1, '#ffd23b');
      drawText(g, spd, x + w - 64, y + 30, 6, st.boost ? '#7cf0ff' : '#ffffff', 'right');
      drawText(g, 'KM/H', x + w - 10, y + 58, 2, '#a8c8ff', 'right');
      if (st.limiter) drawText(g, 'PIT', x + w - 10, y + 26, 2, '#f0c020', 'right');
      return;
    }
    this._drawRevBar(x + 10, y + 10, w - 20, 12, st.rpm, st.shiftLight, time);
    drawText(g, 'RPM', x + 10, y + 28, 1, '#a8c8ff');
    drawText(g, rpmText, x + 32, y + 27, 2, st.rpm >= 0.86 ? '#ff6060' : '#ffffff');
    if (st.limiter) drawText(g, 'PIT LIMIT', x + w - 10, y + 28, 1, '#f0c020', 'right');
    this._drawGearBox(x + 10, y + 44, 58, 66, st.gear, 7);
    drawText(g, 'GEAR', x + 39, y + 114, 1, '#ffd23b', 'center');
    drawText(g, spd, x + w - 12, y + 46, 7, st.boost ? '#7cf0ff' : '#ffffff', 'right');
    drawText(g, 'KM/H', x + w - 12, y + 102, 2, '#a8c8ff', 'right');
  }

  _drawTyre(st, time) {
    const g = this.g;
    const [x, y] = this.L.tyre;
    const w = 250, h = 108;
    this._panel(x, y, w, h);
    const T = TYRES[st.tyreType];
    // compound badge
    const cx = x + 40, cy = y + 50;
    for (let yy = -26; yy <= 26; yy += 2) {
      const ww = Math.round(Math.sqrt(26 * 26 - yy * yy));
      g.fillStyle = '#18181c';
      g.fillRect(cx - ww, cy + yy, ww * 2, 2);
    }
    for (let yy = -20; yy <= 20; yy += 2) {
      const ww = Math.round(Math.sqrt(20 * 20 - yy * yy));
      g.fillStyle = T.color;
      g.fillRect(cx - ww, cy + yy, ww * 2, 2);
    }
    for (let yy = -15; yy <= 15; yy += 2) {
      const ww = Math.round(Math.sqrt(15 * 15 - yy * yy));
      g.fillStyle = '#2a2a30';
      g.fillRect(cx - ww, cy + yy, ww * 2, 2);
    }
    drawText(g, st.tyreType, cx, cy - 10, 3, T.color, 'center');
    drawText(g, 'TYRE ' + T.en, x + 80, y + 12, 2, '#a8c8ff');
    const pct = Math.max(0, st.tyre);
    const col = pct > 50 ? '#40e070' : pct > 30 ? '#f0d030' : '#ff4040';
    const blink = pct <= 30 && Math.floor(time * 4) % 2 === 1;
    drawText(g, `${Math.ceil(pct)}%`, x + 80, y + 32, 5, blink ? '#802020' : col);
    // bar
    const bx = x + 80, by = y + 76, bw = 156;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(bx, by, bw, 12);
    g.fillStyle = col;
    g.fillRect(bx + 2, by + 2, Math.round((bw - 4) * pct / 100), 8);
    for (let k = 1; k < 10; k++) {
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(bx + Math.round(bw * k / 10), by + 2, 1, 8);
    }
    if (pct <= 0) drawText(g, 'BURST!', bx, by + 16, 2, Math.floor(time * 6) % 2 ? '#ff2020' : '#ffffff');
    else if (pct <= 30) drawText(g, 'LOW GRIP - PIT IN!', bx, by + 16, 1, '#ff8080');
  }

  _drawSkill(st, time) {
    const g = this.g;
    const sk = st.skill;
    if (!sk || !this.L.skill) return;
    const [x, y] = this.L.skill;
    const w = 250, h = 62;
    this._panel(x, y, w, h);
    g.font = `bold 16px ${JP_FONT}`;
    g.textBaseline = 'top';
    g.fillStyle = '#ffffff';
    g.fillText(sk.def.name, x + 12, y + 9);
    if (sk.def.type === 'passive') {
      drawText(g, 'PASSIVE', x + w - 12, y + 12, 1, '#80c0ff', 'right');
      drawText(g, sk.def.en, x + 12, y + 38, 2, '#a8c8ff');
    } else {
      const bx = x + 12, by = y + 36, bw = w - 24;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(bx, by, bw, 16);
      const frac = sk.cdTotal ? 1 - sk.cd / sk.cdTotal : 1;
      if (sk.cd <= 0) {
        const on = Math.floor(time * 3) % 2 === 0;
        g.fillStyle = on ? '#40e070' : '#30a050';
        g.fillRect(bx + 2, by + 2, bw - 4, 12);
        drawText(g, st.skillKey ? `READY! [${st.skillKey}]` : 'READY!', bx + bw / 2, by + 4, 1, '#06200e', 'center', null);
      } else {
        g.fillStyle = '#e0a020';
        g.fillRect(bx + 2, by + 2, Math.round((bw - 4) * frac), 12);
        drawText(g, `CT ${Math.ceil(sk.cd)}S`, bx + bw / 2, by + 4, 1, '#ffffff', 'center');
      }
      drawText(g, 'ACTIVE', x + w - 12, y + 12, 1, '#ffb040', 'right');
    }
  }

  _drawPit(p, time) {
    const g = this.g;
    const cx = HUD_W / 2;
    if (p.limiter) {
      const on = Math.floor(time * 2) % 2 === 0;
      drawText(g, 'PIT LANE  60KM/H', cx, 112, 2, on ? '#f0c020' : '#ffffff', 'center');
    }
    if (p.gauge) {
      // stop-position mini game: gauge of +-10m around the next box centre
      const w = 300, x = cx - w / 2, y = 140;
      this._panel(x - 10, y - 26, w + 20, 62);
      drawText(g, `BOX ${p.gauge.index + 1}`, x, y - 18, 2, '#ffffff');
      drawText(g, p.gauge.text, x + w, y - 18, 2, p.gauge.color, 'right');
      const range = 10;
      const toX = v => x + (v + range) / (range * 2) * w;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x, y, w, 18);
      g.fillStyle = 'rgba(240,192,32,0.45)';
      g.fillRect(toX(-PIT.BOX_LEN / 2), y, toX(PIT.BOX_LEN / 2) - toX(-PIT.BOX_LEN / 2), 18);
      g.fillStyle = '#40e070';
      g.fillRect(toX(-PIT.PERFECT), y, toX(PIT.PERFECT) - toX(-PIT.PERFECT), 18);
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(cx) - 1, y - 4, 2, 26);
      // kart marker (position relative to box centre, positive = past it)
      const v = Math.max(-range, Math.min(range, p.gauge.offset));
      const mx = Math.round(toX(v));
      g.fillStyle = '#ff3a3a';
      for (let k = 0; k < 5; k++) g.fillRect(mx - 5 + k, y + 20 + k, 10 - k * 2, 1);
      g.fillRect(mx - 1, y - 2, 3, 22);
    }
  }

  _drawCountdown(cd) {
    const g = this.g;
    if (cd.text) {
      const big = cd.text.length <= 3 ? 16 : 10;
      drawText(g, cd.text, HUD_W / 2, HUD_H / 2 - big * 5, big, cd.color || '#ffffff', 'center', '#000');
    }
    if (cd.sub) drawText(g, cd.sub, HUD_W / 2, HUD_H / 2 + 60, 2, '#ffffff', 'center');
  }

  _drawMessages(dt) {
    const g = this.g;
    let y = 196;
    for (const m of this.messages) {
      m.t += dt;
      const a = m.t > m.dur - 0.3 ? Math.max(0, (m.dur - m.t) / 0.3) : 1;
      if (a <= 0) continue;
      g.globalAlpha = a;
      drawText(g, m.text, HUD_W / 2, y, m.scale, m.color, 'center', '#000');
      g.globalAlpha = 1;
      y += m.scale * 7 + 12;
    }
    this.messages = this.messages.filter(m => m.t < m.dur);
  }

  // ---------------- screen effects ----------------
  _drawSmoke(amount, time) {
    const g = this.g;
    g.globalAlpha = Math.min(0.92, amount);
    const ox = Math.floor((time * 30) % 160);
    g.drawImage(this.smokeCanvas, ox, 0, 160 - ox, 90, 0, 0, (160 - ox) * 6, HUD_H);
    if (ox > 0) g.drawImage(this.smokeCanvas, 0, 0, ox, 90, (160 - ox) * 6, 0, ox * 6, HUD_H);
    g.globalAlpha = 1;
  }

  _drawSpeedLines(time) {
    const g = this.g;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(i * 12.3) * 0.2;
      const ph = (time * 3 + i * 0.37) % 1;
      const r0 = 260 + ph * 260, len = 40 + ph * 60;
      const x0 = HUD_W / 2 + Math.cos(a) * r0, y0 = HUD_H / 2 + Math.sin(a) * r0 * 0.6;
      for (let k = 0; k < len; k += 4) {
        g.fillRect(Math.round(x0 + Math.cos(a) * k), Math.round(y0 + Math.sin(a) * k * 0.6), 3, 3);
      }
    }
  }

  _drawWind(slip, time) {
    const g = this.g;
    g.fillStyle = `rgba(220,250,255,${0.25 + 0.5 * slip})`;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const y = 60 + ((i * 97) % 420);
      const ph = (time * (2.2 + (i % 3) * 0.6) + i * 0.29) % 1;
      const len = 30 + (i % 4) * 14;
      const xl = 6 + ph * 90, xr = HUD_W - 6 - ph * 90 - len;
      g.fillRect(Math.round(xl), y, len, 2);
      g.fillRect(Math.round(xr), y + 20, len, 2);
    }
  }

  _drawSpurtFrame(time) {
    const g = this.g;
    const a = 0.25 + 0.25 * Math.sin(time * 8);
    g.fillStyle = `rgba(255,40,40,${a})`;
    const t = 10;
    g.fillRect(0, 0, HUD_W, t);
    g.fillRect(0, HUD_H - t, HUD_W, t);
    g.fillRect(0, 0, t, HUD_H);
    g.fillRect(HUD_W - t, 0, t, HUD_H);
    g.fillStyle = `rgba(255,120,40,${a * 0.5})`;
    g.fillRect(t, t, HUD_W - t * 2, 4);
    g.fillRect(t, HUD_H - t - 4, HUD_W - t * 2, 4);
  }

  _drawLowTyreEdge(tyre, time) {
    const g = this.g;
    const a = (1 - tyre / 30) * (0.18 + 0.12 * Math.sin(time * 10));
    g.fillStyle = `rgba(255,0,0,${Math.max(0, a)})`;
    g.fillRect(0, HUD_H - 6, HUD_W, 6);
  }
}

export { fmtTime, KART_COLORS };
