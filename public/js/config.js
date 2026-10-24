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
export const CAR_R = 1.4;        // rally cars are longer: they keep more distance from each other

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
    rocks: { speed: 0.2, wear: 3.0, grip: 0.6 },    // rally corner cuts: only worth it when flying over them (Aero Jump)
    kerb: { speed: 0.8, wear: 1.2, grip: 0.9 },     // city pavement between the road and the walls
    water: { speed: 0.72, wear: 1.0, grip: 0.85 },  // rally water splash (everyone, unless airborne)
  },
  OFFROAD_ROCKS: 0.65,   // Off-roader on rocks: only a small slow-down
  DASH: { amt: 0.45, dur: 1.4, accel: 2.2, kick: 5 },
  // Dash Junkie: dash panels give x1.8 boost, x2 duration, x1.5 kick
  JUNKIE: { amt: 1.8, dur: 2.0, kick: 1.5 },
  JUNKIE_GRIP: 2.0,      // ...and double grip while that dash boost lasts
  NITRO: { amt: 0.6, dur: 3.0, accel: 2.8, kick: 4, cost: 5 },
  // Quick Pit: change time x0.4, 85 km/h pit limiter, 4 s dash when rejoining
  QUICKPIT: { amt: 0.5, dur: 4.0, accel: 2.4, kick: 4 },
  QUICKPIT_TIME_MUL: 0.4,
  // Aero Jump: boosted flight + mini dash on landing
  AERO: { amt: 0.25, dur: 1.3, accel: 1.5, kick: 3 },
  AERO_LAND: { amt: 0.3, dur: 1.0, accel: 2.0, kick: 3 },
  // Smoke Screen: long, dense cloud + a boost for the user; victims lose a lot of speed inside
  SMOKE_EMIT: 3.5,
  SMOKE_SELF: { amt: 0.3, dur: 2.0, accel: 1.8, kick: 3 },
  SMOKE_SLOW: 0.75,      // only while inside the cloud (no after-effect)
  SLIP: { range: 16, lat: 2.4, bonus: 0.1, charge: 1.0, decay: 1.5, wear: 0.7 },
  // Slip Hunter: longer & wider wake, x2.5 bonus, charges twice as fast, lingers after leaving it
  SLIP_HUNTER: { range: 2.5, lat: 1.5, bonus: 2.5, charge: 0.5, decay: 0.4, wear: 0.5 },
  SPURT_TIME: 30, SPURT_MUL: 1.1,
  // Overclock: x1.25 for the last 25% of the race (at least 2 minutes), no tyre wear meanwhile
  OVERCLOCK_FRACTION: 0.25, OVERCLOCK_MIN: 120, OVERCLOCK_MUL: 1.25, OVERCLOCK_GRIP: 1.5,
  HIGHROLLER_MUL: 1.12, HIGHROLLER_WEAR: 1.25,
  MEISTER_WEAR: 0.75,
  // Skill Jammer: silences every rival ahead in the race order (any distance)
  JAMMER: { dur: 10 },

  // ---- weather (wet = how wet the track is, 0..1)
  WET_SLICK_GRIP: 0.42,   // slicks lose up to 42% grip on a soaked track
  WET_SLICK_SPEED: 0.06,
  WET_DRY_GRIP: 0.12,     // wet tyres on a dry track lose 12% grip...
  WET_DRY_WEAR: 2.0,      // ...and wear up to 3x faster

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
  W: { id: 'W', name: 'ウェット', en: 'WET', color: '#3b9cff', hex: 0x3b9cff, speed: 0.95, grip: 1.08, life: 420, wet: true, lifeText: '雨用・晴れだと急速に摩耗' },
};
export const TYRE_ORDER = ['S', 'M', 'H', 'W'];

// ---------------- Skills ----------------
export const SKILLS = [
  { id: 'meister', name: 'タイヤマイスター', en: 'TYRE MEISTER', type: 'passive', desc: 'すべてのタイヤの摩耗速度が25%軽減される。' },
  { id: 'junkie', name: 'ダッシュジャンキー', en: 'DASH JUNKIE', type: 'passive', desc: 'ダッシュ板の加速倍率が1.8倍・持続時間が2倍・踏んだ瞬間の加速も1.5倍。ダッシュ中はグリップも2倍。' },
  { id: 'offroader', name: 'オフローダー', en: 'OFF-ROADER', type: 'passive', desc: 'コース外の芝生やダート・歩道を走っても減速せず、タイヤの追加摩耗も発生しない（ラリーの岩場では少しだけ減速）。' },
  { id: 'sliphunter', name: 'スリップハンター', en: 'SLIP HUNTER', type: 'passive', desc: 'スリップストリームの有効距離2.5倍・加速効果2.5倍。すぐ効き始め、抜けた後もしばらく続く。タイヤ消耗も半減。' },
  { id: 'quickpit', name: 'クイックピット', en: 'QUICK PIT', type: 'passive', desc: 'タイヤ交換時間が60%短縮、ピット制限速度が85km/hに。ピットアウト時に4秒間ダッシュ加速。' },
  { id: 'nitro', name: 'ニトロブースト', en: 'NITRO BOOST', type: 'active', cd: 30, desc: 'タイヤ残量を5%消費する代わりに、3秒間爆発的に加速する。' },
  { id: 'smoke', name: 'スモークスクリーン', en: 'SMOKE SCREEN', type: 'active', cd: 12, desc: '大きく加速しながら後方に濃い煙幕を長く張る。煙の中にいるライバルは視界が悪くなり、25%減速する（煙から出ればすぐ元に戻る）。' },
  { id: 'aerojump', name: 'エアロジャンプ', en: 'AERO JUMP', type: 'active', cd: 10, desc: '加速しながら高くジャンプし、前方のカートやダートを飛び越える。着地時にミニダッシュ。' },
  { id: 'overclock', name: 'オーバークロック', en: 'OVERCLOCK', type: 'passive', desc: 'レース終盤（残り25%・最低2分）から自分だけ1.25倍加速・グリップ1.5倍。その間タイヤが減らない。' },
  { id: 'highroller', name: 'ハイローラー', en: 'HIGH ROLLER', type: 'passive', desc: '常時、最高速度と加速が12%高い。ただしタイヤの摩耗速度が1.25倍になる。' },
  { id: 'jammer', name: 'スキルジャマー', en: 'SKILL JAMMER', type: 'active', cd: 25, desc: '自分より前の順位にいる全員の個性を、距離に関係なく10秒間無効化する。後ろのプレイヤーには効かない。パッシブもアクティブも止まる。' },
];
// used for everyone in "no skills" mode, and while a skill is jammed (never shown in the lobby list)
export const SKILL_NONE = { id: 'none', name: '個性なし', en: 'NO SKILL', type: 'none', desc: '' };
export const SKILL_BY_ID = Object.fromEntries(SKILLS.concat([SKILL_NONE]).map(s => [s.id, s]));

// ---------------- Rally cars (looks only: every car has exactly the same performance) ----------------
// shape (metres): len, cab = cabin length, cabZ = cabin offset toward the rear, cabH / bodyH heights,
// trunk = sedan boot, wing 0..3 (none / roof spoiler / big / huge), scoop = bonnet duct,
// flares = wide wheel arches, pod = rally light pod on the front
export const CARS = [
  { id: 'yaris', name: 'GRヤリス風', en: 'GR YARIS', desc: '3ドアのコンパクトボディにワイドフェンダー',
    shape: { len: 4.0, cab: 1.8, cabZ: 0.25, cabH: 0.58, bodyH: 0.62, trunk: 0, wing: 1, scoop: 0, flares: 1, pod: 1 } },
  { id: 'eg6', name: 'シビック EG6風', en: 'CIVIC EG6', desc: '低くて長いルーフのホットハッチ',
    shape: { len: 4.1, cab: 2.2, cabZ: 0.35, cabH: 0.5, bodyH: 0.56, trunk: 0, wing: 1, scoop: 0, flares: 0, pod: 0 } },
  { id: 'impreza', name: 'インプレッサ風', en: 'IMPREZA', desc: 'ボンネットダクトと大きなリアウイング',
    shape: { len: 4.4, cab: 1.9, cabZ: 0, cabH: 0.56, bodyH: 0.62, trunk: 1, wing: 2, scoop: 1, flares: 0, pod: 1 } },
  { id: 'evo', name: 'ランサーエボ風', en: 'LANCER EVO', desc: 'セダンボディに巨大なウイング',
    shape: { len: 4.4, cab: 1.9, cabZ: 0.05, cabH: 0.55, bodyH: 0.62, trunk: 1, wing: 3, scoop: 1, flares: 0, pod: 0 } },
  { id: 'delta', name: 'デルタ風', en: 'DELTA', desc: '角ばったボディの伝説的ラリーハッチ',
    shape: { len: 3.9, cab: 1.9, cabZ: 0.2, cabH: 0.62, bodyH: 0.64, trunk: 0, wing: 1, scoop: 0, flares: 1, pod: 1 } },
  { id: 'p205', name: '205 T16風', en: '205 T16', desc: '小柄で軽快なグループBマシン',
    shape: { len: 3.8, cab: 1.5, cabZ: 0.1, cabH: 0.56, bodyH: 0.6, trunk: 0, wing: 0, scoop: 0, flares: 1, pod: 1 } },
];
export const CAR_BY_ID = Object.fromEntries(CARS.map(c => [c.id, c]));

// ---------------- Players ----------------
export const KART_COLORS = ['#e83b3b', '#3b6ee8', '#2fbf4f', '#e8c43b', '#a050e8', '#ef7f2a', '#30c8d8', '#e84aa8'];

