// ============================================================
//  Race weather. The server sends a schedule of rain / fog events
//  ([{type, start, end}] in seconds from the green light); every client
//  derives the same intensities and track wetness from the race clock.
// ============================================================

const FADE = 15;          // seconds for a shower / fog bank to build up and clear
const SOAK_RATE = 0.05;   // wetness per second in full rain (soaked after ~20 s)
const DRY_RATE = 0.014;   // wetness lost per second without rain (~70 s to dry)
const STEP = 0.5;         // fixed integration step, so every client gets the same number

function intensity(ev, t) {
  if (t <= ev.start || t >= ev.end) return 0;
  return Math.min(1, (t - ev.start) / FADE, (ev.end - t) / FADE);
}

export class Weather {
  constructor(schedule = []) {
    this.events = Array.isArray(schedule) ? schedule.filter(e => e && (e.type === 'rain' || e.type === 'fog')) : [];
    this.rain = 0;
    this.fog = 0;
    this.wet = 0;
    this._t = 0;          // wetness integrated up to this race time
    this._wet = 0;
  }

  get enabled() { return this.events.length > 0; }

  _level(type, t) {
    let v = 0;
    for (const e of this.events) if (e.type === type) v = Math.max(v, intensity(e, t));
    return v;
  }

  /** advance to race time t (seconds since the start; negative = grid) */
  update(t) {
    const tc = Math.max(0, t);
    if (tc < this._t) { this._t = 0; this._wet = 0; }
    while (this._t + STEP <= tc) {
      const r = this._level('rain', this._t + STEP / 2);
      this._wet = r > 0
        ? Math.min(1, this._wet + SOAK_RATE * r * STEP)
        : Math.max(0, this._wet - DRY_RATE * STEP);
      this._t += STEP;
    }
    this.rain = this._level('rain', tc);
    this.fog = this._level('fog', tc);
    this.wet = this._wet;
  }

  /** the next event that has not started yet: {type, in: seconds} */
  upcoming(t) {
    let best = null;
    for (const e of this.events) {
      if (e.start > t && (!best || e.start < best.start)) best = e;
    }
    return best ? { type: best.type, in: best.start - t } : null;
  }

  /** short label for the HUD badge */
  state() {
    if (this.rain > 0.05) return 'rain';
    if (this.fog > 0.05) return 'fog';
    return this.wet > 0.05 ? 'wet' : 'sun';
  }
}
