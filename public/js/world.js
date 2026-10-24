// ============================================================
//  Scene construction: circuit / rally stage / city street meshes from
//  primitives + pixel textures, scenery, karts & rally cars, cockpits.
// ============================================================
import * as THREE from 'three';
import * as TX from './textures.js';
import { ROAD_HALF, CURB_W, PIT, KART_COLORS, TYRES, CAR_BY_ID } from './config.js';

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
  const kind = track.kind;                       // circuit | rally | city
  const roadType = track.course.road || 'asphalt';
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
  // (transparent so that rain / fog can fade them into the fog colour)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16),
    basicMat(night ? TX.skyNightTex() : TX.skyTex(), { side: THREE.BackSide, fog: false, depthWrite: false, transparent: true }));
  sky.renderOrder = -10;
  scene.add(sky);
  const mtnTex = cloneTex(TX.mountainTex(theme));
  mtnTex.repeat.set(4, 1);
  const mtn = new THREE.Mesh(new THREE.CylinderGeometry(1000, 1000, 170, 64, 1, true),
    basicMat(mtnTex, { color: night ? 0x262c44 : 0xffffff, side: THREE.BackSide, fog: false, transparent: true, alphaTest: 0.02, depthWrite: false }));
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
    surf(TX.roadSurfaceTex(kind, roadType), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  scene.add(road);

  // city: pavement between the road and the walls (not where the pit lane branches off)
  if (kind === 'city') {
    const swMat = surf(TX.sidewalkTex(), { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const side of [-1, 1]) {
      let runS = [];
      const flush = () => {
        if (runS.length > 2) scene.add(new THREE.Mesh(ribbonGeometry(runS, side > 0 ? ROAD_HALF : -track.barrier, side > 0 ? track.barrier : -ROAD_HALF, Y.pit), swMat));
        runS = [];
      };
      for (let i = 0; i <= N; i++) {
        const sm = samples[i];
        const u = track.wrapDiff(sm.i * track.spacing, 0);
        if (side < 0 && u > PIT.U0 - 4 && u < PIT.U1 + 4) { flush(); continue; }
        runS.push({ ...sm, v: (sm.i * track.spacing) / 8 });
      }
      flush();
    }
  }

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

  // shortcuts: dirt track (circuits) / rocky corner cuts (rally)
  const r5 = TX.mulberry32(5);
  for (const ct of track.cuts) {
    const { A, B, len } = ct;
    const rocky = ct.surface === 'rocks';
    const tex = cloneTex(rocky ? TX.rocksTex() : TX.dirtTex());
    tex.repeat.set(1, len / (ct.half * 2));
    const geo = new THREE.PlaneGeometry(ct.half * 2, len + 4);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, surf(tex));
    m.position.set((A.x + B.x) / 2, Y.dirt, (A.z + B.z) / 2);
    m.rotation.y = Math.atan2(-(B.x - A.x), -(B.z - A.z));
    scene.add(m);
    const px = -(B.z - A.z) / len, pz = (B.x - A.x) / len;
    if (!rocky) {
      // scattered gravel puffs at the borders
      const pebMat = lambert(null, { color: 0x8a7058 });
      for (let k = 0; k < 40; k++) {
        const t = r5();
        const side = r5() < 0.5 ? -1 : 1;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), pebMat);
        p.position.set(A.x + (B.x - A.x) * t + px * side * (3.6 + r5() * 0.6), 0.08, A.z + (B.z - A.z) * t + pz * side * (3.6 + r5() * 0.6));
        scene.add(p);
      }
      continue;
    }
    // boulders lying in the cut: drive over them slowly, or jump them
    const rockMats = [lambert(null, { color: 0x8a8680 }), lambert(null, { color: 0x6e6a64 })];
    for (let k = 0; k < 22; k++) {
      const t = 0.12 + r5() * 0.76, off = (r5() - 0.5) * ct.half * 1.6;
      const sz = 0.5 + r5() * 0.9;
      const b = new THREE.Mesh(new THREE.BoxGeometry(sz * 1.3, sz * 0.7, sz), rockMats[k % 2]);
      b.position.set(A.x + (B.x - A.x) * t + px * off, sz * 0.3, A.z + (B.z - A.z) * t + pz * off);
      b.rotation.y = r5() * Math.PI;
      scene.add(b);
    }
  }
  // rally water splashes across the road
  if (track.splash.length) {
    const wt = TX.waterTex();
    for (const w of track.splash) {
      scene.add(decal(track, w.dist, 0, ROAD_HALF * 2 + 4, w.len, wt, Y.decal - 0.002,
        { color: tint, transparent: true, opacity: 0.85, alphaTest: 0 }));
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

  // ---- walls: tyre walls (circuit), wooden fences / rock walls (rally), concrete with adverts (city)
  const tyreMat = lambert(TX.tyreWallTex(), { side: THREE.DoubleSide });
  const concMat = lambert(TX.concreteTex(), { side: THREE.DoubleSide });
  const fenceMat = lambert(TX.fenceTex(), { side: THREE.DoubleSide });
  const rockWallMat = lambert(TX.rocksTex(), { side: THREE.DoubleSide });
  const cityMat = lambert(TX.cityWallTex(), { side: THREE.DoubleSide });
  for (const w of track.wallLines()) {
    let mat = tyreMat, h = 1.2, tl = 4;
    if (w.kind === 'pit') { mat = concMat; h = 1.1; tl = 6; }
    else if (w.kind === 'rocks') { mat = rockWallMat; h = 0.8; tl = 4; }
    else if (w.kind === 'barrier' && kind === 'rally') { mat = fenceMat; h = 1.0; tl = 4; }
    else if (w.kind === 'barrier' && kind === 'city') { mat = cityMat; h = 1.8; tl = 8; }
    scene.add(new THREE.Mesh(wallGeometry(w.pts, h, 0.5, tl), mat));
  }

  // ---- start gantry with countdown lights
  const gantry = buildGantry(track);
  scene.add(gantry.group);

  // ---- grandstands (outside of the home straight), garages (pit side)
  if (kind === 'rally') buildServicePark(scene); else buildGrandstands(scene);
  buildGarages(scene);
  buildSigns(scene, track);
  if (kind === 'city') buildBuildings(scene, track, T, night); else buildTrees(scene, track, T, night);
  if (night) buildLamps(scene, track);

  // ---- weather: unlit surfaces get darker, the lights dim, the sky fades into grey
  const dimmable = new Map();   // material -> base colour
  scene.traverse((o) => {
    if (o === sky || o === mtn || gantry.lights.includes(o)) return;   // start lights are driven by the race
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (!m.color || m.blending === THREE.AdditiveBlending || dimmable.has(m)) continue;
      if (m.isMeshBasicMaterial || m.isSpriteMaterial) dimmable.set(m, m.color.clone());
    }
  });
  const baseFog = new THREE.Color(fogColor);
  const rainFog = new THREE.Color(night ? 0x10141e : 0x7d8794);
  const fogFog = new THREE.Color(night ? 0x283040 : 0xc4c9cf);
  const hemiI = hemi.intensity, sunI = sun.intensity;
  let lastWx = '';

  return {
    scene, dashTex, gantryLights: gantry.lights, night, theme,
    fogNear: scene.fog.near, fogFar: scene.fog.far,
    /** rain, fog: 0..1 (fog distances are set by the caller) */
    setWeather(rain, fog) {
      const key = `${rain.toFixed(2)}|${fog.toFixed(2)}`;
      if (key === lastWx) return;
      lastWx = key;
      const dim = 1 - (night ? 0.25 : 0.4) * rain - (night ? 0.1 : 0.12) * fog;
      for (const [m, base] of dimmable) m.color.copy(base).multiplyScalar(dim);
      hemi.intensity = hemiI * dim;
      sun.intensity = sunI * (1 - 0.75 * Math.min(1, rain + fog));
      const c = baseFog.clone().lerp(rainFog, rain).lerp(fogFog, fog);
      scene.fog.color.copy(c);
      scene.background.copy(c);
      sky.material.color.setScalar(1 - 0.45 * rain);
      sky.material.opacity = Math.max(0, 1 - 0.45 * rain - 0.95 * fog);
      mtn.material.opacity = Math.max(0, 1 - 0.3 * rain - fog);
      sky.visible = sky.material.opacity > 0.01;
      mtn.visible = mtn.material.opacity > 0.01;
    },
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

/** rally: service tents and spectators instead of grandstands */
function buildServicePark(scene) {
  const cols = [0xd83a2a, 0x2a5cc8, 0xf0c020, 0x2a9a50, 0xf4f4f4];
  const pole = lambert(null, { color: 0x50505a });
  let k = 0;
  for (const cx of [-70, -38, -6, 26, 58]) {
    const col = cols[k++ % cols.length];
    const g = new THREE.Group();
    g.position.set(cx, 0, 24);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9, 3, 4, 1), lambert(null, { color: col }));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 5.5;
    g.add(roof);
    for (const [px, pz] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), pole);
      p.position.set(px, 2, pz);
      g.add(p);
    }
    scene.add(g);
  }
  // spectators along the start straight (crowd texture on low banks)
  const ct = cloneTex(TX.crowdTex());
  ct.repeat.set(14, 1);
  const bank = new THREE.Mesh(new THREE.BoxGeometry(160, 1.6, 2.5), [lambert(null, { color: 0x5a6a48 }), lambert(null, { color: 0x5a6a48 }),
    lambert(null, { color: 0x5a6a48 }), lambert(null, { color: 0x5a6a48 }), lambert(null, { color: 0x5a6a48 }), lambert(ct)]);
  bank.position.set(-5, 0.8, 15);
  scene.add(bank);
}

/** city: blocks of buildings along both sides of the streets */
function buildBuildings(scene, track, T, night) {
  const r = TX.mulberry32(4321);
  const roofMat = lambert(null, { color: night ? 0x2a2e3a : 0x6a6a72 });
  const mats = new Map();
  const facade = (wall, v) => {
    const key = wall + v;
    if (!mats.has(key)) {
      const tex = TX.buildingTex(wall, v, night);
      mats.set(key, night ? new THREE.MeshBasicMaterial({ map: tex }) : lambert(tex));
    }
    return mats.get(key);
  };
  const placed = [];
  const free = (x, z, rad) => placed.every(p => Math.hypot(p.x - x, p.z - z) > p.rad + rad);
  for (let dist = 0; dist < track.length; dist += 9) {
    for (const side of [-1, 1]) {
      const w = 10 + r() * 8, dpt = 8 + r() * 8;
      const off = track.barrier + 2 + dpt / 2;
      const p = track.pointAt(dist, side * off);
      const rad = Math.hypot(w, dpt) / 2;
      if (Math.abs(p.x) < 130 && p.z > -50 && p.z < 45) continue;      // pit building & grandstands
      // the whole footprint must stay clear of every street
      let ok = true;
      for (const [a, b] of [[0, 0], [w / 2, dpt / 2], [-w / 2, dpt / 2], [w / 2, -dpt / 2], [-w / 2, -dpt / 2]]) {
        const x = p.x + p.tx * a + p.rx * b, z = p.z + p.tz * a + p.rz * b;
        if (track.depth(x, z) > -1.5) { ok = false; break; }
      }
      if (!ok || !free(p.x, p.z, rad)) continue;
      placed.push({ x: p.x, z: p.z, rad });
      const h = 7 + Math.floor(r() * (T === TX.THEMES.harbor ? 3 : 7)) * 4;
      const wall = T.walls[Math.floor(r() * T.walls.length)];
      const fm = facade(wall, Math.floor(r() * 3));
      const box = new THREE.Mesh(new THREE.BoxGeometry(dpt, h, w), [fm, fm, roofMat, roofMat, fm, fm]);
      for (const m of [fm]) {
        // repeat the window grid with the facade size (cloned textures are disposed with the world)
        if (!m.userData.sized) { m.userData.sized = true; m.map = cloneTex(m.map); m.map.repeat.set(2, 2); }
      }
      box.position.set(p.x, h / 2, p.z);
      box.rotation.y = p.heading;   // local z (w) along the street, local x (dpt) away from it
      scene.add(box);
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
  for (const ct of track.cuts) {
    const inner = ct.side;                                  // -1: left corner, +1: right corner
    const span = ((ct.distB - ct.distA) % track.length + track.length) % track.length;
    const apex = ct.distA + span / 2;
    const out = track.barrier + 2;
    if (ct.surface === 'dirt') {
      // the dirt-shortcut hairpin: chevrons on the outside of the apex, boards before it
      const chevron = inner < 0 ? TX.chevronTex() : TX.chevronTex(true);
      for (let k = -3; k <= 3; k++) board(apex + k * 9, -inner * 13.5, chevron, 2.2, 2.2, false);
      board(ct.distA - 40, -inner * 13, TX.paintTextTex('100', '#111111', '#f4f4f4', 3), 2.4, 1.2);
      board(ct.distA - 14, inner * 13, TX.paintTextTex('DIRT', '#ffe84a', '#7a4a20', 3), 3, 1.2);
    } else {
      // rally corner cut: a "JUMP!" board on the inside, chevrons on the outside
      const chevron = inner < 0 ? TX.chevronTex() : TX.chevronTex(true);
      for (let k = -1; k <= 1; k++) board(apex + k * 10, -inner * out, chevron, 2.2, 2.2, false);
      board(ct.distA - 22, inner * out, TX.paintTextTex('JUMP!', '#ffffff', '#c03a20', 3), 3, 1.2);
    }
  }
  // pit entry sign
  const edge = track.barrier + 1.5;
  board(track.uToDist(-150), -edge, TX.paintTextTex('PIT IN', '#ffffff', '#2a5cc8', 3), 4, 1.4, false);
  // corner boards before T1 (every course turns left there)
  const t1 = track.project(190, 0);
  board(t1.dist - 50, edge, TX.paintTextTex('100', '#111111', '#f4f4f4', 3), 2.4, 1.2);
  board(t1.dist - 25, edge, TX.paintTextTex('50', '#111111', '#f4f4f4', 3), 2.4, 1.2);
}

function buildTrees(scene, track, T, night) {
  const r = TX.mulberry32(1234);
  const tint = night ? 0x3c4664 : 0xffffff;
  const sprite = map => new THREE.SpriteMaterial({ map, alphaTest: 0.5, color: tint });
  const pineMat = sprite(TX.pineTex(!!T.snowy));
  const roundMats = [sprite(TX.roundTreeTex(T.leaves, 0)), sprite(TX.roundTreeTex([T.leaves[2], T.leaves[0], T.leaves[2]], 1))];
  const cactusMat = T.cactus ? sprite(TX.cactusTex()) : null;
  const { minX, maxX, minZ, maxZ } = track.bbox;
  const rally = track.kind === 'rally';
  const max = (T.cactus ? 260 : T.acacia ? 220 : T.pine > 0.8 ? 700 : 520) * (rally ? 1.5 : 1);
  const acaciaMat = T.acacia ? sprite(TX.roundTreeTex(T.leaves, 1)) : null;
  let placed = 0;
  for (let n = 0; n < 9000 && placed < max; n++) {
    const x = minX - 160 + r() * (maxX - minX + 320);
    const z = minZ - 160 + r() * (maxZ - minZ + 320);
    if (track.depth(x, z) > (rally ? -2.5 : -6)) continue;   // rally: the forest comes right up to the fence
    if (acaciaMat && r() < 0.8) {
      // savanna: wide, flat-topped acacia
      const h = 5 + r() * 3;
      const s = new THREE.Sprite(acaciaMat);
      s.scale.set(h * 1.9, h * 0.75, 1);
      s.position.set(x, h * 0.55, z);
      scene.add(s);
      placed++;
      continue;
    }
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
//  Rally cars (same interface as the kart model). Front = local -z.
// ============================================================
export function createCarModel(colorHex, num, carId = 'yaris', night = false) {
  const S = (CAR_BY_ID[carId] || CAR_BY_ID.yaris).shape;
  const g = new THREE.Group();
  const col = new THREE.Color(colorHex);
  const paint = lambert(null, { color: col });
  const livery = lambert(TX.carBodyTex(colorHex, num));
  const glass = lambert(null, { color: 0x1e2a3a });
  const dark = lambert(null, { color: 0x1a1a1e });
  const add = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const y0 = 0.24, top = y0 + S.bodyH, L = S.len, half = L / 2;
  // body (sides carry the livery), cabin (glass all round, painted roof)
  add(1.8, S.bodyH, L, [livery, livery, paint, dark, paint, paint], 0, y0 + S.bodyH / 2, 0);
  add(1.52, S.cabH, S.cab, [glass, glass, paint, dark, glass, glass], 0, top + S.cabH / 2, S.cabZ);
  // bumpers & grille
  add(1.84, 0.18, 0.12, dark, 0, y0 + 0.1, -half - 0.02);
  add(1.84, 0.18, 0.12, dark, 0, y0 + 0.1, half + 0.02);
  add(1.0, 0.18, 0.04, dark, 0, y0 + S.bodyH * 0.55, -half - 0.02);
  // lights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const sx of [-1, 1]) {
    add(0.34, 0.12, 0.04, headMat, sx * 0.62, top - 0.14, -half - 0.03);
    add(0.32, 0.12, 0.04, tailMat, sx * 0.64, top - 0.12, half + 0.03);
  }
  if (S.pod) for (let k = 0; k < 4; k++) add(0.18, 0.18, 0.08, headMat, -0.48 + k * 0.32, top + 0.02, -half + 0.05);
  if (S.scoop) add(0.5, 0.1, 0.5, dark, 0, top + 0.05, -half + 0.9);
  // spoilers / wings
  const cabRear = S.cabZ + S.cab / 2;
  if (S.wing === 1) add(1.42, 0.06, 0.32, paint, 0, top + S.cabH - 0.02, cabRear + 0.05);
  if (S.wing >= 2) {
    const h = S.wing === 3 ? 0.45 : 0.32;
    for (const sx of [-1, 1]) add(0.06, h, 0.06, dark, sx * 0.55, top + h / 2, half - 0.3);
    add(S.wing === 3 ? 1.8 : 1.68, 0.06, 0.36, paint, 0, top + h, half - 0.3);
  }
  // wheels, arches, mud flaps
  const wb = L * 0.31;
  const wheels = [];
  const wheelMat = lambert(TX.wheelTex());
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xffd23b });
  for (const [x, z] of [[0.8, -wb], [-0.8, -wb], [0.8, wb], [-0.8, wb]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.33, z);
    const wg = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10);
    wg.rotateZ(Math.PI / 2);
    const wm = new THREE.Mesh(wg, wheelMat);
    pivot.add(wm);
    const hg = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8);
    hg.rotateZ(Math.PI / 2);
    pivot.add(new THREE.Mesh(hg, hubMat));
    g.add(pivot);
    wheels.push({ pivot, mesh: wm, front: z < 0 });
    if (S.flares) add(0.14, 0.3, 0.95, paint, Math.sign(x) * 0.96, y0 + 0.36, z);
    add(0.36, 0.26, 0.04, dark, Math.sign(x) * 0.76, 0.22, z + 0.45);
  }
  // boost flame from the exhaust (points backwards = +z)
  const flameGeo = new THREE.ConeGeometry(0.16, 0.9, 6);
  flameGeo.rotateX(Math.PI / 2);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffa020 }));
  flame.position.set(0.5, 0.32, half + 0.5);
  flame.visible = false;
  g.add(flame);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, L + 0.4),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.07;
  g.add(shadow);
  let beam = null;
  if (night) {
    beam = createHeadBeam(16, 9);
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

/** in-car view for rally: bonnet, dashboard, slim A-pillars and the roof edge */
export function createCarCockpit(colorHex, carId = 'yaris', night = false) {
  const S = (CAR_BY_ID[carId] || CAR_BY_ID.yaris).shape;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(night ? 0x8898d0 : 0xe8f4ff, 0x404040, night ? 0.8 : 1.6));
  const sun = new THREE.DirectionalLight(night ? 0xb0c0ff : 0xffffff, night ? 0.6 : 1.6);
  sun.position.set(0.5, 2, 1);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(72, 16 / 9, 0.01, 30);
  const root = new THREE.Group();
  scene.add(root);
  const paint = lambert(null, { color: new THREE.Color(colorHex) });
  const dark = lambert(null, { color: 0x18181c });
  const trim = lambert(null, { color: 0x2c2c34 });
  const add = (w, h, d, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    root.add(m);
    return m;
  };
  // bonnet (sloping away) with its edges, optional duct and light pod: the lower quarter of the view
  add(1.75, 0.06, 2.2, paint, 0, -0.62, -2.05, 0.05);
  for (const sx of [-1, 1]) add(0.1, 0.1, 2.1, paint, sx * 0.86, -0.59, -2.0, 0.05);
  if (S.scoop) add(0.42, 0.07, 0.4, dark, 0, -0.56, -1.7, 0.05);
  if (S.pod) {
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    for (let k = 0; k < 4; k++) add(0.16, 0.14, 0.06, lamp, -0.48 + k * 0.32, -0.6, -3.12);
  }
  // low dashboard, door tops, slim A-pillars at the edges of the view, roof edge at the very top
  add(1.9, 0.2, 0.45, trim, 0, -0.62, -0.68);
  add(1.9, 0.03, 0.47, dark, 0, -0.52, -0.68);
  for (const sx of [-1, 1]) {
    add(0.1, 0.25, 1.2, trim, sx * 1.0, -0.55, -0.4);
    add(0.06, 1.1, 0.06, dark, sx * 0.93, 0.0, -0.8, -0.45, sx * 0.06);
  }
  add(1.9, 0.06, 0.4, dark, 0, 0.52, -0.72);
  // steering wheel: only its top rim shows at the bottom of the view
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, -0.5, -0.6);
  wheelPivot.rotation.x = -0.4;
  const wheelInner = new THREE.Group();
  wheelInner.add(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ map: TX.steeringTex(colorHex), transparent: true, alphaTest: 0.5 })));
  wheelPivot.add(wheelInner);
  root.add(wheelPivot);
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xffd23b });
  return {
    scene, cam, root, wheelInner, frontWheels: [], hubMat,
    setTyre(type) {
      const T = TYRES[type];
      if (T) hubMat.color.setHex(T.hex);
    },
  };
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
