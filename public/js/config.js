// ============================================================
//  Game constants (shared by every client module)
// ============================================================

// Internal render resolution (upscaled with image-rendering: pixelated)
export const RENDER_W = 480;
export const RENDER_H = 270;
export const HUD_W = 960;
export const HUD_H = 540;
export const MIRROR = { x: 180, y: 6, w: 120, h: 30 }; // in RENDER pixels (top-left origin)

export const EYE_H = 1.0;          // driver eye height
export const PHYS_STEP = 1 / 120;  // fixed physics step
export const NET_RATE = 1 / 20;    // client -> server state rate

// Course layouts live in courses.js (all share the home straight through (0,0)).

export const ROAD_HALF = 7;      // asphalt half width
export const CURB_W = 1.2;
export const BARRIER = 11.5;     // barrier lateral offset (grass run-off between)
export const KART_R = 1.0;

// Pit lane: left side (negative lateral offset) of the home straight.
// u = signed distance from the start line along the track.
export const PIT = {
  U0: -140, U1: 150, RAMP: 50,
  START_D: -5.5,       // lane centre at both ends (merges with the road)
  LANE_D: -16.5,       // lane centre on the main pit section
  HALF: 4,             // lane half width
  LIMIT: 60 / 3.6,     // pit speed limiter (m/s)
  LIMIT_QUICK: 85 / 3.6, // limiter for the Quick Pit skill
  BOXES: [-50, -30, -10, 10, 30, 50],
  BOX_LEN: 8,
  PERFECT: 0.5,        // |error| <= this -> fastest change
  TIME_MIN: 2.0,
  TIME_MAX: 5.0,
};

// Dirt shortcut half width (positions are per course)
export const DIRT_HALF = 4.5;

// ---------------- Physics ----------------
export const PHYS = {
  MAX_SPEED: 30,        // m/s  (≈108 km/h)
  ACCEL: 12,
  BRAKE: 26,
  COAST: 3,
  REV_MAX: 8,
  REV_ACCEL: 9,
  TURN_RATE: 2.0,       // rad/s max yaw
  TURN_FULL_SPEED: 7,   // speed at which full yaw authority is reached
  LAT_ACC: 18,          // m/s^2 cornering limit (fresh medium)
  LAT_GRIP: 7,          // how quickly velocity follows heading
  GRAVITY: 22,
  JUMP_V: 13.5,
  SURF: {
    grass: { speed: 0.55, wear: 1.5, grip: 0.8 },
    dirt: { speed: 0.45, wear: 3.0, grip: 0.7 },
  },
  DASH: { amt: 0.45, dur: 1.4, accel: 2.2, kick: 5 },
  NITRO: { amt: 0.6, dur: 3.0, accel: 2.8, kick: 4, cost: 8 },
  // Quick Pit: change time x0.4, 85 km/h pit limiter, 4 s dash when rejoining
  QUICKPIT: { amt: 0.5, dur: 4.0, accel: 2.4, kick: 4 },
  QUICKPIT_TIME_MUL: 0.4,
  // Aero Jump: boosted flight + mini dash on landing
  AERO: { amt: 0.25, dur: 1.3, accel: 1.5, kick: 3 },
  AERO_LAND: { amt: 0.3, dur: 1.0, accel: 2.0, kick: 3 },
  // Smoke Screen: longer/denser cloud, small boost for the user, victims lose speed while inside
  SMOKE_EMIT: 2.5,
  SMOKE_SELF: { amt: 0.2, dur: 1.5, accel: 1.6, kick: 2 },
  SMOKE_SLOW: 0.85,
  SLIP: { range: 16, lat: 2.4, bonus: 0.1, charge: 1.0, wear: 0.7 },
  SPURT_TIME: 30, SPURT_MUL: 1.1,
  // Overclock: x1.2 from the last 90 s, and no tyre wear while overclocked
  OVERCLOCK_TIME: 90, OVERCLOCK_MUL: 1.2,
  HIGHROLLER_MUL: 1.12, HIGHROLLER_WEAR: 1.25,

  // ---- automatic transmission: 6 speeds. gear top speed = nominal top speed x ratio
  GEARS: [0.27, 0.43, 0.58, 0.72, 0.86, 1.0],
  GEAR_ACC: [1.62, 1.46, 1.31, 1.18, 1.07, 0.98], // torque multiplier per gear
  RPM_IDLE: 2000, RPM_RED: 12000,
  SHIFT_TIME: 0.15,                                // power cut while shifting
  AT_UP: 0.96, AT_DOWN: 0.66,                      // shift points (fraction of gear top)
};

// ---------------- Tyres ----------------
// life = seconds of flat-out driving to go from 100% to 0% (load ≈ 1.0)
export const TYRES = {
  S: { id: 'S', name: 'ソフト', en: 'SOFT', color: '#ff3b3b', hex: 0xff3b3b, speed: 1.09, grip: 1.26, life: 200, lifeText: '約3〜4分' },
  M: { id: 'M', name: 'ミディアム', en: 'MEDIUM', color: '#ffd23b', hex: 0xffd23b, speed: 1.03, grip: 1.07, life: 400, lifeText: '約6〜8分' },
  H: { id: 'H', name: 'ハード', en: 'HARD', color: '#f4f4f4', hex: 0xf4f4f4, speed: 0.95, grip: 0.88, life: 700, lifeText: '10分以上' },
};
export const TYRE_ORDER = ['S', 'M', 'H'];

// ---------------- Skills ----------------
export const SKILLS = [
  { id: 'meister', name: 'タイヤマイスター', en: 'TYRE MEISTER', type: 'passive', desc: 'すべてのタイヤの摩耗速度が30%軽減される。' },
  { id: 'junkie', name: 'ダッシュジャンキー', en: 'DASH JUNKIE', type: 'passive', desc: 'ダッシュ板を踏んだ際の加速倍率と持続時間が1.5倍になる。' },
  { id: 'offroader', name: 'オフローダー', en: 'OFF-ROADER', type: 'passive', desc: 'コース外の芝生やダートを走っても減速せず、タイヤの追加摩耗も発生しない。' },
  { id: 'sliphunter', name: 'スリップハンター', en: 'SLIP HUNTER', type: 'passive', desc: 'スリップストリームの有効距離と加速効果が2倍になる。' },
  { id: 'quickpit', name: 'クイックピット', en: 'QUICK PIT', type: 'passive', desc: 'タイヤ交換時間が60%短縮、ピット制限速度が85km/hに。ピットアウト時に4秒間ダッシュ加速。' },
  { id: 'nitro', name: 'ニトロブースト', en: 'NITRO BOOST', type: 'active', cd: 30, desc: 'タイヤ残量を8%消費する代わりに、3秒間爆発的に加速する。' },
  { id: 'smoke', name: 'スモークスクリーン', en: 'SMOKE SCREEN', type: 'active', cd: 18, desc: '加速しながら後方に濃い煙幕を張る。煙に入ったライバルは視界が5秒間悪化し、煙の中では減速する。' },
  { id: 'aerojump', name: 'エアロジャンプ', en: 'AERO JUMP', type: 'active', cd: 10, desc: '加速しながら高くジャンプし、前方のカートやダートを飛び越える。着地時にミニダッシュ。' },
  { id: 'overclock', name: 'オーバークロック', en: 'OVERCLOCK', type: 'passive', desc: 'ラスト30秒の1.1倍加速が、自分だけ「ラスト90秒から1.2倍」に強化。その間タイヤが減らない。' },
  { id: 'highroller', name: 'ハイローラー', en: 'HIGH ROLLER', type: 'passive', desc: '常時、最高速度と加速が12%高い。ただしタイヤの摩耗速度が1.25倍になる。' },
];
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

// ---------------- Players ----------------
export const KART_COLORS = ['#e83b3b', '#3b6ee8', '#2fbf4f', '#e8c43b', '#a050e8', '#ef7f2a', '#30c8d8', '#e84aa8'];

export const SMOKE_VISION_TIME = 5;
