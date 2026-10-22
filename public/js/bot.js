// ============================================================
//  CPU driver: follows the centreline with a wandering racing line,
//  brakes for corners, and makes pit stops when its tyres are worn.
// ============================================================
import { PHYS, PIT, TYRES } from './config.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class BotDriver {
  constructor(kart, track, rand, boxIndex) {
    this.k = kart;
    this.t = track;
    this.rand = rand;
    this.lane = (rand() - 0.5) * 6;
    this.laneTarget = this.lane;
    this.laneTimer = 0;
    this.pace = 0.86 + rand() * 0.1;
    this.box = boxIndex % PIT.BOXES.length;
    this.mode = 'race';
    this.stuckT = 0;
    this.serviceDelay = 0;
  }

  /** returns {throttle, brake, steer}. wet = track wetness 0..1 */
  input(dt, remaining, active, wet = 0) {
    const k = this.k, t = this.t, q = k.q;
    if (!q) return { throttle: 1, brake: 0, steer: 0 };
    const speed = k.vf;

    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTarget = (this.rand() - 0.5) * 7;
      this.laneTimer = 3 + this.rand() * 5;
    }
    this.lane += (this.laneTarget - this.lane) * Math.min(1, dt * 0.6);

    // ---- pit decisions: worn tyres, or the wrong tyres for the weather (after a while)
    const onWets = !!TYRES[k.tyreType].wet;
    const wrongTyres = (wet > 0.45 && !onWets) || (wet < 0.15 && onWets);
    this.wrongT = wrongTyres ? (this.wrongT || 0) + dt : 0;
    const wantPit = k.tyre < 22 || this.wrongT > 6;
    if (this.mode === 'race' && wantPit && remaining > 30 && q.u > -480 && q.u < -170) this.mode = 'pitIn';
    if (k.pit.state === 'menu' && this.mode === 'pitIn') {
      this.serviceDelay += dt;
      if (this.serviceDelay > 0.4) {
        const choice = wet > 0.35 ? 'W' : remaining > 420 ? 'H' : remaining > 200 ? 'M' : 'S';
        k.startPitWork(choice);
        this.mode = 'service';
        this.serviceDelay = 0;
      }
    }
    if (this.mode === 'service' && k.pit.state === 'done') this.mode = 'pitOut';
    if (this.mode === 'pitOut' && (q.u > PIT.U1 - 3 || (k.surface !== 'pit' && q.u > PIT.U1 - PIT.RAMP))) this.mode = 'race';

    let targetD = this.lane;
    const look = 7 + Math.abs(speed) * 0.45;
    let speedCap = Infinity;
    if (this.mode !== 'race') {
      const dp = t.pitCenter(q.u + look);
      if (dp !== null) targetD = dp;
      else if (this.mode === 'pitIn') targetD = PIT.START_D;
    }
    if (this.mode === 'pitIn' && q.u > PIT.U0 && q.u < PIT.U1) {
      let rem = PIT.BOXES[this.box] - q.u;
      if (rem < -1.0 && k.pit.state !== 'menu') {
        // overshot the box: aim for the next free one ahead, or give up this lap
        const next = PIT.BOXES.findIndex(u => u - q.u > 3);
        if (next >= 0) { this.box = next; rem = PIT.BOXES[next] - q.u; } else this.mode = 'pitOut';
      }
      if (this.mode === 'pitIn') {
        if (rem < 30) targetD = PIT.LANE_D;
        speedCap = Math.min(PIT.LIMIT - 0.3, Math.sqrt(2 * 6 * Math.max(0, rem - 0.2)));
      }
    }
    if (this.mode === 'service') speedCap = 0;

    // ---- steering toward a look-ahead point
    const target = t.pointAt(q.dist + look, targetD);
    const desired = Math.atan2(-(target.x - k.x), -(target.z - k.z));
    const diff = wrapAngle(desired - k.heading);
    const steer = Math.max(-1, Math.min(1, -diff * 2.6));

    // ---- corner speed
    const T = TYRES[k.tyreType];
    const cond = Math.max(0, k.tyre) / 100;
    let grip = T.grip * (k.tyre <= 0 ? 0.42 : 0.62 + 0.38 * cond);
    grip *= T.wet ? 1 - PHYS.WET_DRY_GRIP * (1 - wet) : 1 - PHYS.WET_SLICK_GRIP * wet;
    const curv = t.curvatureAhead(q.i, 12 + Math.max(0, speed) * 1.4);
    const cornerV = curv > 1e-4 ? Math.sqrt((PHYS.LAT_ACC * grip * this.pace) / curv) : Infinity;
    const vt = Math.min(speedCap, cornerV);

    let throttle = 1, brake = 0;
    if (speed > vt + 1.2) { throttle = 0; brake = 1; }
    else if (speed > vt) throttle = 0;
    if (vt <= 0.05 && speed < 0.6) { throttle = 0; brake = 0; }

    // ---- stuck recovery
    if (active && this.mode !== 'service' && k.pit.state !== 'menu' && Math.abs(speed) < 1.5 && k.freezeT <= 0) {
      this.stuckT += dt;
      if (this.stuckT > 2.5) { k.respawn(); this.stuckT = 0; }
    } else {
      this.stuckT = 0;
    }
    return { throttle, brake, steer };
  }
}
