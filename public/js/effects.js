// ============================================================
//  Smoke screen particles (pixel sprites) + hit test for vision loss
// ============================================================
import * as THREE from 'three';
import { smokeTex } from './textures.js';

const MAX = 220;

export class SmokeSystem {
  constructor(scene) {
    this.scene = scene;
    this.tex = smokeTex();
    this.puffs = [];
    for (let i = 0; i < MAX; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vz: 0, size: 1, owner: null });
    }
    this.cursor = 0;
    this.emitters = new Map(); // owner -> accumulator
  }

  emit(x, y, z, owner, vx = 0, vz = 0) {
    const p = this.puffs[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    p.life = p.max = 8 + Math.random() * 2;
    p.x = x + (Math.random() - 0.5) * 2.4;
    p.y = y + Math.random() * 0.6;
    p.z = z + (Math.random() - 0.5) * 2.4;
    p.vx = vx * 0.15 + (Math.random() - 0.5) * 1.6;
    p.vz = vz * 0.15 + (Math.random() - 0.5) * 1.6;
    p.size = 2.8 + Math.random() * 1.2;
    p.owner = owner;
    p.s.visible = true;
  }

  /** emit from the rear of a kart-like object {x,y,z,heading,vx,vz} */
  emitFromKart(id, k, dt) {
    let acc = (this.emitters.get(id) || 0) + dt;
    const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
    while (acc > 0.045) {
      acc -= 0.045;
      this.emit(k.x - fx * 2.4, (k.y || 0) + 0.7, k.z - fz * 2.4, id, k.vx || 0, k.vz || 0);
    }
    this.emitters.set(id, acc);
  }

  update(dt) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += 0.25 * dt;
      p.vx *= 1 - 0.6 * dt; p.vz *= 1 - 0.6 * dt;
      p.size += dt * 0.9;
      const age = p.max - p.life;
      const a = Math.min(1, age * 4) * Math.min(1, p.life / 1.5);
      p.s.material.opacity = 0.92 * a;
      p.s.position.set(p.x, p.y + p.size * 0.35, p.z);
      p.s.scale.set(p.size * 2, p.size * 1.6, 1);
    }
  }

  /** true if a point is inside someone else's smoke */
  hit(x, y, z, selfId) {
    for (const p of this.puffs) {
      if (p.life <= 0.6 || p.owner === selfId) continue;
      const dx = x - p.x, dz = z - p.z;
      const r = p.size * 0.9 + 0.8;
      if (dx * dx + dz * dz < r * r && Math.abs(y - p.y) < 4) return true;
    }
    return false;
  }

  clear() {
    for (const p of this.puffs) { p.life = 0; p.s.visible = false; }
    this.emitters.clear();
  }
}

// ============================================================
//  Rooster-tail spray thrown up by the tyres on a wet track (visual only)
// ============================================================
const SPRAY_MAX = 160;

export class SpraySystem {
  constructor(scene) {
    this.tex = smokeTex();
    this.drops = [];
    for (let i = 0; i < SPRAY_MAX; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: 0xdde6f0, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.drops.push({ s, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1 });
    }
    this.cursor = 0;
    this.emitters = new Map();
  }

  /** k: kart-like {x,y,z,heading,vx,vz}; amount = wetness x speed factor (0..1) */
  emitFromKart(id, k, dt, amount) {
    if (amount <= 0.02 || (k.y || 0) > 0.4) return;
    let acc = (this.emitters.get(id) || 0) + dt * amount;
    const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
    const rx = -fz, rz = fx;
    while (acc > 0.035) {
      acc -= 0.035;
      const p = this.drops[this.cursor];
      this.cursor = (this.cursor + 1) % SPRAY_MAX;
      const side = Math.random() < 0.5 ? -0.8 : 0.8;   // one plume per rear wheel
      p.life = p.max = 0.5 + Math.random() * 0.3;
      p.x = k.x - fx * 1.6 + rx * side;
      p.z = k.z - fz * 1.6 + rz * side;
      p.y = 0.2;
      p.vx = (k.vx || 0) * 0.55 - fx * 2 + (Math.random() - 0.5) * 2;
      p.vz = (k.vz || 0) * 0.55 - fz * 2 + (Math.random() - 0.5) * 2;
      p.vy = 1.5 + Math.random() * 1.5;
      p.size = 0.7 + Math.random() * 0.5;
      p.s.visible = true;
    }
    this.emitters.set(id, acc);
  }

  update(dt) {
    for (const p of this.drops) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - 2.5 * dt; p.vz *= 1 - 2.5 * dt; p.vy -= 4 * dt;
      p.size += dt * 2.2;
      p.s.material.opacity = 0.55 * Math.min(1, p.life / p.max * 2);
      p.s.position.set(p.x, Math.max(0.2, p.y), p.z);
      p.s.scale.set(p.size * 1.6, p.size, 1);
    }
  }

  clear() {
    for (const p of this.drops) { p.life = 0; p.s.visible = false; }
    this.emitters.clear();
  }
}
