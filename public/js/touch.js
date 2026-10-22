// ============================================================
//  Smartphone / tablet controls
//  * left half: slide to steer (analog, floating origin)
//  * right: ACCEL / BRAKE / SKILL buttons, optional auto-accelerate
//  * small buttons: menu, respawn, fullscreen
// ============================================================
const $ = id => document.getElementById(id);

export function isTouchDevice() {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}

export class TouchControls {
  constructor({ onSkill, onMenu, onRespawn, onShift }) {
    this.enabled = isTouchDevice();
    this.steer = 0;
    this.accel = false;
    this.brake = false;
    this.hbrake = false;
    this.autoAccel = true;
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

    // ---- steering zone (floating stick, horizontal only)
    const zone = $('steer-zone'), base = $('steer-base'), knob = $('steer-knob');
    this._steerId = null;     // touch identifier, or 'mouse'
    let x0 = 0;
    const range = () => Math.max(36, Math.min(innerWidth, innerHeight) * 0.13);
    const setSteer = (dx) => {
      const r = range();
      let s = Math.max(-1, Math.min(1, dx / r));
      if (Math.abs(s) < 0.06) s = 0;
      this.steer = s;
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
      if (e.pointerType !== 'mouse') return;
      beginSteer('mouse', e.clientX, e.clientY);
    });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && this._steerId === 'mouse') setSteer(e.clientX - x0); });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && this._steerId === 'mouse') this._endSteer(); });

    // ---- hold buttons
    this._holds = [];
    const hold = (el, key) => {
      const st = { el, key, id: null };
      this._holds.push(st);
      const on = (id) => { st.id = id; this[key] = true; el.classList.add('down'); };
      const off = () => { st.id = null; this[key] = false; el.classList.remove('down'); };
      st.off = off;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(e.changedTouches[0].identifier); }, opts);
      const end = (e) => { if (findTouch(e.changedTouches, st.id)) off(); };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') on('mouse'); });
      window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse' && st.id === 'mouse') off(); });
    };
    hold($('tc-accel'), 'accel');
    hold($('tc-brake'), 'brake');
    hold($('tc-hbrake'), 'hbrake');

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

    const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    tap($('skill-btn'), onSkill);
    tap($('tc-gearup'), () => onShift && onShift(1));
    tap($('tc-geardown'), () => onShift && onShift(-1));
    tap($('tc-menu'), onMenu);
    tap($('tc-respawn'), onRespawn);
    tap($('tc-fullscreen'), () => this.fullscreen());

    // fullscreen is not available everywhere (e.g. iPhone Safari)
    const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    document.body.classList.toggle('no-fullscreen', !fsOk);

    // no long-press menus / double-tap zoom inside the game
    document.addEventListener('contextmenu', (e) => { if (document.body.classList.contains('racing')) e.preventDefault(); });
    document.addEventListener('dblclick', (e) => { if (document.body.classList.contains('racing')) e.preventDefault(); }, { passive: false });
  }

  setAutoAccel(on) {
    this.autoAccel = !!on;
    try { localStorage.setItem('pke.autoAccel', on ? '1' : '0'); } catch { /* ignore */ }
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
    this.steer = 0;
    this.accel = false;
    this.brake = false;
    this.hbrake = false;
  }
}
