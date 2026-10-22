// ============================================================
//  Smartphone / tablet controls
//  * steering: slide on the left half of the screen, or ◀ ▶ buttons
//  * ACCEL / BRAKE / DRIFT / SKILL / menu buttons at user-defined positions
//  * layout editor: drag buttons, change size & opacity
// ============================================================
import { TOUCH_ITEMS } from './controls.js';

const $ = id => document.getElementById(id);

export function isTouchDevice() {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}

// element for each layout item
const ELEMENT_ID = {
  accel: 'tc-accel', brake: 'tc-brake', drift: 'tc-hbrake', skill: 'skill-btn',
  left: 'tc-left', right: 'tc-right', menu: 'tc-menu-group',
};

export class TouchControls {
  /**
   * @param {{onSkill:Function, onMenu:Function, onRespawn:Function, layout:import('./controls.js').TouchLayout}} opts
   */
  constructor({ onSkill, onMenu, onRespawn, layout }) {
    this.enabled = isTouchDevice();
    this.layout = layout;
    this.slideSteer = 0;
    this.accel = false;
    this.brake = false;
    this.hbrake = false;
    this.leftDown = false;
    this.rightDown = false;
    this.autoAccel = true;
    this.editing = false;
    try {
      const v = localStorage.getItem('pke.autoAccel');
      if (v !== null) this.autoAccel = v === '1';
    } catch { /* ignore */ }

    document.body.classList.toggle('touch', this.enabled);

    // Real fingers use Touch Events: touchmove/touchend are always delivered to the element
    // where the touch started, even after the finger leaves it or slides off the screen edge.
    // Mouse (for ?touch=1 testing on a PC) uses pointer events with pointerType 'mouse'.
    const opts = { passive: false };
    const findTouch = (list, id) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };

    // ---- slide steering zone (floating stick, horizontal only)
    const zone = $('steer-zone'), base = $('steer-base'), knob = $('steer-knob');
    this._steerId = null;     // touch identifier, or 'mouse'
    let x0 = 0;
    const range = () => Math.max(30, Math.min(innerWidth, innerHeight) * 0.13 / this.layout.data.sens);
    const setSteer = (dx) => {
      const r = range();
      let s = Math.max(-1, Math.min(1, dx / r));
      if (Math.abs(s) < 0.06) s = 0;
      this.slideSteer = s;
      knob.style.transform = `translateX(${s * r}px)`;
    };
    const beginSteer = (id, x, y) => {
      // a new finger always takes over, so a lost "touchend" can never leave the wheel stuck
      this._steerId = id;
      x0 = x;
      const rect = zone.getBoundingClientRect();
      base.style.left = `${x - rect.left}px`;
      base.style.top = `${y - rect.top}px`;
      base.classList.add('on');
      setSteer(0);
    };
    this._endSteer = () => {
      this._steerId = null;
      base.classList.remove('on');
      setSteer(0);
    };
    zone.addEventListener('touchstart', (e) => {
      if (this.editing) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      beginSteer(t.identifier, t.clientX, t.clientY);
    }, opts);
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = findTouch(e.changedTouches, this._steerId);
      if (t) setSteer(t.clientX - x0);
    }, opts);
    const touchEnd = (e) => { if (findTouch(e.changedTouches, this._steerId)) this._endSteer(); };
    zone.addEventListener('touchend', touchEnd);
    zone.addEventListener('touchcancel', touchEnd);
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || this.editing) return;
      beginSteer('mouse', e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && this._steerId === 'mouse') setSteer(e.clientX - x0); });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && this._steerId === 'mouse') this._endSteer(); });

    // ---- hold buttons (accel, brake, drift, ◀ ▶)
    this._holds = [];
    const hold = (el, key) => {
      const st = { el, key, id: null };
      this._holds.push(st);
      const on = (id) => { st.id = id; this[key] = true; el.classList.add('down'); };
      const off = () => { st.id = null; this[key] = false; el.classList.remove('down'); };
      st.off = off;
      el.addEventListener('touchstart', (e) => {
        if (this.editing) return;
        e.preventDefault();
        on(e.changedTouches[0].identifier);
      }, opts);
      const end = (e) => { if (findTouch(e.changedTouches, st.id)) off(); };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !this.editing) on('mouse'); });
      window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && st.id === 'mouse') off(); });
    };
    hold($('tc-accel'), 'accel');
    hold($('tc-brake'), 'brake');
    hold($('tc-hbrake'), 'hbrake');
    hold($('tc-left'), 'leftDown');
    hold($('tc-right'), 'rightDown');

    // ---- failsafe: release anything whose finger is no longer on the screen
    const sweep = (e) => {
      const live = e.touches;
      if (typeof this._steerId === 'number' && !findTouch(live, this._steerId)) this._endSteer();
      for (const h of this._holds) if (typeof h.id === 'number' && !findTouch(live, h.id)) h.off();
    };
    document.addEventListener('touchend', sweep, true);
    document.addEventListener('touchcancel', sweep, true);
    document.addEventListener('touchstart', sweep, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    const tap = (el, fn) => el.addEventListener('pointerdown', (e) => {
      if (this.editing) return;
      e.preventDefault();
      fn();
    });
    tap($('skill-btn'), onSkill);
    tap($('tc-menu'), onMenu);
    tap($('tc-respawn'), onRespawn);
    tap($('tc-fullscreen'), () => this.fullscreen());

    // fullscreen is not available everywhere (e.g. iPhone Safari)
    const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    document.body.classList.toggle('no-fullscreen', !fsOk);

    // no long-press menus / double-tap zoom inside the game
    document.addEventListener('contextmenu', (e) => {
      if (document.body.classList.contains('racing') || this.editing) e.preventDefault();
    });
    document.addEventListener('dblclick', (e) => { if (document.body.classList.contains('racing')) e.preventDefault(); }, { passive: false });

    this._initEditor();
    window.addEventListener('resize', () => this.applyLayout());
    this.applyLayout();
  }

  /** combined steering value: slide stick or ◀ ▶ buttons */
  get steer() {
    if (this.layout.data.steerMode === 'buttons') return (this.rightDown ? 1 : 0) - (this.leftDown ? 1 : 0);
    return this.slideSteer;
  }

  setAutoAccel(on) {
    this.autoAccel = !!on;
    try { localStorage.setItem('pke.autoAccel', on ? '1' : '0'); } catch { /* ignore */ }
  }

  setSteerMode(mode) {
    this.layout.data.steerMode = mode === 'buttons' ? 'buttons' : 'slide';
    this.applyLayout();
  }

  // ------------------------------------------------------------------
  //  layout
  // ------------------------------------------------------------------
  _baseSize() {
    return Math.max(52, Math.min(86, innerHeight * 0.19));
  }

  /** position every button from the saved layout (centre fractions + size scale) */
  applyLayout() {
    const L = this.layout.data;
    document.body.classList.toggle('steer-buttons', L.steerMode === 'buttons');
    document.documentElement.style.setProperty('--tc-opacity', String(L.opacity));
    if (!this.enabled && !this.editing) return;
    const W = innerWidth, H = innerHeight, b = this._baseSize();
    for (const it of TOUCH_ITEMS) {
      const el = $(ELEMENT_ID[it.id]);
      const v = L.items[it.id];
      if (!el || !v) continue;
      if (it.group) {
        el.style.transform = `translate(-50%, -50%) scale(${v.s})`;
        el.style.left = `${Math.round(v.x * W)}px`;
        el.style.top = `${Math.round(v.y * H)}px`;
        continue;
      }
      const size = Math.round(b * it.base * v.s);
      const cx = Math.min(W - size / 2, Math.max(size / 2, v.x * W));
      const cy = Math.min(H - size / 2, Math.max(size / 2, v.y * H));
      Object.assign(el.style, {
        width: `${size}px`, height: `${size}px`,
        left: `${Math.round(cx - size / 2)}px`, top: `${Math.round(cy - size / 2)}px`,
        right: 'auto', bottom: 'auto',
        fontSize: `${Math.max(10, Math.round(size * 0.16))}px`,
      });
    }
  }

  // ------------------------------------------------------------------
  //  layout editor (drag & drop)
  // ------------------------------------------------------------------
  _initEditor() {
    this._drag = null;
    this.selected = 'accel';
    for (const it of TOUCH_ITEMS) {
      const el = $(ELEMENT_ID[it.id]);
      el.addEventListener('pointerdown', (e) => {
        if (!this.editing) return;
        e.preventDefault();
        e.stopPropagation();
        this.select(it.id);
        const r = el.getBoundingClientRect();
        this._drag = { id: it.id, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), pid: e.pointerId };
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }, true);
    }
    window.addEventListener('pointermove', (e) => {
      const d = this._drag;
      if (!d || e.pointerId !== d.pid) return;
      const v = this.layout.data.items[d.id];
      v.x = Math.min(0.98, Math.max(0.02, (e.clientX - d.dx) / innerWidth));
      v.y = Math.min(0.98, Math.max(0.02, (e.clientY - d.dy) / innerHeight));
      this.applyLayout();
      if (this.onDrag) this.onDrag(d.id);
    });
    window.addEventListener('pointerup', (e) => { if (this._drag && e.pointerId === this._drag.pid) this._drag = null; });
  }

  select(id) {
    this.selected = id;
    for (const it of TOUCH_ITEMS) $(ELEMENT_ID[it.id]).classList.toggle('le-selected', this.editing && it.id === id);
    if (this.onSelect) this.onSelect(id);
  }

  startEdit(onSelect) {
    this.editing = true;
    this.onSelect = onSelect;
    this._snapshot = this.layout.snapshot();
    this.reset();
    document.body.classList.add('layout-edit');
    this.applyLayout();
    this.select(this.selected);
  }

  /** keep = true saves the edited layout, false restores the previous one */
  stopEdit(keep) {
    if (!keep && this._snapshot) this.layout.restore(this._snapshot);
    else this.layout.save();
    this.editing = false;
    this._drag = null;
    document.body.classList.remove('layout-edit');
    for (const it of TOUCH_ITEMS) $(ELEMENT_ID[it.id]).classList.remove('le-selected');
    if (!this.enabled) {
      // PC preview: drop the inline positions again
      for (const it of TOUCH_ITEMS) $(ELEMENT_ID[it.id]).removeAttribute('style');
    }
    this.applyLayout();
  }

  async fullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch { /* user agent refused */ }
  }

  /** release everything (e.g. when the race ends) */
  reset() {
    if (this._endSteer) this._endSteer();
    for (const h of this._holds || []) h.off();
    this.slideSteer = 0;
    this.accel = false;
    this.brake = false;
    this.hbrake = false;
    this.leftDown = false;
    this.rightDown = false;
  }
}
