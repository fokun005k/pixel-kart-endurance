// ============================================================
//  Kart simulation: arcade physics, tyre wear, slipstream,
//  dash panels, skills, pit stop logic and lap tracking.
//  Used by the local player and by host-simulated CPU karts.
// ============================================================
import { PHYS, TYRES, SKILL_BY_ID, PIT, KART_R, CAR_R, ROAD_HALF } from './config.js';

export class Kart {
  constructor(track, { id, skill = 'meister', tyreType = 'M' } = {}) {
    this.track = track;
    this.id = id;
    this.skill = skill;
    this.tyreType = tyreType;
    this.tyre = 100;

    // automatic transmission
    this.gear = 1;
    this.shiftT = 0;        // power cut while a shift is in progress
    this.rpm = 0;           // 0..~1.05 fraction of the rev range
    this.nominalTop = PHYS.MAX_SPEED;

    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.heading = 0;
    this.steer = 0;
    this.vf = 0;           // forward speed (signed)
    this.yawRate = 0;
    this.airborne = false;
    this.skid = 0;

    this.boostT = 0; this.boostAmt = 0; this.boostAccel = 1;
    this.slip = 0; this.inSlip = false;
    this.skillCd = 0;
    this.jamT = 0;         // skill disabled by a rival's Skill Jammer
    this.smokeT = 0;
    this.smokeSlowT = 0;   // inside someone else's smoke screen
    this.junkieT = 0;      // Dash Junkie: grip bonus while a dash-panel boost lasts
    this.aeroLand = false; // pending Aero Jump landing dash
    this.freezeT = 0;
    this.onDash = -1;

    this.lap = 0; this.maxLap = 0; this.prevS = null; this.totalDist = 0;
    this.lapStart = 0; this.lastLap = 0; this.bestLap = 0;

    this.q = null;
    this.surface = 'road';
    this.limiter = false;
    this.pit = { state: 'none', box: -1, err: 0, workT: 0, workTotal: 0, choice: null, quality: '' };
    this.quickPitPending = false;
    this.wasBurst = false;
    this.events = [];
  }

  get def() { return SKILL_BY_ID[this.skill]; }
  get speed() { return Math.hypot(this.vx, this.vz); }
  /** the skill that is actually working right now ('none' while jammed) */
  get effSkill() { return this.jamT > 0 ? 'none' : this.skill; }

  /** a rival's Skill Jammer hit this kart */
  jam(sec) {
    if (this.skill === 'none') return;
    this.jamT = Math.max(this.jamT, sec);
    this.smokeT = 0;   // cut an ongoing smoke screen
    this.events.push({ type: 'jammed', sec });
  }

  placeAt(dist, d) {
    const p = this.track.pointAt(dist, d);
    this.x = p.x; this.z = p.z; this.y = 0;
    this.heading = p.heading;
    this.vx = this.vz = this.vy = 0;
    this.vf = 0;
    this.airborne = false;
    this.q = this.track.project(this.x, this.z);
    const s = this.q.dist / this.track.length;
    this.prevS = s;
    this.lap = s > 0.5 ? -1 : 0;
    this.maxLap = this.lap;
    this.totalDist = this.lap + s;
  }

  respawn() {
    const q = this.q || this.track.project(this.x, this.z);
    if (!q) return;
    const p = this.track.pointAt(q.dist, Math.max(-4, Math.min(4, q.d)));
    this.x = p.x; this.z = p.z; this.y = 0;
    this.heading = p.heading;
    this.vx = this.vz = this.vy = 0;
    this.vf = 0;
    this.airborne = false;
    this.freezeT = 1.0;
    this.gear = 1;
    this.events.push({ type: 'respawn' });
  }

  // ------------------------------------------------------------------
  //  Automatic transmission (gear & revs are shown on the HUD)
  // ------------------------------------------------------------------
  gearTop(g = this.gear) { return this.nominalTop * PHYS.GEARS[g - 1]; }

  /** current engine speed in rpm (for the tachometer / sound) */
  get rpmValue() { return PHYS.RPM_IDLE + Math.max(0, this.rpm) * (PHYS.RPM_RED - PHYS.RPM_IDLE); }

  _setGear(g, dir) {
    this.gear = g;
    this.shiftT = PHYS.SHIFT_TIME;
    this.events.push({ type: 'shift', gear: g, dir });
  }

  /** start a speed boost; m = optional multipliers {amt, dur, kick} */
  applyBoost(cfg, m = {}) {
    const amt = cfg.amt * (m.amt || 1);
    this.boostAmt = this.boostT > 0 ? Math.max(this.boostAmt, amt) : amt;
    this.boostT = Math.max(this.boostT, cfg.dur * (m.dur || 1));
    this.boostAccel = cfg.accel;
    const kick = cfg.kick * (m.kick || 1);
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    this.vx += fx * kick;
    this.vz += fz * kick;
  }

  /**
   * Try to use the active skill. Returns the skill id when it fired.
   * `target` is needed for the Skill Jammer (the rival ahead, found by the caller).
   */
  activateSkill(raceActive, target = null) {
    const def = this.def;
    if (!def || def.type !== 'active' || this.skillCd > 0 || !raceActive) return null;
    if (this.pit.state === 'work' || this.freezeT > 0 || this.jamT > 0) return null;
    switch (this.skill) {
      case 'jammer':
        if (!target) return null;   // nobody ahead in range: keep the charge
        break;
      case 'nitro':
        this.tyre = Math.max(0, this.tyre - PHYS.NITRO.cost);
        this.applyBoost(PHYS.NITRO);
        break;
      case 'smoke':
        this.smokeT = PHYS.SMOKE_EMIT;
        this.applyBoost(PHYS.SMOKE_SELF);
        break;
      case 'aerojump':
        if (this.airborne) return null;
        this.airborne = true;
        this.vy = PHYS.JUMP_V;
        this.y = 0.01;
        this.aeroLand = true;
        this.applyBoost(PHYS.AERO);
        break;
      default:
        return null;
    }
    this.skillCd = def.cd;
    return this.skill;
  }

  /** Tyre change duration for a stop that is `err` metres off the box centre. */
  pitTimeFor(err) {
    let t = err <= PIT.PERFECT
      ? PIT.TIME_MIN
      : PIT.TIME_MIN + Math.min(1, (err - PIT.PERFECT) / (PIT.BOX_LEN / 2 - PIT.PERFECT)) * (PIT.TIME_MAX - PIT.TIME_MIN);
    if (this.effSkill === 'quickpit') t *= PHYS.QUICKPIT_TIME_MUL;
    return t;
  }

  /** Called when stopped in a box and the player picked a compound. */
  startPitWork(type) {
    if (this.pit.state !== 'menu' || !TYRES[type]) return false;
    const err = this.pit.err;
    const t = this.pitTimeFor(err);
    this.pit.choice = type;
    this.pit.workT = this.pit.workTotal = t;
    this.pit.quality = err <= PIT.PERFECT ? 'PERFECT' : err <= 1.5 ? 'GOOD' : 'OK';
    this.pit.state = 'work';
    this.events.push({ type: 'pitStart', quality: this.pit.quality, time: t });
    return true;
  }

  netState() {
    return {
      x: +this.x.toFixed(2), y: +this.y.toFixed(2), z: +this.z.toFixed(2),
      h: +this.heading.toFixed(3), v: +this.vf.toFixed(2), st: +this.steer.toFixed(2),
      d: +this.totalDist.toFixed(5), lap: this.lap, tt: this.tyreType, tw: +this.tyre.toFixed(1),
      b: this.boostT > 0 ? 1 : 0, p: this.pit.state === 'work' ? 1 : 0, bl: +this.bestLap.toFixed(3), ll: +this.lastLap.toFixed(3),
    };
  }

  // ------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {{throttle:number, brake:number, steer:number}} inp
   * @param {{others:Array, spurtMul:number, active:boolean, raceTime:number, noWear?:boolean, wet?:number}} env
   */
  step(dt, inp, env) {
    const T = TYRES[this.tyreType];
    if (this.jamT > 0) {
      this.jamT -= dt;
      if (this.jamT <= 0) this.events.push({ type: 'unjammed' });
    }
    const sk = this.effSkill;
    const track = this.track;
    const wet = env.wet || 0;

    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - dt);
    if (this.freezeT > 0) this.freezeT -= dt;
    if (this.smokeT > 0) this.smokeT -= dt;
    if (this.smokeSlowT > 0) this.smokeSlowT -= dt;
    if (this.junkieT > 0) this.junkieT -= dt;

    const working = this.pit.state === 'work';
    const locked = working || this.freezeT > 0 || !env.active;

    const q0 = this.q || track.project(this.x, this.z);
    const surf = this.airborne ? 'air' : track.surfaceAt(this.x, this.z, q0);
    this.surface = surf;
    this.limiter = !this.airborne && track.inLimiter(q0, surf);

    // ---- tyre condition -> performance
    const cond = Math.max(0, this.tyre) / 100;
    const burst = this.tyre <= 0;
    let grip = T.grip * (burst ? 0.42 : 0.62 + 0.38 * cond);
    let topF = T.speed * (burst ? 0.45 : 0.9 + 0.1 * cond);
    // wet track: slicks lose grip; wet tyres are the right choice (but overheat when it's dry)
    if (T.wet) grip *= 1 - PHYS.WET_DRY_GRIP * (1 - wet);
    else { grip *= 1 - PHYS.WET_SLICK_GRIP * wet; topF *= 1 - PHYS.WET_SLICK_SPEED * wet; }
    let accF = burst ? 0.55 : 1;
    if (sk === 'highroller') { topF *= PHYS.HIGHROLLER_MUL; accF *= PHYS.HIGHROLLER_MUL; }
    const overclocked = sk === 'overclock' && env.spurtMul > 1;
    if (overclocked) grip *= PHYS.OVERCLOCK_GRIP;
    if (sk === 'junkie' && this.junkieT > 0) grip *= PHYS.JUNKIE_GRIP;
    topF *= env.spurtMul;
    accF *= env.spurtMul;

    let surfSpeed = 1, surfWear = 1, surfGrip = 1;
    const S = PHYS.SURF[surf];
    if (S) {
      if (sk !== 'offroader' || surf === 'water') {
        surfSpeed = S.speed; surfWear = S.wear; surfGrip = S.grip;
      } else if (surf === 'rocks') {
        surfSpeed = PHYS.OFFROAD_ROCKS;
      }
    } else if (surf === 'road' || surf === 'curb' || surf === 'pit') {
      surfGrip = track.roadGrip;   // gravel / snow / sand stages
    }

    // ---- slipstream
    this._updateSlip(dt, env.others);
    const slipBonus = this.slip * PHYS.SLIP.bonus * (sk === 'sliphunter' ? PHYS.SLIP_HUNTER.bonus : 1);

    // ---- boost
    if (this.boostT > 0) this.boostT -= dt;
    const boosting = this.boostT > 0;
    const boostMul = boosting ? 1 + this.boostAmt : 1;

    // nominal top speed; gear ratios are based on it
    this.nominalTop = PHYS.MAX_SPEED * topF;
    let vmax = this.nominalTop * surfSpeed * (1 + slipBonus) * boostMul;
    if (this.smokeSlowT > 0) vmax *= PHYS.SMOKE_SLOW;
    if (this.limiter) vmax = Math.min(vmax, sk === 'quickpit' ? PIT.LIMIT_QUICK : PIT.LIMIT);

    // ---- local frame
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const fx = -sh, fz = -ch, rx = ch, rz = -sh;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;

    const throttle = locked ? 0 : inp.throttle;
    const brake = locked ? 0 : inp.brake;
    const steerIn = locked ? 0 : inp.steer;
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 9);

    // ---- transmission
    const nG = PHYS.GEARS.length;
    if (this.shiftT > 0) this.shiftT -= dt;
    if (this.shiftT <= 0 && !this.airborne) {
      const r = vf / this.gearTop();
      if (this.gear < nG && (r >= 1 || (r >= PHYS.AT_UP && throttle > 0))) this._setGear(this.gear + 1, 1);
      else if (this.gear > 1 && vf < this.gearTop(this.gear - 1) * PHYS.AT_DOWN) {
        let g = 1;
        while (g < nG && vf >= this.gearTop(g) * PHYS.AT_UP) g++;
        this._setGear(Math.min(g, this.gear - 1), -1);
      }
    }
    const gTop = this.gearTop();
    const topGear = this.gear === nG;
    const revR = Math.max(0, vf) / gTop;
    let gearDrive = 0;
    if (this.shiftT <= 0 && (topGear || revR < 1)) {
      // torque rises with revs; lower gears multiply it
      gearDrive = PHYS.GEAR_ACC[this.gear - 1] * (0.62 + 0.48 * Math.min(1, revR));
    }
    const accel = PHYS.ACCEL * gearDrive * accF * (1 + slipBonus * 2) * (boosting ? this.boostAccel : 1);

    if (!this.airborne) {
      if (throttle > 0 && vf < vmax) {
        const t = Math.max(0, vf) / vmax;
        vf = Math.min(vmax, vf + accel * throttle * (1 - 0.6 * t * t) * dt);
      }
      // rev limiter / engine braking above the current gear's top speed
      if (!topGear && vf > gTop) vf = Math.max(gTop, vf - (vf - gTop) * 1.5 * dt);
      if (brake > 0) {
        if (vf > 0.3) vf = Math.max(0, vf - PHYS.BRAKE * dt);
        else vf = Math.max(-PHYS.REV_MAX, vf - PHYS.REV_ACCEL * dt);
      }
      if (throttle === 0 && brake === 0) {
        const c = PHYS.COAST * dt;
        vf = Math.abs(vf) <= c ? 0 : vf - Math.sign(vf) * c;
      }
      if (vf > vmax) vf = Math.max(vmax, vf - Math.max(5, (vf - vmax) * 2.5) * dt);
      if (locked && working) { vf = 0; vr = 0; }
      if (this.pit.state === 'menu' && throttle === 0) { vf *= 0.8; vr *= 0.8; }

      // lateral grip: velocity follows heading; worn tyres -> slides wide
      vr *= Math.exp(-PHYS.LAT_GRIP * grip * surfGrip * dt);

      // steering, limited by available grip (understeer when worn)
      const sp = Math.abs(vf);
      const low = Math.min(1, sp / PHYS.TURN_FULL_SPEED);
      const gripYaw = (PHYS.LAT_ACC * grip * surfGrip) / Math.max(sp, 1);
      const want = PHYS.TURN_RATE * low;
      const yaw = Math.min(want, gripYaw);
      this.yawRate = this.steer * yaw * (vf < -0.1 ? -1 : 1);
      this.heading -= this.yawRate * dt;

      let skid = Math.max(0, (Math.abs(vr) - 1.5) / 5);
      if (Math.abs(this.steer) * want > gripYaw * 1.05 && sp > 12) skid = Math.max(skid, 0.45 * Math.abs(this.steer));
      this.skid = Math.min(1, skid);
    } else {
      this.heading -= this.steer * 0.7 * dt;
      vf *= 1 - 0.05 * dt;
      this.yawRate = 0;
      this.skid = 0;
    }
    this.vf = vf;

    // ---- engine revs (tachometer / engine sound)
    let rTarget;
    if (locked && !working) rTarget = inp.throttle ? 0.72 : 0.04;            // revving on the grid
    else rTarget = Math.min(1.05, Math.abs(vf) / this.gearTop()) * (inp.throttle || Math.abs(vf) > 1 ? 1 : 0.5);
    if (this.shiftT > 0) rTarget *= 0.8;
    this.rpm += (rTarget - this.rpm) * Math.min(1, dt * 14);
    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;

    // ---- vertical (aero jump)
    if (this.airborne) {
      this.vy -= PHYS.GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0; this.airborne = false;
        this.events.push({ type: 'land' });
        if (this.aeroLand) {
          // Aero Jump: mini dash on touchdown
          this.aeroLand = false;
          this.applyBoost(PHYS.AERO_LAND);
          this.events.push({ type: 'landBoost' });
        }
      }
    }

    // ---- integrate + collisions
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (!this.airborne || this.y < 1.0) {
      for (const o of env.others) {
        if (o === this || (o.y || 0) > 1.0) continue;
        const dx = nx - o.x, dz = nz - o.z;
        const d2 = dx * dx + dz * dz;
        const min = (track.carMode ? CAR_R : KART_R) * 2.1;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), ux = dx / d, uz = dz / d;
          const push = (min - d) * 0.6;
          nx += ux * push; nz += uz * push;
          const rel = (this.vx - (o.vx || 0)) * ux + (this.vz - (o.vz || 0)) * uz;
          if (rel < 0) {
            this.vx -= ux * rel * 0.75; this.vz -= uz * rel * 0.75;
            if (-rel > 3) this.events.push({ type: 'bump', power: -rel });
          }
        }
      }
    }
    let m = track.depth(nx, nz);
    if (m < KART_R) {
      for (let it = 0; it < 3 && m < KART_R; it++) {
        const e = 0.25;
        const gx = track.depth(nx + e, nz) - track.depth(nx - e, nz);
        const gz = track.depth(nx, nz + e) - track.depth(nx, nz - e);
        const gl = Math.hypot(gx, gz);
        if (gl < 1e-6) break;
        const ux = gx / gl, uz = gz / gl;
        nx += ux * (KART_R - m + 0.01);
        nz += uz * (KART_R - m + 0.01);
        const vn = this.vx * ux + this.vz * uz;
        if (vn < 0) {
          this.vx -= ux * vn * 1.2;
          this.vz -= uz * vn * 1.2;
          this.vx *= 0.94; this.vz *= 0.94;
          if (-vn > 4) this.events.push({ type: 'bump', power: -vn });
        }
        m = track.depth(nx, nz);
      }
      if (m < KART_R - 0.5 && track.depth(this.x, this.z) >= KART_R - 0.5) { nx = this.x; nz = this.z; }
    }
    this.x = nx; this.z = nz;

    // ---- progress / laps
    const q = track.project(this.x, this.z);
    if (q) {
      this.q = q;
      const s = q.dist / track.length;
      if (this.prevS !== null) {
        if (this.prevS > 0.75 && s < 0.25) this._crossLine(env);
        else if (this.prevS < 0.25 && s > 0.75) this.lap -= 1;
      }
      this.prevS = s;
      this.totalDist = this.lap + s;
    }

    // ---- dash panels
    if (!this.airborne && q) {
      const di = track.dashAt(q);
      if (di >= 0 && di !== this.onDash && env.active) {
        this.applyBoost(PHYS.DASH, sk === 'junkie' ? PHYS.JUNKIE : {});
        if (sk === 'junkie') this.junkieT = PHYS.DASH.dur * PHYS.JUNKIE.dur;
        this.events.push({ type: 'dash' });
      }
      this.onDash = di;
    } else {
      this.onDash = -1;
    }

    // ---- tyre wear
    if (env.active && !env.noWear && !this.airborne && !working && !overclocked) {
      const sp = Math.abs(vf);
      if (sp > 0.5) {
        const load = 0.25 + 0.75 * Math.min(1.2, sp / PHYS.MAX_SPEED);
        const lat = Math.abs(this.yawRate) * sp / PHYS.LAT_ACC;
        const corner = 1 + 0.7 * Math.min(1.5, lat) + this.skid * 0.8;
        let mul = surfWear;
        if (sk === 'meister') mul *= PHYS.MEISTER_WEAR;
        if (sk === 'highroller') mul *= PHYS.HIGHROLLER_WEAR;
        if (this.slip > 0.3) mul *= sk === 'sliphunter' ? PHYS.SLIP_HUNTER.wear : PHYS.SLIP.wear;
        if (T.wet) mul *= 1 + PHYS.WET_DRY_WEAR * (1 - wet);   // wets overheat on a dry track
        this.tyre = Math.max(0, this.tyre - (100 / T.life) * load * corner * mul * dt);
      }
    }
    if (this.tyre <= 0 && !this.wasBurst) {
      this.wasBurst = true;
      this.events.push({ type: 'burst' });
    }

    this._updatePit(dt, inp, env, q);
  }

  _crossLine(env) {
    this.lap += 1;
    if (this.lap > this.maxLap) {
      this.maxLap = this.lap;
      if (this.lap >= 1 && env.active) {
        const t = env.raceTime - this.lapStart;
        this.lastLap = t;
        if (!this.bestLap || t < this.bestLap) this.bestLap = t;
        this.events.push({ type: 'lap', lap: this.lap, time: t });
      }
      this.lapStart = env.raceTime;
    }
  }

  _updateSlip(dt, others) {
    const S = PHYS.SLIP, H = PHYS.SLIP_HUNTER;
    const hunter = this.effSkill === 'sliphunter';
    const range = S.range * (hunter ? H.range : 1);
    const lat = S.lat * (hunter ? H.lat : 1);
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const fx = -sh, fz = -ch, rx = ch, rz = -sh;
    let found = false;
    if (!this.airborne && this.vf > 10) {
      for (const o of others) {
        if (o === this) continue;
        const dx = o.x - this.x, dz = o.z - this.z;
        const along = dx * fx + dz * fz;
        if (along < 2.5 || along > range) continue;
        if (Math.abs(dx * rx + dz * rz) > lat) continue;
        found = true;
        break;
      }
    }
    this.inSlip = found;
    const charge = S.charge * (hunter ? H.charge : 1);
    const decay = hunter ? H.decay : S.decay;
    this.slip = found ? Math.min(1, this.slip + dt / charge) : Math.max(0, this.slip - dt * decay);
  }

  _updatePit(dt, inp, env, q) {
    const p = this.pit;
    if (p.state === 'work') {
      this.vx = this.vz = 0;
      p.workT -= dt;
      if (p.workT <= 0) {
        this.tyreType = p.choice;
        this.tyre = 100;
        this.wasBurst = false;
        p.state = 'done';
        if (this.effSkill === 'quickpit') this.quickPitPending = true;
        this.events.push({ type: 'pitDone', tyre: p.choice });
      }
      return;
    }
    const box = this.track.pitBoxAt(q);
    const speed = Math.hypot(this.vx, this.vz);
    if (p.state === 'none') {
      if (box && speed < 0.35 && inp.throttle === 0 && env.active && !this.airborne) {
        p.state = 'menu';
        p.box = box.index;
        p.err = box.err;
        this.vx = this.vz = 0;
        this.events.push({ type: 'pitMenu', box: box.index, err: box.err });
      }
    } else if (p.state === 'menu') {
      if (!box || speed > 0.8 || inp.throttle > 0) {
        p.state = 'declined';
        this.events.push({ type: 'pitMenuClose' });
      }
    } else if (!box) {
      p.state = 'none';
    }
    // Quick Pit: dash boost when rejoining the circuit
    if (this.quickPitPending && q && this.surface !== 'pit' && Math.abs(q.d) <= ROAD_HALF + 1) {
      this.quickPitPending = false;
      this.applyBoost(PHYS.QUICKPIT);
      this.events.push({ type: 'quickpitBoost' });
    }
  }
}
