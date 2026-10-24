// ============================================================
//  Player controls settings (saved in localStorage)
//  * PC key bindings: 2 slots per action, keyboard keys or mouse buttons
//  * Smartphone button layout: free positions / sizes, steering mode, opacity
// ============================================================

export const ACTIONS = [
  { id: 'accel', label: 'アクセル' },
  { id: 'brake', label: 'ブレーキ / バック' },
  { id: 'left', label: 'ハンドル 左' },
  { id: 'right', label: 'ハンドル 右' },
  { id: 'skill', label: 'スキル発動' },
  { id: 'respawn', label: 'コースに復帰' },
  { id: 'pause', label: 'メニューを開く' },
  { id: 'mute', label: 'ミュート切り替え' },
];

export const DEFAULT_KEYS = {
  accel: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  skill: ['Space', null],
  respawn: ['KeyR', null],
  pause: ['Escape', null],
  mute: ['KeyM', null],
};

const NAMED = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'BS',
  ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
  AltLeft: '左Alt', AltRight: '右Alt', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Mouse0: '左クリック', Mouse1: 'ホイールクリック', Mouse2: '右クリック', Mouse3: 'マウス戻る', Mouse4: 'マウス進む',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\', IntlRo: 'ろ', IntlYen: '¥',
};
const ASCII = {
  Space: 'SPACE', Escape: 'ESC', ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL',
  AltLeft: 'LALT', AltRight: 'RALT', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Mouse0: 'L-CLICK', Mouse1: 'M-CLICK', Mouse2: 'R-CLICK', Mouse3: 'MOUSE4', Mouse4: 'MOUSE5', Enter: 'ENTER', Tab: 'TAB',
};

/** human readable key name. ascii=true -> only A-Z/0-9 style text (for the pixel font) */
export function keyLabel(code, ascii = false) {
  if (!code) return ascii ? '' : '—';
  if (ascii && ASCII[code]) return ASCII[code];
  if (!ascii && NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return (ascii ? 'NUM' : 'テンキー') + code.slice(6);
  if (/^F\d+$/.test(code)) return code;
  return ascii ? code.toUpperCase().slice(0, 8) : code;
}

const KEY_LS = 'pke.keys.v2';
const LAYOUT_LS = 'pke.touchLayout.v1';

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------
export class KeyBindings {
  constructor() {
    this.map = structuredClone(DEFAULT_KEYS);
    const s = load(KEY_LS);
    if (s && typeof s === 'object') {
      for (const a of ACTIONS) {
        if (Array.isArray(s[a.id]) && s[a.id].length === 2) this.map[a.id] = s[a.id].map(v => (typeof v === 'string' ? v : null));
      }
    }
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }
  _changed() {
    save(KEY_LS, this.map);
    for (const fn of this.listeners) fn(this);
  }

  get(action) { return this.map[action] || [null, null]; }

  /** every action bound to a code */
  actionsFor(code) {
    const out = [];
    for (const a of ACTIONS) if (this.map[a.id].includes(code)) out.push(a.id);
    return out;
  }

  /**
   * Bind `code` to action/slot. If another action already uses the code it is moved
   * (removed there). Returns the label of the action it was taken from, or null.
   */
  set(action, slot, code) {
    let taken = null;
    if (code) {
      for (const a of ACTIONS) {
        const k = this.map[a.id];
        for (let i = 0; i < 2; i++) {
          if (k[i] === code && !(a.id === action && i === slot)) { k[i] = null; taken = a.label; }
        }
      }
    }
    this.map[action][slot] = code;
    this._changed();
    return taken;
  }

  reset() {
    this.map = structuredClone(DEFAULT_KEYS);
    this._changed();
  }

  /** "W / ↑" style text for UI */
  describe(action, ascii = false) {
    return this.get(action).filter(Boolean).map(c => keyLabel(c, ascii)).join(ascii ? '/' : ' / ') || (ascii ? '-' : '未設定');
  }
}

// ------------------------------------------------------------
//  Smartphone layout. x/y = centre as a fraction of the screen, s = size scale.
// ------------------------------------------------------------
export const TOUCH_ITEMS = [
  { id: 'accel', label: 'ACCEL', base: 1.3 },
  { id: 'brake', label: 'BRAKE', base: 1 },
  { id: 'skill', label: 'SKILL', base: 1 },
  { id: 'left', label: '◀', base: 1.1, steerButtons: true },
  { id: 'right', label: '▶', base: 1.1, steerButtons: true },
  { id: 'menu', label: 'メニュー', base: 1, group: true },
];

export const DEFAULT_LAYOUT = {
  steerMode: 'slide',     // 'slide' (left half of the screen) | 'buttons' (◀ ▶)
  sens: 1,                // slide steering sensitivity
  opacity: 0.8,
  items: {
    accel: { x: 0.925, y: 0.83, s: 1 },
    brake: { x: 0.80, y: 0.86, s: 1 },
    skill: { x: 0.93, y: 0.55, s: 1 },
    left: { x: 0.08, y: 0.80, s: 1 },
    right: { x: 0.22, y: 0.80, s: 1 },
    menu: { x: 0.38, y: 0.07, s: 1 },
  },
};

export class TouchLayout {
  constructor() {
    this.data = structuredClone(DEFAULT_LAYOUT);
    const s = load(LAYOUT_LS);
    if (s && typeof s === 'object') {
      if (s.steerMode === 'slide' || s.steerMode === 'buttons') this.data.steerMode = s.steerMode;
      if (Number.isFinite(s.sens)) this.data.sens = Math.min(2, Math.max(0.5, s.sens));
      if (Number.isFinite(s.opacity)) this.data.opacity = Math.min(1, Math.max(0.25, s.opacity));
      for (const it of TOUCH_ITEMS) {
        const v = s.items && s.items[it.id];
        if (v && [v.x, v.y, v.s].every(Number.isFinite)) this.data.items[it.id] = { x: v.x, y: v.y, s: v.s };
      }
    }
  }

  save() { save(LAYOUT_LS, this.data); }
  snapshot() { return structuredClone(this.data); }
  restore(snap) { this.data = structuredClone(snap); }
  reset() { this.data = structuredClone(DEFAULT_LAYOUT); }
}

// ------------------------------------------------------------
//  HUD panels (drawn on the HUD canvas, 960x540). Their top-left corners can be
//  moved in the layout editor; PC and smartphone layouts are kept separately.
// ------------------------------------------------------------
const HUD_LS = 'pke.hudLayout.v1';

export const HUD_ITEMS = [
  { id: 'timer', label: 'タイマー' },
  { id: 'standings', label: '順位表' },
  { id: 'minimap', label: 'マップ' },
  { id: 'speed', label: 'スピードメーター' },
  { id: 'tyre', label: 'タイヤ' },
  { id: 'skill', label: '個性', desktopOnly: true },   // phones use the SKILL button
  { id: 'weather', label: '天気' },
];

export const DEFAULT_HUD = {
  desktop: { timer: [10, 10], standings: [760, 10], minimap: [800, 250], speed: [710, 404], tyre: [10, 420], skill: [10, 350], weather: [248, 10] },
  touch: { timer: [10, 10], standings: [760, 10], minimap: [10, 270], speed: [350, 448], tyre: [10, 154], weather: [252, 470] },
};

export class HudLayout {
  constructor() {
    this.data = structuredClone(DEFAULT_HUD);
    const s = load(HUD_LS);
    for (const mode of ['desktop', 'touch']) {
      const m = s && s[mode];
      if (!m) continue;
      for (const id of Object.keys(this.data[mode])) {
        const v = m[id];
        if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)) this.data[mode][id] = [v[0], v[1]];
      }
    }
  }

  get(mode) { return this.data[mode]; }
  set(mode, id, x, y) { this.data[mode][id] = [Math.round(x), Math.round(y)]; }
  save() { save(HUD_LS, this.data); }
  snapshot() { return structuredClone(this.data); }
  restore(snap) { this.data = structuredClone(snap); }
  reset(mode) { this.data[mode] = structuredClone(DEFAULT_HUD[mode]); }
}
