// ============================================================
//  Track model: centreline samples, track coordinates (dist/u/d),
//  drivable region field, surfaces, pit lane, shortcuts, dash panels,
//  water splashes (rally). Course kinds: circuit / rally / city.
// ============================================================
import * as THREE from 'three';
import { ROAD_HALF, CURB_W, BARRIER, PIT, DIRT_HALF } from './config.js';
import { COURSES } from './courses.js';

const CELL = 16;
const REACH = 36;

export class Track {
  constructor(course = COURSES[0]) {
    this.course = course;
    this.kind = course.kind || 'circuit';
    this.barrier = course.barrier || BARRIER;     // city streets have their walls closer
    this.roadGrip = course.roadGrip || 1;         // gravel / snow stages are slipperier
    this.carMode = this.kind === 'rally';         // rally: cars instead of karts
    const curve = new THREE.CatmullRomCurve3(
      course.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const N = this.N = Math.round(curve.getLength());
    const pts = curve.getSpacedPoints(N);

    const cx = this.cx = new Float64Array(N);
    const cz = this.cz = new Float64Array(N);
    for (let i = 0; i < N; i++) { cx[i] = pts[i].x; cz[i] = pts[i].z; }
    let L = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      L += Math.hypot(cx[j] - cx[i], cz[j] - cz[i]);
    }
    this.length = L;
    this.spacing = L / N;

    const tx = this.tx = new Float64Array(N), tz = this.tz = new Float64Array(N);
    const rx = this.rx = new Float64Array(N), rz = this.rz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = cx[b] - cx[a], dz = cz[b] - cz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz;
      rx[i] = -dz; rz[i] = dx;     // right-hand side of travel
    }
    // signed curvature (positive = turning right)
    const curv = this.curv = new Float64Array(N);
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      const h1 = Math.atan2(tz[a], tx[a]), h2 = Math.atan2(tz[b], tx[b]);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      raw[i] = dh / (4 * this.spacing);
    }
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += raw[(i + k + N) % N];
      curv[i] = s / 7;
    }
    // curbs at corners (circuits only)
    this.curb = new Uint8Array(N);
    for (let i = 0; i < N && this.kind === 'circuit'; i++) {
      if (Math.abs(curv[i]) > 1 / 75) {
        for (let k = -6; k <= 6; k++) this.curb[(i + k + N) % N] = 1;
      }
    }

    // bounding box
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]);
      minZ = Math.min(minZ, cz[i]); maxZ = Math.max(maxZ, cz[i]);
    }
    this.bbox = { minX, maxX, minZ, maxZ };

    this._buildHash();

    // ----- shortcuts: straight corridors across the inside of corners.
    // circuits: one dirt track across a hairpin (course.dirt = {from, to});
    // rally: rocky corner cuts (course.cuts = [{at:[x,z], span}]) that only pay off with an Aero Jump
    this.cuts = [];
    if (course.dirt) {
      const dirt = course.dirt;
      const qa = this.project(dirt.from.x, dirt.from.z);
      const qb = this.project(dirt.to.x, dirt.to.z);
      this._addCut(qa.dist, dirt.from.d, qb.dist, dirt.to.d, DIRT_HALF, 'dirt');
    }
    for (const c of course.cuts || []) {
      const q = this.project(c.at[0], c.at[1]);
      const side = Math.sign(this.curv[q.i]) || 1;   // inside of the corner
      const span = c.span || 30;
      this._addCut(q.dist - span, side * 5.5, q.dist + span, side * 5.5, c.half || 5.5, 'rocks');
    }
    // legacy fields (signs / minimap) refer to the first shortcut
    const c0 = this.cuts[0];
    if (c0) {
      this.dirtA = c0.A; this.dirtB = c0.B;
      this.dirtDistA = c0.distA; this.dirtDistB = c0.distB;
      this.hairpinSide = c0.side;
    }

    // ----- water splashes across the road (rally)
    this.splash = (course.splash || []).map(([x, z]) => ({ dist: this.project(x, z).dist, len: 12 }));

    // ----- dash panels
    this.dash = course.dash.map(p => {
      const q = this.project(p.x, p.z);
      return { dist: q.dist, d: p.d, len: 6, w: 4 };
    });

    // ----- pit boxes in world space
    this.boxes = PIT.BOXES.map((u, i) => {
      const p = this.pointAt(this.uToDist(u), PIT.LANE_D);
      return { index: i, u, x: p.x, z: p.z, heading: p.heading };
    });

    this._q = { i: 0, dist: 0, u: 0, d: 0 };
  }

  // ---------------- spatial hash for nearest-sample queries ----------------
  _buildHash() {
    const { minX, maxX, minZ, maxZ } = this.bbox;
    this.hx0 = minX - REACH - CELL;
    this.hz0 = minZ - REACH - CELL;
    this.hw = Math.ceil((maxX - this.hx0 + REACH + CELL) / CELL) + 1;
    this.hh = Math.ceil((maxZ - this.hz0 + REACH + CELL) / CELL) + 1;
    const cells = new Array(this.hw * this.hh);
    for (let i = 0; i < this.N; i++) {
      const x0 = Math.floor((this.cx[i] - REACH - this.hx0) / CELL);
      const x1 = Math.floor((this.cx[i] + REACH - this.hx0) / CELL);
      const z0 = Math.floor((this.cz[i] - REACH - this.hz0) / CELL);
      const z1 = Math.floor((this.cz[i] + REACH - this.hz0) / CELL);
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          const k = gz * this.hw + gx;
          (cells[k] || (cells[k] = [])).push(i);
        }
      }
    }
    this.cells = cells.map(a => (a ? Int32Array.from(a) : null));
  }

  /** nearest centreline sample -> writes into out {i, dist, u, d}; false if far from the track */
  _nearest(x, z, out) {
    const gx = Math.floor((x - this.hx0) / CELL), gz = Math.floor((z - this.hz0) / CELL);
    if (gx < 0 || gz < 0 || gx >= this.hw || gz >= this.hh) return false;
    const list = this.cells[gz * this.hw + gx];
    if (!list) return false;
    const cx = this.cx, cz = this.cz;
    let best = -1, bd = Infinity;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const dx = x - cx[i], dz = z - cz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) return false;
    const i = best;
    const dx = x - cx[i], dz = z - cz[i];
    const along = dx * this.tx[i] + dz * this.tz[i];
    const L = this.length;
    let dist = (i * this.spacing + along) % L;
    if (dist < 0) dist += L;
    out.i = i;
    out.dist = dist;
    out.u = dist > L / 2 ? dist - L : dist;
    out.d = dx * this.rx[i] + dz * this.rz[i];
    return true;
  }

  /** Track coordinates of a world point (new object) or null if off the map. */
  project(x, z) {
    const o = { i: 0, dist: 0, u: 0, d: 0 };
    return this._nearest(x, z, o) ? o : null;
  }

  uToDist(u) {
    return ((u % this.length) + this.length) % this.length;
  }

  wrapDiff(a, b) {
    const L = this.length;
    let d = (a - b) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** World position + heading at a distance along the track and a lateral offset */
  pointAt(dist, d = 0) {
    const L = this.length, N = this.N;
    dist = ((dist % L) + L) % L;
    const f = dist / this.spacing;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const x = this.cx[i] + (this.cx[j] - this.cx[i]) * t;
    const z = this.cz[i] + (this.cz[j] - this.cz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const rx = -tz, rz = tx;
    return { x: x + rx * d, z: z + rz * d, heading: Math.atan2(-tx, -tz), tx, tz, rx, rz };
  }

  /** lane centre (lateral offset) of the pit lane at track coordinate u, or null */
  pitCenter(u) {
    if (u < PIT.U0 || u > PIT.U1) return null;
    let t;
    if (u < PIT.U0 + PIT.RAMP) t = (u - PIT.U0) / PIT.RAMP;
    else if (u > PIT.U1 - PIT.RAMP) t = (PIT.U1 - u) / PIT.RAMP;
    else t = 1;
    t = t * t * (3 - 2 * t);
    return PIT.START_D + (PIT.LANE_D - PIT.START_D) * t;
  }

  _addCut(distA, dA, distB, dB, half, surface) {
    const A = this.pointAt(distA, dA), B = this.pointAt(distB, dB);
    this.cuts.push({
      A: { x: A.x, z: A.z }, B: { x: B.x, z: B.z }, distA: ((distA % this.length) + this.length) % this.length,
      distB: ((distB % this.length) + this.length) % this.length, half, surface, side: dA < 0 ? -1 : 1,
      len: Math.hypot(B.x - A.x, B.z - A.z),
    });
  }

  static _segDist(x, z, A, B) {
    const abx = B.x - A.x, abz = B.z - A.z;
    const t = Math.max(0, Math.min(1, ((x - A.x) * abx + (z - A.z) * abz) / (abx * abx + abz * abz)));
    return Math.hypot(x - (A.x + abx * t), z - (A.z + abz * t));
  }

  /** the shortcut whose corridor contains (x, z), or null */
  cutAt(x, z) {
    for (const c of this.cuts) if (Track._segDist(x, z, c.A, c.B) <= c.half) return c;
    return null;
  }

  /** inside a water splash? */
  inSplash(q) {
    if (!q || Math.abs(q.d) > ROAD_HALF + 2) return false;
    for (const s of this.splash) if (Math.abs(this.wrapDiff(q.dist, s.dist)) <= s.len / 2) return true;
    return false;
  }

  /**
   * Drivable "depth": >0 inside the drivable area (road+run-off, pit lane, dirt shortcut),
   * value = distance to the nearest boundary (approx). Walls sit where it crosses 0.
   */
  depth(x, z) {
    let m = -1e9;
    const q = this._q;
    if (this._nearest(x, z, q)) {
      m = this.barrier - Math.abs(q.d);
      const dp = this.pitCenter(q.u);
      if (dp !== null) {
        const mp = PIT.HALF - Math.abs(q.d - dp);
        if (mp > m) m = mp;
      }
    }
    for (const c of this.cuts) {
      const md = c.half - Track._segDist(x, z, c.A, c.B);
      if (md > m) m = md;
    }
    return m;
  }

  surfaceAt(x, z, q) {
    if (q && Math.abs(q.d) <= ROAD_HALF) return this.splash.length && this.inSplash(q) ? 'water' : 'road';
    const cut = this.cuts.length ? this.cutAt(x, z) : null;
    if (cut) return cut.surface;
    if (this.splash.length && this.inSplash(q)) return 'water';
    if (q) {
      const dp = this.pitCenter(q.u);
      if (dp !== null && Math.abs(q.d - dp) <= PIT.HALF) return 'pit';
      if (Math.abs(q.d) <= ROAD_HALF + CURB_W && this.curb[q.i]) return 'curb';
    }
    return this.kind === 'city' ? 'kerb' : 'grass';
  }

  /** pit speed limiter is active on the main pit section */
  inLimiter(q, surface) {
    return surface === 'pit' && q && q.u >= PIT.U0 + PIT.RAMP - 10 && q.u <= PIT.U1 - PIT.RAMP + 10;
  }

  pitBoxAt(q) {
    if (!q) return null;
    for (const b of this.boxes) {
      const err = Math.abs(q.u - b.u);
      if (err <= PIT.BOX_LEN / 2 && Math.abs(q.d - PIT.LANE_D) <= 3.6) return { index: b.index, err, signed: q.u - b.u };
    }
    return null;
  }

  /** nearest box ahead (for the stop gauge) */
  nextBox(q) {
    if (!q || q.u < PIT.U0 || q.u > PIT.U1) return null;
    let best = null;
    for (const b of this.boxes) {
      const rem = b.u - q.u;
      if (rem < -PIT.BOX_LEN / 2) continue;
      if (!best || rem < best.rem) best = { index: b.index, rem };
    }
    return best;
  }

  dashAt(q) {
    if (!q) return -1;
    for (let k = 0; k < this.dash.length; k++) {
      const p = this.dash[k];
      if (Math.abs(this.wrapDiff(q.dist, p.dist)) <= p.len / 2 && Math.abs(q.d - p.d) <= p.w / 2) return k;
    }
    return -1;
  }

  /** grid slot -> {dist, d} */
  slot(k) {
    const u = -10 - Math.floor(k / 2) * 7;
    return { dist: this.uToDist(u), d: k % 2 === 0 ? -3 : 3 };
  }

  /** max |curvature| over the next `ahead` metres */
  curvatureAhead(i, ahead) {
    let m = 0;
    const n = Math.ceil(ahead / this.spacing);
    for (let k = 0; k < n; k++) {
      const c = Math.abs(this.curv[(i + k) % this.N]);
      if (c > m) m = c;
    }
    return m;
  }

  // ---------------- wall polylines (boundary of the drivable field) ----------------
  wallLines() {
    const out = [];
    const keepTest = (x, z, nx, nz) =>
      this.depth(x - nx * 0.3, z - nz * 0.3) >= 0 && this.depth(x + nx * 0.3, z + nz * 0.3) < 0;

    const pushRuns = (samples, closed, kind) => {
      const n = samples.length;
      let start = 0;
      if (closed) {
        const f = samples.findIndex(s => !s.keep);
        if (f < 0) { out.push({ kind, pts: samples.concat([samples[0]]) }); return; }
        start = f;
      }
      let run = [];
      for (let k = 0; k <= n; k++) {
        const s = closed ? samples[(start + k) % n] : samples[k];
        if (s && s.keep) run.push(s);
        else {
          if (run.length >= 2) out.push({ kind, pts: run });
          run = [];
        }
        if (!closed && k === n - 1) {
          if (run.length >= 2) out.push({ kind, pts: run });
          run = [];
          break;
        }
      }
    };

    // main barriers
    for (const side of [-1, 1]) {
      const samples = [];
      for (let i = 0; i < this.N; i++) {
        const nx = this.rx[i] * side, nz = this.rz[i] * side;
        const x = this.cx[i] + nx * this.barrier, z = this.cz[i] + nz * this.barrier;
        samples.push({ x, z, nx, nz, keep: keepTest(x, z, nx, nz) });
      }
      pushRuns(samples, true, 'barrier');
    }
    // pit lane edges
    for (const edge of [-1, 1]) {
      const samples = [];
      for (let u = PIT.U0; u <= PIT.U1; u += 1) {
        const dp = this.pitCenter(u);
        const p = this.pointAt(this.uToDist(u), dp + edge * PIT.HALF);
        const nx = p.rx * edge, nz = p.rz * edge;
        samples.push({ x: p.x, z: p.z, nx, nz, keep: keepTest(p.x, p.z, nx, nz) });
      }
      pushRuns(samples, false, 'pit');
    }
    // shortcut edges
    for (const c of this.cuts) {
      const { A, B, len } = c;
      const px = -(B.z - A.z) / len, pz = (B.x - A.x) / len;
      for (const side of [-1, 1]) {
        const samples = [];
        for (let t = 0; t <= len; t += 1) {
          const x = A.x + (B.x - A.x) * (t / len) + px * side * c.half;
          const z = A.z + (B.z - A.z) * (t / len) + pz * side * c.half;
          const nx = px * side, nz = pz * side;
          samples.push({ x, z, nx, nz, keep: keepTest(x, z, nx, nz) });
        }
        pushRuns(samples, false, c.surface);
      }
    }
    return out;
  }
}
