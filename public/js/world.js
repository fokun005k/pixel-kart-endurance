// ============================================================
//  Scene construction: circuit meshes from primitives + pixel textures,
//  scenery, karts (remote models) and the first-person cockpit.
// ============================================================
import * as THREE from 'three';
import * as TX from './textures.js';
import { ROAD_HALF, CURB_W, PIT, KART_COLORS, TYRES } from './config.js';

const Y = { dirt: 0.03, pit: 0.035, road: 0.045, curb: 0.05, decal: 0.06 };

function basicMat(map, extra = {}) {
  return new THREE.MeshBasicMaterial({ map, ...extra });
}
function lambert(map, extra = {}) {
  return new THREE.MeshLambertMaterial({ map, ...extra });
}

/** ribbon along a list of {x, z, rx, rz, v} with lateral offsets d0..d1 */
function ribbonGeometry(samples, d0, d1, y) {
  const n = samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = [];
  for (let k = 0; k < n; k++) {
    const s = samples[k];
    const a = typeof d0 === 'function' ? d0(s) : d0;
    const b = typeof d1 === 'function' ? d1(s) : d1;
    pos.set([s.x + s.rx * a, y, s.z + s.rz * a, s.x + s.rx * b, y, s.z + s.rz * b], k * 6);
    uv.set([0, s.v, 1, s.v], k * 4);
    if (k < n - 1) {
      const i0 = k * 2, i1 = k * 2 + 1, i2 = k * 2 + 2, i3 = k * 2 + 3;
      idx.push(i0, i1, i2, i1, i3, i2); // counter-clockwise seen from above (normal +y)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** thick wall strip along a polyline of {x,z,nx,nz} (n = outward) */
function wallGeometry(pts, height, thick, texLen) {
  const pos = [], uv = [], idx = [];
  let len = 0;
  const quad = (a, b, c, d, ua, ub, va, vb) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(ua, va, ub, va, ua, vb, ub, vb);
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  for (let k = 0; k < pts.length - 1; k++) {
    const p = pts[k], q = pts[k + 1];
    const seg = Math.hypot(q.x - p.x, q.z - p.z);
    const u0 = len / texLen, u1 = (len + seg) / texLen;
    len += seg;
    const pi = [p.x, 0, p.z], qi = [q.x, 0, q.z];
    const pit = [p.x, height, p.z], qit = [q.x, height, q.z];
    const po = [p.x + p.nx * thick, 0, p.z + p.nz * thick], qo = [q.x + q.nx * thick, 0, q.z + q.nz * thick];
    const pot = [po[0], height, po[2]], qot = [qo[0], height, qo[2]];
    quad(pi, qi, pit, qit, u0, u1, 0, 1);            // inner face
    quad(qo, po, qot, pot, u1, u0, 0, 1);            // outer face
    quad(pit, qit, pot, qot, u0, u1, 0.98, 1);       // top
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** flat decal aligned with the track; canvas top = travel direction */
function decal(track, dist, d, across, along, tex, y = Y.decal, extra = {}) {
  const p = track.pointAt(dist, d);
  const geo = new THREE.PlaneGeometry(across, along);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, basicMat(tex, { transparent: true, alphaTest: 0.1, ...extra }));
  m.position.set(p.x, y, p.z);
  m.rotation.y = p.heading;
  return m;
}

// textures cloned per world (different repeat) are disposed with the world
function cloneTex(tex) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.userData.disposable = true;
  return t;
}

// ============================================================
/**
 * @param {Track} track
 * @param {{theme?: string, night?: boolean}} opts
 */
export function buildWorld(track, { theme = 'green', night = false } = {}) {
  const T = TX.THEMES[theme] || TX.THEMES.green;
  const scene = new THREE.Scene();
  const fogColor = night ? TX.NIGHT_HORIZON : TX.SKY_HORIZON;
  scene.background = new THREE.Color(fogColor);
  scene.fog = night ? new THREE.Fog(fogColor, 40, 330) : new THREE.Fog(fogColor, 90, 520);

  // Unlit (MeshBasic) surfaces are darkened with a tint at night; lamp pools and
  // headlights are added on top with additive blending.
  const tint = night ? 0x4c5880 : 0xffffff;
  const surf = (map, extra = {}) => basicMat(map, { color: tint, ...extra });

  const hemi = night
    ? new THREE.HemisphereLight(0x8090c8, 0x202034, 0.9)
    : new THREE.HemisphereLight(0xe8f4ff, 0x5a7a48, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0x9fb0ff : 0xfff4e0, night ? 0.7 : 2.0);
  sun.position.set(night ? -120 : 120, 220, 80);
  scene.add(sun);

  // ---- sky & horizon
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16),
    basicMat(night ? TX.skyNightTex() : TX.skyTex(), { side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
  const mtnTex = cloneTex(TX.mountainTex(theme));
  mtnTex.repeat.set(4, 1);
  const mtn = new THREE.Mesh(new THREE.CylinderGeometry(1000, 1000, 170, 64, 1, true),
    basicMat(mtnTex, { color: night ? 0x262c44 : 0xffffff, side: THREE.BackSide, fog: false, transparent: true, alphaTest: 0.5, depthWrite: false }));
  mtn.position.y = 55;
  mtn.renderOrder = -9;
  scene.add(mtn);

  // ---- ground
  const gt = cloneTex(TX.grassTex(theme));
  gt.repeat.set(300, 300);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), surf(gt));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -170);
  scene.add(ground);

  // ---- centreline samples
  const N = track.N;
  const samples = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    samples.push({ x: track.cx[k], z: track.cz[k], rx: track.rx[k], rz: track.rz[k], v: (i * track.spacing) / 10, i: k });
  }
  // road
  const road = new THREE.Mesh(ribbonGeometry(samples, -ROAD_HALF, ROAD_HALF, Y.road),
    surf(TX.roadTex(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  scene.add(road);

  // curbs on corners
  const curbMat = surf(TX.curbTex(), { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  let run = [];
  const flushCurb = () => {
    if (run.length > 2) {
      const ss = run.map(s => ({ ...s, v: (s.i * track.spacing) / 4 }));
      scene.add(new THREE.Mesh(ribbonGeometry(ss, ROAD_HALF, ROAD_HALF + CURB_W, Y.curb), curbMat));
      scene.add(new THREE.Mesh(ribbonGeometry(ss, -ROAD_HALF - CURB_W, -ROAD_HALF, Y.curb), curbMat));
    }
    run = [];
  };
  for (let i = 0; i <= N; i++) {
    if (track.curb[i % N]) run.push(samples[i]); else flushCurb();
  }
  flushCurb();

  // pit lane surface
  const pitSamples = [];
  for (let u = PIT.U0; u <= PIT.U1; u += 1) {
    const p = track.pointAt(track.uToDist(u), 0);
    pitSamples.push({ x: p.x, z: p.z, rx: p.rx, rz: p.rz, v: u / 8, u });
  }
  const pitMesh = new THREE.Mesh(
    ribbonGeometry(pitSamples, s => track.pitCenter(s.u) - PIT.HALF, s => track.pitCenter(s.u) + PIT.HALF, Y.pit),
    surf(TX.pitLaneTex(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  scene.add(pitMesh);

  // dirt shortcut
  {
    const A = track.dirtA, B = track.dirtB;
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dt = cloneTex(TX.dirtTex());
    dt.repeat.set(1, len / 9);
    const geo = new THREE.PlaneGeometry(9, len + 4);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, surf(dt));
    m.position.set((A.x + B.x) / 2, Y.dirt, (A.z + B.z) / 2);
    m.rotation.y = Math.atan2(-(B.x - A.x), -(B.z - A.z));
    scene.add(m);
    // scattered gravel puffs at the borders
    const r = TX.mulberry32(5);
    const pebMat = lambert(null, { color: 0x8a7058 });
    for (let k = 0; k < 40; k++) {
      const t = r();
      const side = r() < 0.5 ? -1 : 1;
      const px = -(B.z - A.z) / len, pz = (B.x - A.x) / len;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), pebMat);
      s.position.set(A.x + (B.x - A.x) * t + px * side * (3.6 + r() * 0.6), 0.08, A.z + (B.z - A.z) * t + pz * side * (3.6 + r() * 0.6));
      scene.add(s);
    }
  }

  // decals: start line, grid, pit boxes, dash panels, pit text
  const dc = { color: tint };
  const ct = TX.checkerTex();
  scene.add(decal(track, 0, 0, ROAD_HALF * 2, 1.6, ct, Y.decal, dc));
  for (let k = 0; k < 8; k++) {
    const sl = track.slot(k);
    scene.add(decal(track, sl.dist - 1.2, sl.d, 2.2, 2.2, TX.gridMarkTex(), Y.decal, dc));
  }
  track.boxes.forEach((b, i) => {
    scene.add(decal(track, track.uToDist(b.u), PIT.LANE_D, PIT.HALF * 2 - 0.4, PIT.BOX_LEN, TX.pitBoxTex(i + 1, KART_COLORS[i % KART_COLORS.length]), Y.decal, dc));
  });
  scene.add(decal(track, track.uToDist(-118), -12.5, 5, 2.2, TX.paintTextTex('PIT', '#f0c020'), Y.decal, dc));
  // dash panels stay bright at night (they "glow")
  const dashTex = TX.dashTex();
  for (const p of track.dash) scene.add(decal(track, p.dist, p.d, p.w, p.len, dashTex, Y.decal + 0.004, { color: night ? 0xd8d0c0 : 0xffffff }));

  // ---- walls
  const tyreMat = lambert(TX.tyreWallTex(), { side: THREE.DoubleSide });
  const concMat = lambert(TX.concreteTex(), { side: THREE.DoubleSide });
  for (const w of track.wallLines()) {
    const isBarrier = w.kind !== 'pit';
    const geo = wallGeometry(w.pts, isBarrier ? 1.2 : 1.1, 0.5, isBarrier ? 4 : 6);
    scene.add(new THREE.Mesh(geo, isBarrier ? tyreMat : concMat));
  }

  // ---- start gantry with countdown lights
  const gantry = buildGantry(track);
  scene.add(gantry.group);

  // ---- grandstands (outside of the home straight), garages (pit side)
  buildGrandstands(scene);
  buildGarages(scene);
  buildSigns(scene, track);
  buildTrees(scene, track, T, night);
  if (night) buildLamps(scene, track);

  return {
    scene, dashTex, gantryLights: gantry.lights, night, theme,
    fogNear: scene.fog.near, fogFar: scene.fog.far,
    dispose() {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (m.map && m.map.userData.disposable) m.map.dispose();
          m.dispose();
        }
      });
    },
  };
}

/** street lamps + light pools on the road (night only) */
function buildLamps(scene, track) {
  const poolTex = TX.lightPoolTex();
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex, color: 0xffd890, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const poleMat = lambert(null, { color: 0x3a3e48 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  const poolGeo = new THREE.PlaneGeometry(24, 24);
  poolGeo.rotateX(-Math.PI / 2);
  const poleGeo = new THREE.BoxGeometry(0.35, 7, 0.35);
  const armGeo = new THREE.BoxGeometry(0.25, 0.25, 3);
  const headGeo = new THREE.BoxGeometry(0.9, 0.3, 0.9);
  const step = 55;
  let side = 1;
  for (let dist = 10; dist < track.length - 5; dist += step) {
    const lamp = track.pointAt(dist, side * 14);
    if (track.depth(lamp.x, lamp.z) > -0.5) { side = -side; continue; } // keep poles off the tarmac/pit lane
    const g = new THREE.Group();
    g.position.set(lamp.x, 0, lamp.z);
    g.rotation.y = lamp.heading;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 3.5;
    g.add(pole);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.rotation.y = Math.PI / 2;
    arm.position.set(-side * 1.5, 6.9, 0);
    g.add(arm);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(-side * 3, 6.75, 0);
    g.add(head);
    scene.add(g);
    const pool = track.pointAt(dist, side * 3);
    const m = new THREE.Mesh(poolGeo, poolMat);
    m.position.set(pool.x, Y.decal + 0.01, pool.z);
    m.renderOrder = 2;
    scene.add(m);
    side = -side;
  }
  // pit lane & grid floodlights
  for (let u = -120; u <= 130; u += 30) {
    const p = track.pointAt(track.uToDist(u), -16.5);
    const m = new THREE.Mesh(poolGeo, poolMat);
    m.position.set(p.x, Y.decal + 0.01, p.z);
    m.renderOrder = 2;
    scene.add(m);
  }
}

/** additive headlight beam lying on the road (night) */
export function createHeadBeam(length = 18, width = 11) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -length / 2 - 1.5); // starts just in front of the kart, points to -z (forward)
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: TX.headBeamTex(), color: 0xfff0c0, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.renderOrder = 3;
  return m;
}

function buildGantry(track) {
  const group = new THREE.Group();
  const p = track.pointAt(0, 0);
  group.position.set(p.x, 0, p.z);
  group.rotation.y = p.heading;
  const steel = lambert(null, { color: 0x50555f });
  for (const s of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 7.5, 0.8), steel);
    pil.position.set(s * 10.2, 3.75, 0);
    group.add(pil);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(21.2, 1.6, 1.0), steel);
  beam.position.set(0, 6.8, 0);
  group.add(beam);
  const banner = TX.paintTextTex('START FINISH', '#ffffff', '#c02828', 3);
  for (const face of [1, -1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.1), basicMat(banner));
    b.position.set(face * 4.5, 6.8, face * 0.52);
    if (face < 0) b.rotation.y = Math.PI;
    group.add(b);
  }
  // lights face the approaching karts (they come from local +z, since local -z = travel direction)
  const lights = [];
  for (let k = 0; k < 5; k++) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.3), lambert(null, { color: 0x15151a }));
    housing.position.set(-7.5 + k * 1.3, 6.8, 0.62);
    group.add(housing);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.05), new THREE.MeshBasicMaterial({ color: 0x3a0808 }));
    lamp.position.set(-7.5 + k * 1.3, 6.8, 0.79);
    group.add(lamp);
    lights.push(lamp);
  }
  return { group, lights };
}

function buildGrandstands(scene) {
  const crowd = TX.crowdTex();
  const conc = lambert(TX.concreteTex());
  const roofMat = lambert(null, { color: 0x2a5cc8 });
  for (const cx of [-50, 0, 50]) {
    for (let k = 0; k < 5; k++) {
      const h = 1.3 * (k + 1);
      const ct = cloneTex(crowd);
      ct.repeat.set(6, 1);
      const front = lambert(ct);
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z  -> -z faces the track
      const mats = [conc, conc, conc, conc, conc, front];
      const box = new THREE.Mesh(new THREE.BoxGeometry(44, h, 2.6), mats);
      box.position.set(cx, h / 2, 16 + k * 2.6 + 1.3);
      scene.add(box);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(46, 0.4, 15), roofMat);
    roof.position.set(cx, 10, 22.5);
    scene.add(roof);
    for (const px of [-21, 21]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 10, 0.5), conc);
      pil.position.set(cx + px, 5, 29.5);
      scene.add(pil);
    }
  }
}

function buildGarages(scene) {
  const conc = lambert(TX.concreteTex());
  const gt = cloneTex(TX.garageTex());
  gt.repeat.set(8, 1);
  const front = lambert(gt);
  // +z face (index 4) faces the pit lane
  const mats = [conc, conc, lambert(null, { color: 0x9a9aa6 }), conc, front, conc];
  const b = new THREE.Mesh(new THREE.BoxGeometry(160, 6, 8), mats);
  b.position.set(0, 3, -26);
  scene.add(b);
  // control tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 16, 10), [conc, conc, conc, conc, lambert(TX.garageTex()), conc]);
  tower.position.set(-100, 8, -34);
  scene.add(tower);
}

function buildSigns(scene, track) {
  const post = lambert(null, { color: 0x6a6a72 });
  const board = (dist, d, tex, w, h, faceBack = false) => {
    const p = track.pointAt(dist, d);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // plane normal (+z local) points back along the track, toward approaching karts
    g.rotation.y = p.heading + (faceBack ? Math.PI : 0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert(tex, { side: THREE.DoubleSide }));
    m.position.y = 1.4 + h / 2;
    g.add(m);
    for (const s of [-1, 1]) {
      const pp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4 + h / 2, 0.15), post);
      pp.position.set(s * (w / 2 - 0.3), (1.4 + h / 2) / 2, 0.05);
      g.add(pp);
    }
    scene.add(g);
  };
  // the dirt-shortcut hairpin: chevrons on the outside of the apex, boards before it
  const inner = track.hairpinSide;                          // -1: left hairpin, +1: right hairpin
  const span = ((track.dirtDistB - track.dirtDistA) % track.length + track.length) % track.length;
  const apex = track.dirtDistA + span / 2;
  const chevron = inner < 0 ? TX.chevronTex() : TX.chevronTex(true);
  for (let k = -3; k <= 3; k++) board(apex + k * 9, -inner * 13.5, chevron, 2.2, 2.2, false);
  board(track.dirtDistA - 40, -inner * 13, TX.paintTextTex('100', '#111111', '#f4f4f4', 3), 2.4, 1.2);
  board(track.dirtDistA - 14, inner * 13, TX.paintTextTex('DIRT', '#ffe84a', '#7a4a20', 3), 3, 1.2);
  // pit entry sign
  board(track.uToDist(-150), -13, TX.paintTextTex('PIT IN', '#ffffff', '#2a5cc8', 3), 4, 1.4, false);
  // corner boards before T1 (every course turns left there)
  const t1 = track.project(190, 0);
  board(t1.dist - 50, 13, TX.paintTextTex('100', '#111111', '#f4f4f4', 3), 2.4, 1.2);
  board(t1.dist - 25, 13, TX.paintTextTex('50', '#111111', '#f4f4f4', 3), 2.4, 1.2);
}

function buildTrees(scene, track, T, night) {
  const r = TX.mulberry32(1234);
  const tint = night ? 0x3c4664 : 0xffffff;
  const sprite = map => new THREE.SpriteMaterial({ map, alphaTest: 0.5, color: tint });
  const pineMat = sprite(TX.pineTex(!!T.snowy));
  const roundMats = [sprite(TX.roundTreeTex(T.leaves, 0)), sprite(TX.roundTreeTex([T.leaves[2], T.leaves[0], T.leaves[2]], 1))];
  const cactusMat = T.cactus ? sprite(TX.cactusTex()) : null;
  const { minX, maxX, minZ, maxZ } = track.bbox;
  const max = T.cactus ? 260 : T.pine > 0.8 ? 700 : 520;
  let placed = 0;
  for (let n = 0; n < 6000 && placed < max; n++) {
    const x = minX - 160 + r() * (maxX - minX + 320);
    const z = minZ - 160 + r() * (maxZ - minZ + 320);
    if (track.depth(x, z) > -6) continue;
    if (Math.abs(x) < 115 && z > -42 && z < 40) continue; // grandstand / garage area
    let mat, h, w;
    if (cactusMat && r() < 0.65) {
      mat = cactusMat; h = 3 + r() * 3; w = h * 0.6;
    } else if (r() < T.pine) {
      mat = pineMat; h = 7 + r() * 5; w = h * 0.66;
    } else {
      mat = roundMats[r() < 0.7 ? 0 : 1]; h = (T.cactus ? 3 : 6) + r() * 3; w = h * 0.8;
    }
    const s = new THREE.Sprite(mat);
    s.scale.set(w, h, 1);
    s.position.set(x, h / 2 - 0.1, z);
    scene.add(s);
    placed++;
  }
}

// ============================================================
//  Karts
// ============================================================
export function createKartModel(colorHex, num, night = false) {
  const g = new THREE.Group();
  const body = lambert(TX.kartBodyTex(colorHex, num));
  const dark = lambert(null, { color: 0x24242a });
  const suit = lambert(null, { color: new THREE.Color(colorHex).multiplyScalar(0.7) });
  const wheelMat = lambert(TX.wheelTex());
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.3, 0.24, 2.3), body, 0, 0.3, 0);
  add(new THREE.BoxGeometry(1.0, 0.22, 0.6), body, 0, 0.3, -1.35);
  add(new THREE.BoxGeometry(1.45, 0.12, 0.16), dark, 0, 0.22, -1.66);
  add(new THREE.BoxGeometry(0.3, 0.3, 1.0), body, 0.72, 0.36, 0.05);
  add(new THREE.BoxGeometry(0.3, 0.3, 1.0), body, -0.72, 0.36, 0.05);
  add(new THREE.BoxGeometry(0.6, 0.45, 0.5), dark, 0, 0.55, 0.78);
  add(new THREE.BoxGeometry(0.55, 0.55, 0.42), suit, 0, 0.75, 0.25);
  add(new THREE.BoxGeometry(0.46, 0.44, 0.48), body, 0, 1.2, 0.2);
  add(new THREE.BoxGeometry(0.4, 0.13, 0.05), lambert(null, { color: 0x101018 }), 0, 1.22, -0.05);
  add(new THREE.BoxGeometry(1.5, 0.06, 0.36), body, 0, 0.98, 1.2);
  add(new THREE.BoxGeometry(0.06, 0.42, 0.06), dark, 0.5, 0.76, 1.2);
  add(new THREE.BoxGeometry(0.06, 0.42, 0.06), dark, -0.5, 0.76, 1.2);

  const wheels = [];
  const hubs = [];
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xffd23b });
  for (const [x, z, r, w] of [[0.8, -0.85, 0.3, 0.3], [-0.8, -0.85, 0.3, 0.3], [0.82, 0.85, 0.33, 0.38], [-0.82, 0.85, 0.33, 0.38]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const wheelGeo = new THREE.CylinderGeometry(r, r, w, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wm = new THREE.Mesh(wheelGeo, wheelMat);
    pivot.add(wm);
    const hubGeo = new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    pivot.add(hub);
    g.add(pivot);
    wheels.push({ pivot, mesh: wm, front: z < 0 });
    hubs.push(hub);
  }

  // nitro flame (points backwards = +z)
  const flameGeo = new THREE.ConeGeometry(0.22, 1.1, 6);
  flameGeo.rotateX(Math.PI / 2);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffa020 }));
  flame.position.set(0, 0.5, 1.9);
  flame.visible = false;
  g.add(flame);

  // blob shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.07;
  shadow.scale.set(1, 1.5, 1);
  g.add(shadow);

  // head & tail lights (always on; at night they also cast a beam on the road)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.22, 0.12, 0.06), headMat, s * 0.38, 0.36, -1.66);
    add(new THREE.BoxGeometry(0.2, 0.12, 0.06), tailMat, s * 0.5, 0.98, 1.39);
  }
  let beam = null;
  if (night) {
    beam = createHeadBeam(14, 8);
    beam.position.y = 0.08;
    g.add(beam);
  }

  return {
    group: g, wheels, flame, shadow, hubMat, beam,
    setTyre(type) {
      const T = TYRES[type];
      if (T) hubMat.color.setHex(T.hex);
    },
  };
}

export function createNameTag(name, colorHex) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.nameTagTex(name, colorHex), depthTest: true, transparent: true }));
  s.scale.set(4, 0.75, 1);
  s.position.y = 2.3;
  return s;
}

// ============================================================
//  First-person cockpit (rendered in its own pass on top of the world)
// ============================================================
export function createCockpit(colorHex, night = false) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(night ? 0x8898d0 : 0xe8f4ff, 0x404040, night ? 0.8 : 1.6));
  const sun = new THREE.DirectionalLight(night ? 0xb0c0ff : 0xffffff, night ? 0.6 : 1.6);
  sun.position.set(0.5, 2, 1);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(72, 16 / 9, 0.01, 30);

  const root = new THREE.Group();
  scene.add(root);
  const body = lambert(TX.kartBodyTex(colorHex, ''));
  const dark = lambert(null, { color: 0x202026 });

  // nose & cowl (ground is at y = -1.0 relative to the eye)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.24, 1.5), body);
  nose.position.set(0, -0.8, -1.75);
  root.add(nose);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.22), dark);
  tip.position.set(0, -0.86, -2.55);
  root.add(tip);
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.16, 0.7), body);
  cowl.position.set(0, -0.66, -0.95);
  cowl.rotation.x = 0.15;
  root.add(cowl);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.45), dark);
  column.position.set(0, -0.58, -0.62);
  column.rotation.x = -0.45;
  root.add(column);

  // front wheels
  const wheelMat = lambert(TX.wheelTex());
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xffd23b });
  const frontWheels = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.86, -0.72, -1.3);
    const wg = new THREE.CylinderGeometry(0.28, 0.28, 0.3, 12);
    wg.rotateZ(Math.PI / 2);
    const wm = new THREE.Mesh(wg, wheelMat);
    pivot.add(wm);
    const hg = new THREE.CylinderGeometry(0.13, 0.13, 0.32, 8);
    hg.rotateZ(Math.PI / 2);
    pivot.add(new THREE.Mesh(hg, hubMat));
    root.add(pivot);
    frontWheels.push({ pivot, mesh: wm });
  }

  // steering wheel (pixel-art sprite on a plane) tilted toward the driver
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, -0.42, -0.74);
  wheelPivot.rotation.x = -0.5;
  const wheelInner = new THREE.Group();
  const wheelPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: TX.steeringTex(colorHex), transparent: true, alphaTest: 0.5 }));
  wheelInner.add(wheelPlane);
  wheelPivot.add(wheelInner);
  root.add(wheelPivot);

  return {
    scene, cam, root, wheelInner, frontWheels, hubMat,
    setTyre(type) {
      const T = TYRES[type];
      if (T) hubMat.color.setHex(T.hex);
    },
  };
}
