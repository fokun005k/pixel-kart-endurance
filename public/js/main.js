// ============================================================
//  PIXEL KART ENDURANCE – client entry point
//  low-res render pipeline, game loop, race flow, networking glue
// ============================================================
import * as THREE from 'three';
import {
  RENDER_W, RENDER_H, MIRROR, EYE_H, PHYS_STEP, NET_RATE, PHYS, TYRES, TYRE_ORDER,
  SKILL_BY_ID, KART_COLORS, SMOKE_VISION_TIME, PIT,
} from './config.js';
import { Track } from './track.js';
import { COURSES } from './courses.js';
import { buildWorld, createKartModel, createNameTag, createCockpit, createHeadBeam } from './world.js';
import { Kart } from './kart.js';
import { BotDriver } from './bot.js';
import { Hud, fmtLap } from './hud.js';
import { sound } from './audio.js';
import { Net } from './net.js';
import { UI } from './ui.js';
import { SmokeSystem } from './effects.js';
import { mulberry32 } from './textures.js';
import { TouchControls } from './touch.js';
import { KeyBindings, TouchLayout } from './controls.js';
import { Settings } from './settings.js';

// ------------------------------------------------------------
//  Rendering pipeline: 480x270 render target canvas, upscaled pixelated
// ------------------------------------------------------------
const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(RENDER_W, RENDER_H, false);

// one Track per course (geometry/queries only; cheap to keep)
const TRACKS = COURSES.map(c => new Track(c));

// current environment (course + time of day); rebuilt by loadEnvironment()
let track = TRACKS[0];
let world = null;
let scene = null;
let FOG_NEAR = 90, FOG_FAR = 520;
let envKey = '';
let headBeam = null;   // local player's headlight beam (night)

const camera = new THREE.PerspectiveCamera(72, RENDER_W / RENDER_H, 0.3, 1600);
camera.rotation.order = 'YXZ';
const rearCam = new THREE.PerspectiveCamera(42, MIRROR.w / MIRROR.h, 0.3, 500);
rearCam.rotation.order = 'YXZ';
const mirrorRT = new THREE.WebGLRenderTarget(MIRROR.w, MIRROR.h, {
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
});

// overlay pass (rear-view mirror) in render-pixel coordinates, origin top-left
const overlayScene = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(0, RENDER_W, 0, -RENDER_H, -10, 10);
function overlayQuad(x, y, w, h, mat, order) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x + w / 2, -(y + h / 2), 0);
  m.renderOrder = order;
  mat.depthTest = false;
  overlayScene.add(m);
  return m;
}
overlayQuad(MIRROR.x - 3, MIRROR.y - 3, MIRROR.w + 6, MIRROR.h + 6, new THREE.MeshBasicMaterial({ color: 0x0c0c10 }), 0);
overlayQuad(MIRROR.x - 2, MIRROR.y - 2, MIRROR.w + 4, MIRROR.h + 4, new THREE.MeshBasicMaterial({ color: 0x6a6a78 }), 1);
{
  const geo = new THREE.PlaneGeometry(MIRROR.w, MIRROR.h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // mirror image
  const mat = new THREE.MeshBasicMaterial({ map: mirrorRT.texture, depthTest: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(MIRROR.x + MIRROR.w / 2, -(MIRROR.y + MIRROR.h / 2), 0);
  m.renderOrder = 2;
  overlayScene.add(m);
}

let cockpit = createCockpit(KART_COLORS[0]);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.min(w / RENDER_W, h / RENDER_H);
  const cw = Math.floor(RENDER_W * s), ch = Math.floor(RENDER_H * s);
  const left = Math.floor((w - cw) / 2), top = Math.floor((h - ch) / 2);
  for (const c of [glCanvas, hudCanvas]) {
    c.style.width = `${cw}px`;
    c.style.height = `${ch}px`;
    c.style.left = `${left}px`;
    c.style.top = `${top}px`;
  }
  // canvas rect for CSS positioning of the touch buttons
  const root = document.documentElement.style;
  root.setProperty('--cv-left', `${left}px`);
  root.setProperty('--cv-top', `${top}px`);
  root.setProperty('--cv-w', `${cw}px`);
  root.setProperty('--cv-h', `${ch}px`);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------
//  State
// ------------------------------------------------------------
const net = new Net();
const hud = new Hud(hudCanvas, track);
let smoke = null;

/** Build (or reuse) the 3D world for a course and time of day. */
function loadEnvironment(courseId, night) {
  const id = Math.max(0, Math.min(COURSES.length - 1, courseId | 0));
  const key = `${id}|${night ? 1 : 0}`;
  if (key === envKey) return false;
  const hadDemo = G.demo.length > 0;
  stopDemo();
  if (world) world.dispose();
  track = TRACKS[id];
  world = buildWorld(track, { theme: COURSES[id].theme, night: !!night });
  scene = world.scene;
  FOG_NEAR = world.fogNear;
  FOG_FAR = world.fogFar;
  smoke = new SmokeSystem(scene);
  hud.setTrack(track);
  headBeam = null;
  if (night) {
    headBeam = createHeadBeam();
    scene.add(headBeam);
  }
  envKey = key;
  G.attractDist = 0;
  if (hadDemo) startDemo();
  return true;
}

function loadSel() {
  try {
    const s = JSON.parse(localStorage.getItem('pke.sel') || 'null');
    if (s && TYRES[s.tyre] && SKILL_BY_ID[s.skill]) return { tyre: s.tyre, skill: s.skill };
  } catch { /* ignore */ }
  return { tyre: 'M', skill: 'meister' };
}
function saveSel() {
  try { localStorage.setItem('pke.sel', JSON.stringify(G.sel)); } catch { /* ignore */ }
}

const G = {
  phase: 'title',      // title | lobby | race | results
  myId: null,
  room: null,
  sel: loadSel(),
  race: null,
  me: null,
  remotes: new Map(),  // id -> remote kart (interpolated from snapshots)
  bots: new Map(),     // id -> host-simulated CPU kart
  demo: [],            // attract-mode karts behind the menus
  attractDist: 0,
  smokeVision: 0,
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ------------------------------------------------------------
//  UI wiring
// ------------------------------------------------------------
const ui = new UI({
  async onCreate(name) {
    ui.setTitleError('');
    if (!net.connected) return ui.setTitleError('サーバーに接続できません（npm start でサーバーを起動してください）');
    const res = await net.createRoom(name);
    if (!res || !res.ok) return ui.setTitleError((res && res.error) || 'ルームを作成できませんでした');
    G.myId = res.you;
    enterLobby();
  },
  async onJoin(name, roomId) {
    ui.setTitleError('');
    if (!roomId) return ui.setTitleError('ルームIDを入力してください');
    if (!net.connected) return ui.setTitleError('サーバーに接続できません');
    const res = await net.joinRoom(name, roomId);
    if (!res || !res.ok) { sound.sfx('error'); return ui.setTitleError((res && res.error) || '参加できませんでした'); }
    G.myId = res.you;
    enterLobby();
  },
  onLeave() {
    net.leaveRoom();
    goTitle();
  },
  onSelectTyre(t) {
    G.sel.tyre = t;
    saveSel();
    ui.renderSelection(G.sel);
    net.updatePlayer(G.sel);
  },
  onSelectSkill(s) {
    G.sel.skill = s;
    saveSel();
    ui.renderSelection(G.sel);
    net.updatePlayer(G.sel);
  },
  onDuration(sec) { net.setDuration(sec); },
  onCourse(id) { net.setCourse(id); },
  onNight(on) { net.setNight(on); },
  onAddBot() { net.addBot(); },
  onRemoveBot() { net.removeBot(); },
  onStart() { net.startRace(); },
  onBackToLobby() {
    if (G.room) enterLobby(); else goTitle();
  },
  onPitChoose(t) { pitChoose(t); },
  onPitSkip() {
    if (G.me && G.me.pit.state === 'menu') G.me.pit.state = 'declined';
    ui.hidePitMenu();
  },
  onFullscreen() { touch.fullscreen(); },
  onAutoAccel(on) { touch.setAutoAccel(on); },
  onRespawn() { respawn(); },
  onResume() { ui.setPause(false); },
  onQuitRace() {
    net.leaveRoom();
    clearRace();
    goTitle();
  },
});

// player control settings (rebindable keys, smartphone button layout)
const bindings = new KeyBindings();
const touchLayout = new TouchLayout();

const touch = new TouchControls({
  onSkill: () => { sound.ensure(); skillQueued = true; },
  onMenu: () => ui.setPause(!ui.paused),
  onRespawn: () => respawn(),
  layout: touchLayout,
});
hud.setTouch(touch.enabled);
ui.syncAutoAccel(touch.autoAccel);
const settings = new Settings({ bindings, layout: touchLayout, touch, toast: (m, ms) => ui.toast(m, ms) });

function respawn() {
  if (G.phase === 'race' && G.me && G.race && G.race.active && G.me.pit.state !== 'work') G.me.respawn();
}

function enterLobby() {
  G.phase = 'lobby';
  ui.show('lobby');
  if (G.room) {
    loadEnvironment(G.room.course, G.room.night);
    ui.renderLobby(G.room, G.myId, G.sel);
  }
  net.updatePlayer(G.sel);
  sound.playBgm('lobby');
  if (!G.demo.length) startDemo();
}

function goTitle() {
  G.phase = 'title';
  G.room = null;
  ui.show('title');
  sound.stopEngine();
  sound.setFast(false);
  sound.playBgm('lobby');
  loadEnvironment(0, false);
  if (!G.demo.length) startDemo();
}

// ------------------------------------------------------------
//  Network events
// ------------------------------------------------------------
net.on('lobby', (room) => {
  G.room = room;
  if (G.phase === 'lobby') {
    // the menu background shows the selected course / time of day
    loadEnvironment(room.course, room.night);
    ui.renderLobby(room, G.myId, G.sel);
  }
});
net.on('raceInit', (data) => startRace(data));
net.on('snapshot', (snap) => {
  if (G.phase !== 'race' || !G.race) return;
  const now = performance.now();
  for (const p of snap.players) {
    if (p.id === G.myId || G.bots.has(p.id)) continue;
    const r = G.remotes.get(p.id);
    if (!r) continue;
    r.target = p;
    r.recvAt = now;
  }
});
net.on('skill', ({ id, type }) => {
  const r = G.remotes.get(id);
  if (!r) return;
  if (type === 'smoke') r.smokeT = PHYS.SMOKE_EMIT;
  if (type === 'nitro') r.nitroT = 3;
  if (G.me) {
    const d = Math.hypot(r.disp.x - G.me.x, r.disp.z - G.me.z);
    if (d < 60) sound.sfx(type);
  }
});
net.on('playerLeft', ({ id }) => {
  const r = G.remotes.get(id) || G.bots.get(id);
  if (r) scene.remove(r.model.group);
  G.remotes.delete(id);
  G.bots.delete(id);
});
net.on('raceEnd', (data) => finishRace(data));
net.on('disconnect', () => {
  if (G.phase !== 'title') {
    ui.toast('サーバーとの接続が切れました', 3500);
    clearRace();
    goTitle();
  }
});

// ------------------------------------------------------------
//  Input
// ------------------------------------------------------------
// held inputs: keyboard codes ("KeyW") and mouse buttons ("Mouse2")
const keys = new Set();
let skillQueued = false;
const PIT_KEYS = { Digit1: 'S', Digit2: 'M', Digit3: 'H', Numpad1: 'S', Numpad2: 'M', Numpad3: 'H' };

/** one-shot actions (skill, respawn, menu, mute) for a pressed key or mouse button */
function pressAction(code) {
  for (const a of bindings.actionsFor(code)) {
    if (a === 'skill') skillQueued = true;
    else if (a === 'pause') ui.setPause(!ui.paused);
    else if (a === 'respawn') respawn();
    else if (a === 'mute') {
      const s = sound.settings;
      const mute = !(s.bgmMute && s.seMute);
      sound.setSettings({ bgmMute: mute, seMute: mute });
      ui.toast(mute ? 'ミュート ON' : 'ミュート OFF', 1000);
    }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (settings.busy) return;                       // typing into the settings dialog / editing the layout
  const racing = G.phase === 'race';
  // keep bound keys (Space, arrows, ...) from scrolling the page or triggering browser shortcuts
  if (racing && (bindings.actionsFor(e.code).length || e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  keys.add(e.code);
  if (e.repeat || !racing) return;
  pressAction(e.code);
  if (PIT_KEYS[e.code]) pitChoose(PIT_KEYS[e.code]);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

// mouse buttons can be bound like keys (only on the game screen, not on UI buttons)
const stageEl = document.getElementById('stage');
stageEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || G.phase !== 'race' || settings.busy || ui.paused) return;
  if (e.target.closest('button')) return;
  const code = 'Mouse' + e.button;
  keys.add(code);
  pressAction(code);
});
window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') keys.delete('Mouse' + e.button); });
stageEl.addEventListener('contextmenu', (e) => { if (G.phase === 'race') e.preventDefault(); });
window.addEventListener('blur', () => { keys.clear(); touch.reset(); });

function held(action) {
  const [a, b] = bindings.get(action);
  return (a && keys.has(a)) || (b && keys.has(b));
}

function readInput() {
  if (ui.paused || settings.busy) return { throttle: 0, brake: 0, steer: 0 };
  const brake = (held('brake') || touch.brake) ? 1 : 0;
  let throttle = (held('accel') || touch.accel) ? 1 : 0;
  // smartphone auto-accelerate (paused while the pit menu is open so the kart can stay in the box)
  if (touch.enabled && touch.autoAccel && !brake && G.me && G.me.pit.state !== 'menu' && G.me.pit.state !== 'work') throttle = 1;
  const keySteer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  return { throttle, brake, steer: keySteer || touch.steer };
}

function pitChoose(t) {
  if (G.phase !== 'race' || !G.me) return;
  if (G.me.startPitWork(t)) sound.sfx('wrench');
}

// ------------------------------------------------------------
//  Kart models
// ------------------------------------------------------------
function makeModel(p) {
  const color = KART_COLORS[p.color % KART_COLORS.length];
  const model = createKartModel(color, p.color + 1, world.night);
  model.setTyre(p.tyre);
  model.tyre = p.tyre;
  model.group.add(createNameTag(p.name, color));
  scene.add(model.group);
  return model;
}

function placeModel(model, x, y, z, h, steer, v, dt, boost, tyreType) {
  model.group.position.set(x, y, z);
  model.group.rotation.y = h;
  for (const w of model.wheels) {
    if (w.front) w.pivot.rotation.y = -steer * 0.45;
    w.mesh.rotation.x -= (v * dt) / 0.3;
  }
  model.flame.visible = !!boost;
  if (boost) model.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  model.shadow.position.y = -y + 0.07;
  if (model.beam) model.beam.position.y = -y + 0.08;
  if (tyreType && model.tyre !== tyreType) {
    model.tyre = tyreType;
    model.setTyre(tyreType);
  }
}

// ------------------------------------------------------------
//  Attract mode (demo karts behind title/lobby)
// ------------------------------------------------------------
function startDemo() {
  stopDemo();
  const r = mulberry32(99);
  for (let i = 0; i < 5; i++) {
    const k = new Kart(track, { id: 'demo' + i, skill: 'meister', tyreType: TYRE_ORDER[i % 3] });
    k.placeAt(track.length * (i / 5) + 20, (r() - 0.5) * 6);
    const model = createKartModel(KART_COLORS[i], i + 1, world.night);
    model.setTyre(k.tyreType);
    scene.add(model.group);
    G.demo.push({ kart: k, driver: new BotDriver(k, track, mulberry32(i * 7 + 3), i), model, acc: 0 });
  }
}
function stopDemo() {
  for (const d of G.demo) scene.remove(d.model.group);
  G.demo = [];
}

function updateAttract(dt) {
  G.attractDist = (G.attractDist + dt * 15) % track.length;
  const p = track.pointAt(G.attractDist, 0);
  const la = track.pointAt(G.attractDist + 28, 0);
  camera.position.set(p.x, 5.5 + Math.sin(G.attractDist * 0.01) * 1.5, p.z);
  camera.fov = 72;
  camera.updateProjectionMatrix();
  camera.lookAt(la.x, 1.2, la.z);
  if (headBeam) headBeam.visible = false;
  const karts = G.demo.map(d => d.kart);
  for (const d of G.demo) {
    const inp = d.driver.input(dt, 999, true);
    d.acc += dt;
    while (d.acc >= PHYS_STEP) {
      d.kart.step(PHYS_STEP, inp, { others: karts, spurtMul: 1, active: true, raceTime: 0, noWear: true });
      d.acc -= PHYS_STEP;
    }
    d.kart.events.length = 0;
    const k = d.kart;
    placeModel(d.model, k.x, k.y, k.z, k.heading, k.steer, k.vf, dt, k.boostT > 0);
  }
}

// ------------------------------------------------------------
//  Race lifecycle
// ------------------------------------------------------------
function clearRace() {
  for (const r of G.remotes.values()) scene.remove(r.model.group);
  for (const b of G.bots.values()) scene.remove(b.model.group);
  G.remotes.clear();
  G.bots.clear();
  G.me = null;
  G.race = null;
  smoke.clear();
  G.smokeVision = 0;
  scene.fog.near = FOG_NEAR;
  scene.fog.far = FOG_FAR;
  hud.clear();
  hud.messages = [];
  ui.setSkillButton(false);
  ui.hidePitMenu();
  ui.setRotateHint(false);
  touch.reset();
  document.body.classList.remove('racing');
  for (const l of world.gantryLights) l.material.color.setHex(0x3a0808);
}

function startRace(data) {
  sound.ensure();
  clearRace();
  stopDemo();
  G.room = data.room;
  loadEnvironment(G.room.course, G.room.night);
  stopDemo();
  if (headBeam) headBeam.visible = true;
  const meInfo = G.room.players.find(p => p.id === G.myId);
  if (!meInfo) return;
  const slotOf = id => (data.grid.find(g => g.id === id) || { slot: 0 }).slot;

  G.race = {
    startAt: data.startAt, endAt: data.endAt, duration: data.duration,
    acc: 0, sendAcc: 0, active: false, finished: false,
    lastCount: null, goPlayed: false, spurtOn: false, lowWarned: false,
    lastBump: 0, wrenchT: 0, wrongWayT: 0, skillWasReady: true,
  };

  const me = new Kart(track, { id: G.myId, skill: G.sel.skill, tyreType: G.sel.tyre });
  const sl = track.slot(slotOf(G.myId));
  me.placeAt(sl.dist, sl.d);
  G.me = me;
  const myColor = KART_COLORS[meInfo.color % KART_COLORS.length];
  cockpit = createCockpit(myColor, world.night);
  cockpit.setTyre(me.tyreType);

  const isHost = G.room.hostId === G.myId;
  let botIdx = 1;
  for (const p of G.room.players) {
    if (p.id === G.myId) continue;
    const slot = track.slot(slotOf(p.id));
    const model = makeModel(p);
    if (p.isBot) {
      if (!isHost) {
        // simulated by the host; we only display it
      } else {
        const k = new Kart(track, { id: p.id, skill: p.skill, tyreType: p.tyre });
        k.placeAt(slot.dist, slot.d);
        const driver = new BotDriver(k, track, mulberry32(hashStr(p.id)), botIdx++);
        G.bots.set(p.id, { info: p, kart: k, driver, model, input: { throttle: 0, brake: 0, steer: 0 } });
        continue;
      }
    }
    const pt = track.pointAt(slot.dist, slot.d);
    const st = { x: pt.x, y: 0, z: pt.z, h: pt.heading, v: 0, st: 0, d: -0.01, lap: -1, tt: p.tyre, tw: 100, b: 0, p: 0 };
    G.remotes.set(p.id, {
      info: p, model, target: st, recvAt: performance.now(), smokeT: 0, nitroT: 0,
      disp: { x: pt.x, y: 0, z: pt.z, h: pt.heading, vx: 0, vz: 0, v: 0, st: 0 },
    });
  }

  G.phase = 'race';
  ui.show('race');
  document.body.classList.add('racing');
  ui.setSkillButton(SKILL_BY_ID[me.skill].type === 'active');
  hud.messages = [];
  sound.setFast(false);
  sound.playBgm('race');
  sound.startEngine();
}

function finishRace(data) {
  if (!G.race) return;
  G.race.finished = true;
  G.race.active = false;
  sound.stopEngine();
  sound.setFast(false);
  sound.sfx('finish');
  hud.message('FINISH!', '#ffd23b', 2.6, 9);
  const results = data.results;
  const trackLen = track.length;
  setTimeout(() => {
    if (G.phase !== 'race') return;
    clearRace();
    G.phase = 'results';
    ui.showResults(results, G.myId, trackLen);
    sound.playBgm('lobby');
    startDemo();
  }, 2800);
}

const SKILL_SHORT = { nitro: 'NITRO', smoke: 'SMOKE', aerojump: 'JUMP' };

function spurtMulFor(skill, remaining, active) {
  if (!active) return 1;
  if (skill === 'overclock') return remaining <= PHYS.OVERCLOCK_TIME ? PHYS.OVERCLOCK_MUL : 1;
  return remaining <= PHYS.SPURT_TIME ? PHYS.SPURT_MUL : 1;
}

// ------------------------------------------------------------
//  Race update
// ------------------------------------------------------------
function updateRace(dt, time) {
  const race = G.race;
  const me = G.me;
  const sNow = net.serverNow();
  const tRace = (sNow - race.startAt) / 1000;
  const remaining = Math.max(0, Math.min(race.duration, (race.endAt - sNow) / 1000));
  race.active = !race.finished && tRace >= 0 && remaining > 0;
  const active = race.active;

  // ---- countdown & start lights
  let cd = null;
  if (tRace < 0) {
    const n = Math.ceil(-tRace);
    if (n <= 3) {
      cd = { text: String(n), color: '#ffd23b' };
      if (race.lastCount !== n) { race.lastCount = n; sound.sfx('count'); }
    } else {
      cd = { text: 'READY', color: '#ffffff', sub: `TYRE ${TYRES[me.tyreType].en} / ${SKILL_BY_ID[me.skill].en}` };
    }
    const lit = Math.max(0, Math.min(5, Math.floor(tRace + 5) + 1));
    world.gantryLights.forEach((l, i) => l.material.color.setHex(i < lit ? 0xff2020 : 0x3a0808));
  } else if (tRace < 1.3 && !race.finished) {
    cd = { text: 'GO!', color: '#40ff70' };
    if (!race.goPlayed) {
      race.goPlayed = true;
      sound.sfx('go');
      world.gantryLights.forEach(l => l.material.color.setHex(0x20ff40));
    }
  } else if (race.goPlayed && tRace < 4) {
    world.gantryLights.forEach(l => l.material.color.setHex(0x0a3a10));
  }

  // ---- last spurt (x1.1 from 30s / overclock x1.2 from 60s)
  const mySpurt = spurtMulFor(me.skill, remaining, active);
  if (mySpurt > 1 && !race.spurtOn) {
    race.spurtOn = true;
    sound.setFast(true);
    sound.sfx('spurt');
    hud.message(me.skill === 'overclock' ? 'OVERCLOCK X1.2!' : 'LAST SPURT X1.1!', '#ff4040', 2.8, 5);
  }

  // ---- input & skills
  const inp = readInput();
  if (skillQueued) {
    skillQueued = false;
    const fired = me.activateSkill(active);
    if (fired) {
      sound.sfx(fired);
      net.sendSkill(fired);
      hud.message(SKILL_BY_ID[fired].en + '!', '#ffb040', 1.2, 4);
    } else if (SKILL_BY_ID[me.skill].type === 'active' && active) {
      sound.sfx('error');
    }
  }
  const ready = me.skillCd <= 0;
  if (SKILL_BY_ID[me.skill].type === 'active') {
    if (ready && !race.skillWasReady) sound.sfx('skillReady');
    ui.updateSkillButton(SKILL_SHORT[me.skill] || 'SKILL', me.skillCd, bindings.describe('skill', true));
  }
  race.skillWasReady = ready;
  ui.setRotateHint(touch.enabled && window.innerHeight > window.innerWidth);

  // ---- collect other karts for collisions / slipstream
  const remoteDisps = [...G.remotes.values()].map(r => r.disp);
  const botKarts = [...G.bots.values()].map(b => b.kart);
  const othersForMe = remoteDisps.concat(botKarts);

  for (const b of G.bots.values()) b.input = b.driver.input(dt, remaining, active);

  // ---- fixed-step physics
  race.acc += dt;
  let steps = 0;
  const envMe = { others: othersForMe, spurtMul: mySpurt, active, raceTime: tRace };
  while (race.acc >= PHYS_STEP && steps < 40) {
    me.step(PHYS_STEP, inp, envMe);
    for (const b of G.bots.values()) {
      const others = [me, ...remoteDisps, ...botKarts];
      b.kart.step(PHYS_STEP, b.input, { others, spurtMul: spurtMulFor(b.kart.skill, remaining, active), active, raceTime: tRace });
    }
    race.acc -= PHYS_STEP;
    steps++;
  }
  if (steps >= 40) race.acc = 0;

  // ---- events from my kart
  for (const e of me.events) handleKartEvent(e, time);
  me.events.length = 0;
  for (const b of G.bots.values()) b.kart.events.length = 0;

  // ---- pit UI
  if (me.pit.state === 'work') {
    ui.showPitWork(1 - me.pit.workT / me.pit.workTotal, Math.max(0, me.pit.workT), me.pit.choice);
    race.wrenchT -= dt;
    if (race.wrenchT <= 0) { race.wrenchT = 0.42; sound.sfx('wrench'); }
  }

  // ---- tyre warnings
  if (me.tyre <= 30 && !race.lowWarned && me.tyre > 0) {
    race.lowWarned = true;
    hud.message('TYRE LOW!', '#ff8080', 2, 4);
  }
  if (me.tyre > 30) race.lowWarned = false;

  // ---- wrong way
  if (me.q && active && me.speed > 4) {
    const dot = me.vx * track.tx[me.q.i] + me.vz * track.tz[me.q.i];
    race.wrongWayT = dot < -2 ? race.wrongWayT + dt : 0;
    if (race.wrongWayT > 1.2) { hud.message('WRONG WAY!', '#ff3030', 0.6, 5); race.wrongWayT = 0.6; }
  }

  // ---- smoke screen
  if (me.smokeT > 0) smoke.emitFromKart(G.myId, me, dt);
  if (smoke.hit(me.x, me.y + 1, me.z, G.myId)) {
    if (G.smokeVision <= 0) hud.message('SMOKE!', '#d0d0d0', 1, 4);
    G.smokeVision = SMOKE_VISION_TIME;
    me.smokeSlowT = 0.4;   // slowed while inside the cloud
  }
  for (const [id, b] of G.bots) {
    if (smoke.hit(b.kart.x, b.kart.y + 1, b.kart.z, id)) b.kart.smokeSlowT = 0.4;
  }
  G.smokeVision = Math.max(0, G.smokeVision - dt);
  const smokeAmt = Math.min(1, G.smokeVision / 1.2);
  scene.fog.near = FOG_NEAR + (4 - FOG_NEAR) * smokeAmt;
  scene.fog.far = FOG_FAR + (40 - FOG_FAR) * smokeAmt;

  // ---- remote karts (interpolation) & bots
  updateRemotes(dt);
  for (const [id, b] of G.bots) {
    const k = b.kart;
    placeModel(b.model, k.x, k.y, k.z, k.heading, k.steer, k.vf, dt, k.boostT > 0, k.tyreType);
    if (k.smokeT > 0) smoke.emitFromKart(id, k, dt);
  }

  // ---- network
  race.sendAcc += dt;
  if (race.sendAcc >= NET_RATE) {
    race.sendAcc = 0;
    net.sendState(me.netState());
    if (G.bots.size) net.sendBotStates([...G.bots.entries()].map(([id, b]) => ({ id, ...b.kart.netState() })));
  }

  // ---- audio
  const onRough = (me.surface === 'dirt' || me.surface === 'grass') && !me.airborne;
  sound.updateEngine({
    speedFrac: me.rpm,   // engine pitch follows the revs (drops on every upshift)
    throttle: active ? inp.throttle : (tRace < 0 ? inp.throttle * 0.6 : 0),
    boost: me.boostT > 0,
    skid: me.airborne ? 0 : me.skid,
    dirt: onRough ? Math.min(1, me.speed / 10) : 0,
    wind: me.slip,
  });

  updateCamera(dt);
  hud.draw(buildHudState(remaining, cd, time), dt);
}

function handleKartEvent(e, time) {
  const me = G.me;
  switch (e.type) {
    case 'dash':
      sound.sfx('dash');
      hud.message('DASH!', '#ffb040', 0.8, 4);
      break;
    case 'bump':
      if (time - G.race.lastBump > 0.15) { G.race.lastBump = time; sound.sfx('bump', e); }
      break;
    case 'land':
      sound.sfx('land');
      break;
    case 'shift':
      sound.sfx('shift');
      break;
    case 'landBoost':
      sound.sfx('dash');
      hud.message('LANDING DASH!', '#7cf0ff', 1, 4);
      break;
    case 'lap': {
      const best = me.bestLap === e.time;
      sound.sfx(best && e.lap > 1 ? 'best' : 'lap');
      hud.message(`LAP ${e.lap + 1}`, '#ffffff', 1.8, 6);
      hud.message(`${best ? 'BEST ' : ''}${fmtLap(e.time)}`, best ? '#40ff70' : '#ffe060', 1.8, 3);
      break;
    }
    case 'burst':
      sound.sfx('burst');
      hud.message('BURST!!', '#ff3030', 2.5, 7);
      break;
    case 'pitMenu':
      sound.sfx('pitEnter');
      ui.showPitMenu({ box: e.box, err: e.err, time: me.pitTimeFor(e.err), quick: me.skill === 'quickpit', current: me.tyreType });
      break;
    case 'pitMenuClose':
      ui.hidePitMenu();
      break;
    case 'pitStart':
      hud.message(`${e.quality} STOP! ${e.time.toFixed(1)}S`, e.quality === 'PERFECT' ? '#40ff70' : '#ffe060', 1.8, 3);
      G.race.wrenchT = 0.42;
      break;
    case 'pitDone':
      ui.hidePitMenu();
      sound.sfx('pitDone');
      cockpit.setTyre(e.tyre);
      hud.message(`PIT OUT - ${TYRES[e.tyre].en}`, '#ffffff', 1.8, 4);
      break;
    case 'quickpitBoost':
      sound.sfx('dash');
      hud.message('QUICK PIT BOOST!', '#7cf0ff', 1.5, 4);
      break;
    case 'respawn':
      hud.message('RESPAWN', '#ffffff', 1, 4);
      break;
  }
}

function updateRemotes(dt) {
  const now = performance.now();
  const k = 1 - Math.exp(-12 * dt);
  for (const [id, r] of G.remotes) {
    const t = r.target;
    const age = Math.min(0.25, (now - r.recvAt) / 1000);
    const fx = -Math.sin(t.h), fz = -Math.cos(t.h);
    const px = t.x + fx * t.v * age, pz = t.z + fz * t.v * age;
    const d = r.disp;
    if (Math.hypot(px - d.x, pz - d.z) > 12) { d.x = px; d.z = pz; } else { d.x += (px - d.x) * k; d.z += (pz - d.z) * k; }
    d.y += (t.y - d.y) * Math.min(1, dt * 15);
    d.h += wrapAngle(t.h - d.h) * k;
    d.vx = fx * t.v; d.vz = fz * t.v; d.v = t.v; d.st = t.st;
    d.heading = d.h;
    if (r.nitroT > 0) r.nitroT -= dt;
    placeModel(r.model, d.x, d.y, d.z, d.h, d.st, t.v, dt, t.b || r.nitroT > 0, t.tt);
    if (r.smokeT > 0) {
      r.smokeT -= dt;
      smoke.emitFromKart(id, d, dt);
    }
  }
}

function updateCamera(dt) {
  const k = G.me;
  const speed = Math.abs(k.vf);
  let shake = 0;
  if (k.tyre <= 30) shake += (1 - k.tyre / 30) * 0.8 + 0.25 + (k.tyre <= 0 ? 0.6 : 0);
  shake *= Math.min(1, speed / 12);
  if ((k.surface === 'dirt' || k.surface === 'grass') && !k.airborne) shake += Math.min(1, speed / 15) * 0.35;
  if (k.surface === 'curb') shake += Math.min(1, speed / 15) * 0.25;
  const jx = (Math.random() - 0.5) * 0.07 * shake;
  const jy = (Math.random() - 0.5) * 0.07 * shake;
  const rx = Math.cos(k.heading), rz = -Math.sin(k.heading);
  camera.position.set(k.x + rx * jx, k.y + EYE_H + jy, k.z + rz * jx);
  camera.rotation.set(-0.03 + jy * 0.25, k.heading, -k.steer * 0.025 * Math.min(1, speed / 20) + (Math.random() - 0.5) * 0.02 * shake);
  const targetFov = 72 + Math.min(10, Math.max(0, (speed - 15) * 0.5)) + (k.boostT > 0 ? 7 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  rearCam.position.set(k.x, k.y + EYE_H + 0.25, k.z);
  rearCam.rotation.set(-0.05, k.heading + Math.PI, 0);

  // night: headlight beam on the road in front of the kart (hidden while airborne)
  if (headBeam) {
    headBeam.visible = k.y < 1.5;
    headBeam.position.set(k.x, 0.08, k.z);
    headBeam.rotation.y = k.heading;
  }

  cockpit.cam.fov = camera.fov;
  cockpit.cam.updateProjectionMatrix();
  cockpit.root.position.set(jx * 0.4, jy * 0.4, 0);
  cockpit.wheelInner.rotation.z = -k.steer * 1.5;
  for (const w of cockpit.frontWheels) {
    w.pivot.rotation.y = -k.steer * 0.45;
    w.mesh.rotation.x -= (k.vf * dt) / 0.28;
  }
}

function buildHudState(remaining, cd, time) {
  const me = G.me;
  const L = track.length;
  const entries = [];
  const meInfo = G.room.players.find(p => p.id === G.myId);
  entries.push({ name: meInfo ? meInfo.name : 'YOU', color: KART_COLORS[(meInfo ? meInfo.color : 0) % 8], dist: me.totalDist, lap: me.lap, isMe: true, pit: me.pit.state === 'work', x: me.x, z: me.z });
  for (const r of G.remotes.values()) {
    entries.push({ name: r.info.name, color: KART_COLORS[r.info.color % 8], dist: r.target.d, lap: r.target.lap, pit: !!r.target.p, x: r.disp.x, z: r.disp.z });
  }
  for (const b of G.bots.values()) {
    entries.push({ name: b.info.name, color: KART_COLORS[b.info.color % 8], dist: b.kart.totalDist, lap: b.kart.lap, pit: b.kart.pit.state === 'work', x: b.kart.x, z: b.kart.z });
  }
  entries.sort((a, b) => b.dist - a.dist);
  const leader = entries[0].dist;
  for (const e of entries) e.gapM = (leader - e.dist) * L;
  const position = entries.findIndex(e => e.isMe) + 1;

  // closest kart behind (mirror warning)
  let rearWarn = 0;
  const fx = -Math.sin(me.heading), fz = -Math.cos(me.heading);
  for (const e of entries) {
    if (e.isMe) continue;
    const dx = e.x - me.x, dz = e.z - me.z;
    const along = dx * fx + dz * fz;
    const lat = Math.abs(dx * -fz + dz * fx);
    if (along < -2 && along > -15 && lat < 6) rearWarn = 1;
  }

  // pit info + stop gauge
  let pitInfo = null;
  const q = me.q;
  if (q && (me.surface === 'pit' || me.pit.state !== 'none')) {
    pitInfo = { limiter: me.limiter, gauge: null };
    if (me.pit.state !== 'work' && q.u > PIT.U0 + PIT.RAMP - 20 && q.u < PIT.U1 - PIT.RAMP) {
      const nb = track.nextBox(q);
      if (nb) {
        const off = -nb.rem;
        const a = Math.abs(off);
        if (a < 25) {
          let text, color;
          if (a <= PIT.PERFECT) { text = 'PERFECT'; color = '#40ff70'; }
          else if (a <= PIT.BOX_LEN / 2) { text = `IN BOX ${a.toFixed(1)}M`; color = '#ffe060'; }
          else { text = `${a.toFixed(1)}M`; color = '#ffffff'; }
          pitInfo.gauge = { index: nb.index, offset: off, text, color };
        }
      }
    }
  }

  const def = SKILL_BY_ID[me.skill];
  return {
    phase: G.race.active ? 'race' : 'pre',
    time,
    remaining,
    countdown: cd,
    spurt: G.race.spurtOn,
    spurtLabel: G.race.spurtOn ? (me.skill === 'overclock' ? 'OVERCLOCK X1.2' : 'LAST SPURT X1.1') : null,
    position,
    total: entries.length,
    lap: me.lap + 1,
    bestLap: me.bestLap,
    lastLap: me.lastLap,
    speedKmh: Math.hypot(me.vx, me.vz) * 3.6,
    gear: me.vf < -0.5 ? 'R' : me.gear,
    rpm: me.rpm,
    rpmValue: me.rpmValue,
    skillKey: bindings.describe('skill', true),
    boost: me.boostT > 0,
    limiter: me.limiter,
    tyreType: me.tyreType,
    tyre: me.tyre,
    skill: { def, cd: me.skillCd, cdTotal: def.cd || 0 },
    standings: entries,
    karts: entries,
    slip: me.slip,
    smoke: Math.min(1, G.smokeVision / 1.2),
    rearWarn,
    pitInfo,
  };
}

// ------------------------------------------------------------
//  Main loop
// ------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // tolerate low frame rates (up to 40 physics sub-steps per frame) without slow motion
  const dt = Math.min(0.33, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  world.dashTex.offset.y = (time * 1.6) % 1;
  smoke.update(dt);

  if (G.phase === 'race' && G.race && G.me) {
    updateRace(dt, time);
    renderer.setRenderTarget(mirrorRT);
    renderer.render(scene, rearCam);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(cockpit.scene, cockpit.cam);
    renderer.clearDepth();
    renderer.render(overlayScene, overlayCam);
    renderer.autoClear = true;
  } else {
    updateAttract(dt);
    renderer.render(scene, camera);
  }
}

ui.setCourses(COURSES, TRACKS);
loadEnvironment(0, false);
startDemo();
ui.show('title');
requestAnimationFrame(frame);

// tiny debug handle for the browser console
window.__pke = { G, net, sound, get track() { return track; }, get world() { return world; } };
