// ============================================================
//  Sound engine – everything synthesized with the Web Audio API.
//  * 8-bit BGM sequencer (pulse/triangle/noise), tempo+pitch up in the last spurt
//  * continuous engine / skid / gravel / wind layers
//  * one-shot SFX (countdown, dash, skills, wrench, lap, burst...)
// ============================================================

const NOTE_IDX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function midi(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  return 12 * (Number(m[2]) + 1) + NOTE_IDX[m[1]];
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS = {
  Em: ['E', 'G', 'B'], C: ['C', 'E', 'G'], D: ['D', 'F#', 'A'], B: ['B', 'D#', 'F#'],
  Am: ['A', 'C', 'E'], G: ['G', 'B', 'D'], F: ['F', 'A', 'C'],
};

// ---------------- songs (8th-note melody tokens per bar: note | _ hold | . rest) ----------------
const SONG_DATA = {
  race: {
    bpm: 150,
    chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'B', 'Am', 'D', 'G', 'Em', 'C', 'D', 'B', 'B'],
    melody: [
      'E5 _ G5 _ B5 _ A5 G5', 'E5 _ _ D5 E5 _ G5 _', 'F#5 _ A5 _ D6 _ C6 B5', 'A5 _ F#5 _ D#5 _ B4 _',
      'E5 _ G5 _ B5 _ E6 _', 'D6 _ C6 _ B5 _ G5 _', 'A5 _ B5 _ C6 _ D6 _', 'D#6 _ _ _ B5 _ _ _',
      'C6 _ B5 A5 _ E5 A5 _', 'D6 _ C6 B5 _ F#5 A5 _', 'B5 _ A5 G5 _ D5 G5 _', 'F#5 _ G5 _ A5 _ B5 _',
      'E6 _ D6 C6 _ G5 C6 _', 'F#6 _ E6 D6 _ A5 D6 _', 'D#6 _ E6 _ F#6 _ D#6 _', 'B5 _ A5 _ F#5 _ D#5 _',
    ],
    bass: 'drive', drums: 'race', arp: true, echo: true,
  },
  lobby: {
    bpm: 112,
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'],
    melody: [
      'E5 _ _ G5 _ _ C6 _', 'B5 _ A5 _ E5 _ _ _', 'F5 _ A5 _ C6 _ B5 A5', 'G5 _ _ _ D5 _ _ _',
      'E5 _ _ G5 _ _ C6 _', 'D6 _ C6 _ A5 _ _ _', 'F5 _ G5 _ A5 _ B5 _', 'C6 _ _ _ . . . .',
    ],
    bass: 'half', drums: 'soft', arp: true, echo: true,
  },
};

function buildSong(src) {
  const bars = src.chords.length;
  const steps = bars * 16;
  const ev = Array.from({ length: steps }, () => []);
  for (let b = 0; b < bars; b++) {
    const base = b * 16;
    // melody
    const toks = src.melody[b].trim().split(/\s+/);
    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k];
      if (tk === '_' || tk === '.') continue;
      let len = 2;
      for (let j = k + 1; j < toks.length && toks[j] === '_'; j++) len += 2;
      ev[base + k * 2].push({ t: 'mel', m: midi(tk), len });
    }
    // bass
    const root = CHORDS[src.chords[b]][0];
    const r2 = midi(root + '2') < midi('E2') ? midi(root + '3') : midi(root + '2');
    if (src.bass === 'drive') {
      for (let k = 0; k < 8; k++) ev[base + k * 2].push({ t: 'bass', m: k % 2 ? r2 + 12 : r2, len: 2 });
    } else {
      ev[base].push({ t: 'bass', m: r2, len: 7 });
      ev[base + 8].push({ t: 'bass', m: r2 + 7, len: 7 });
    }
    // arpeggio
    if (src.arp) {
      const tones = CHORDS[src.chords[b]].map(n => midi(n + '4'));
      const seq = [tones[0], tones[1], tones[2], tones[0] + 12];
      for (let k = 0; k < 16; k++) ev[base + k].push({ t: 'arp', m: seq[k % 4] });
    }
    // drums
    for (let k = 0; k < 16; k++) {
      if (src.drums === 'race') {
        if (k === 0 || k === 8 || (k === 10 && b % 2) || (k === 14 && b % 4 === 3)) ev[base + k].push({ t: 'kick' });
        if (k === 4 || k === 12) ev[base + k].push({ t: 'snare' });
        if (b % 4 === 3 && k >= 12) ev[base + k].push({ t: 'snare', soft: true });
        if (k % 2 === 0) ev[base + k].push({ t: 'hat', open: k % 4 === 2 });
      } else {
        if (k === 0 || k === 8) ev[base + k].push({ t: 'kick', soft: true });
        if (k === 4 || k === 12) ev[base + k].push({ t: 'hat', open: true });
      }
    }
  }
  return { bpm: src.bpm, steps, ev, echo: src.echo };
}

const SONGS = Object.fromEntries(Object.entries(SONG_DATA).map(([k, v]) => [k, buildSong(v)]));

const LS_KEY = 'pke.audio.v1';

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.settings = { bgm: 0.55, se: 0.8, bgmMute: false, seMute: false };
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && typeof s === 'object') Object.assign(this.settings, s);
    } catch { /* storage unavailable */ }
    this.song = null;
    this.fast = false;
    this.timer = null;
    this.engine = null;
    this.listeners = new Set();
  }

  /** must be called from a user gesture */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.bgmBus = ctx.createGain();
      this.seBus = ctx.createGain();
      this.bgmBus.connect(this.master);
      this.seBus.connect(this.master);
      this.noise = this._noiseBuffer(2);
      this.pulse12 = this._pulseWave(0.125);
      this.pulse25 = this._pulseWave(0.25);
      this._applyVolumes();
      this.timer = setInterval(() => this._schedule(), 25);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ---------------- settings ----------------
  setSettings(patch) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this._applyVolumes();
    for (const fn of this.listeners) fn(this.settings);
  }
  onSettings(fn) { this.listeners.add(fn); }

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.bgmBus.gain.setTargetAtTime(s.bgmMute ? 0 : s.bgm * 0.55, t, 0.03);
    this.seBus.gain.setTargetAtTime(s.seMute ? 0 : s.se * 0.9, t, 0.03);
  }

  // ---------------- primitives ----------------
  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _pulseWave(duty) {
    const n = 48;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  _osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    if (type === 'p12') o.setPeriodicWave(this.pulse12);
    else if (type === 'p25') o.setPeriodicWave(this.pulse25);
    else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  tone(t, freq, dur, type, vol, bus, { attack = 0.004, sustain = 0.65, slideTo = null } = {}) {
    const ctx = this.ctx;
    const o = this._osc(type, freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.linearRampToValueAtTime(vol * sustain, t + Math.max(attack + 0.01, dur * 0.6));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  noiseHit(t, dur, vol, bus, { type = 'highpass', freq = 6000, freqTo = null, q = 0.7 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  // ---------------- BGM sequencer ----------------
  playBgm(name) {
    if (!this.ctx) return;
    if (this.songName === name) return;
    this.songName = name;
    this.song = SONGS[name] || null;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
  }
  stopBgm() { this.song = null; this.songName = null; }
  setFast(on) { this.fast = !!on; }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    const song = this.song;
    const bpm = song.bpm * (this.fast ? 1.25 : 1);
    const stepDur = 60 / bpm / 4;
    const tr = this.fast ? 1 : 0; // +1 semitone in the last spurt
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.03;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(song, this.step, this.nextTime, stepDur, tr);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % song.steps;
    }
  }

  _playStep(song, step, t, sd, tr) {
    const bus = this.bgmBus;
    for (const e of song.ev[step]) {
      switch (e.t) {
        case 'mel':
          this.tone(t, mtof(e.m + tr), e.len * sd * 0.95, 'p25', 0.16, bus);
          if (song.echo) this.tone(t + sd * 3, mtof(e.m + tr), e.len * sd * 0.8, 'p25', 0.05, bus);
          break;
        case 'bass':
          this.tone(t, mtof(e.m + tr), e.len * sd * 0.9, 'triangle', 0.32, bus, { sustain: 0.85 });
          break;
        case 'arp':
          this.tone(t, mtof(e.m + tr), sd * 0.8, 'p12', 0.045, bus, { sustain: 0.4 });
          break;
        case 'kick': {
          const o = this._osc('sine', 150, t);
          o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
          const g = this.ctx.createGain();
          const v = e.soft ? 0.35 : 0.6;
          g.gain.setValueAtTime(v, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          o.connect(g).connect(bus);
          o.start(t); o.stop(t + 0.18);
          break;
        }
        case 'snare':
          this.noiseHit(t, e.soft ? 0.06 : 0.13, e.soft ? 0.12 : 0.28, bus, { type: 'highpass', freq: 1200 });
          if (!e.soft) this.tone(t, 190, 0.07, 'triangle', 0.18, bus);
          break;
        case 'hat':
          this.noiseHit(t, e.open ? 0.07 : 0.025, 0.07, bus, { type: 'highpass', freq: 7500 });
          break;
      }
    }
  }

  // ---------------- engine & continuous layers ----------------
  startEngine() {
    if (!this.ctx || this.engine) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const e = {};
    e.o1 = this._osc('sawtooth', 50, t);
    e.o2 = this._osc('p25', 25, t);
    e.filter = ctx.createBiquadFilter();
    e.filter.type = 'lowpass';
    e.filter.frequency.value = 500;
    e.filter.Q.value = 3;
    e.gain = ctx.createGain();
    e.gain.gain.value = 0;
    // growl LFO on amplitude
    e.lfo = this._osc('square', 18, t);
    e.lfoGain = ctx.createGain();
    e.lfoGain.gain.value = 0.02;
    e.lfo.connect(e.lfoGain).connect(e.gain.gain);
    e.o1.connect(e.filter);
    e.o2.connect(e.filter);
    e.filter.connect(e.gain).connect(this.seBus);
    e.o1.start(); e.o2.start(); e.lfo.start();

    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.seBus);
      src.start();
      return { src, f, g };
    };
    e.skid = loop('bandpass', 2400, 3);
    e.squeal = this._osc('triangle', 1250, t);
    e.squealGain = ctx.createGain();
    e.squealGain.gain.value = 0;
    e.squeal.connect(e.squealGain).connect(this.seBus);
    e.squeal.start();
    e.dirt = loop('lowpass', 900, 1);
    e.wind = loop('bandpass', 800, 1.2);
    this.engine = e;
  }

  updateEngine({ speedFrac = 0, throttle = 0, boost = false, skid = 0, dirt = 0, wind = 0 }) {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    const sf = Math.max(0, Math.min(1.5, speedFrac));
    const f = 46 + 150 * sf + throttle * 8;
    e.o1.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    e.lfo.frequency.setTargetAtTime(14 + 30 * sf, t, 0.1);
    e.filter.frequency.setTargetAtTime(280 + 1500 * sf * (0.5 + 0.5 * throttle) + (boost ? 900 : 0), t, 0.06);
    e.gain.gain.setTargetAtTime((0.05 + 0.06 * throttle + 0.03 * sf) * (boost ? 1.35 : 1), t, 0.06);
    e.skid.g.gain.setTargetAtTime(0.16 * skid, t, 0.05);
    e.squealGain.gain.setTargetAtTime(0.025 * skid, t, 0.05);
    e.squeal.frequency.setTargetAtTime(1150 + Math.random() * 200, t, 0.02);
    // gravel crackle: randomised gain
    e.dirt.g.gain.setTargetAtTime(dirt * (0.12 + Math.random() * 0.18), t, 0.015);
    e.wind.g.gain.setTargetAtTime(0.12 * wind, t, 0.1);
    e.wind.f.frequency.setTargetAtTime(600 + 700 * wind + Math.random() * 200, t, 0.1);
  }

  stopEngine() {
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    const t = this.ctx.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.05);
    for (const n of [e.o1, e.o2, e.lfo, e.squeal, e.skid.src, e.dirt.src, e.wind.src]) {
      try { n.stop(t + 0.3); } catch { /* already stopped */ }
    }
    e.skid.g.gain.setTargetAtTime(0, t, 0.03);
    e.dirt.g.gain.setTargetAtTime(0, t, 0.03);
    e.wind.g.gain.setTargetAtTime(0, t, 0.03);
    e.squealGain.gain.setTargetAtTime(0, t, 0.03);
  }

  // ---------------- one-shot SFX ----------------
  _now() { return this.ctx ? this.ctx.currentTime + 0.005 : 0; }

  sfx(name, opt = {}) {
    if (!this.ctx) return;
    const t = this._now();
    const B = this.seBus;
    switch (name) {
      case 'click':
        this.tone(t, 1320, 0.05, 'p25', 0.12, B);
        break;
      case 'count':
        this.tone(t, 523.25, 0.22, 'square', 0.22, B, { sustain: 0.9 });
        break;
      case 'go':
        this.tone(t, 1046.5, 0.7, 'square', 0.22, B, { sustain: 0.9 });
        this.tone(t, 523.25, 0.7, 'p25', 0.12, B, { sustain: 0.9 });
        break;
      case 'dash':
        this.tone(t, 330, 0.28, 'square', 0.16, B, { slideTo: 1320 });
        this.noiseHit(t, 0.35, 0.18, B, { type: 'bandpass', freq: 800, freqTo: 4000, q: 1.5 });
        break;
      case 'nitro':
        this.tone(t, 90, 0.9, 'sawtooth', 0.2, B, { slideTo: 420 });
        this.noiseHit(t, 1.1, 0.3, B, { type: 'lowpass', freq: 400, freqTo: 5000, q: 2 });
        this._arp(t, [784, 988, 1175, 1568], 0.05, 'p25', 0.1);
        break;
      case 'smoke':
        this.noiseHit(t, 1.4, 0.35, B, { type: 'lowpass', freq: 1800, freqTo: 200, q: 0.8 });
        this._arp(t, [659, 523, 392, 330], 0.06, 'p25', 0.1);
        break;
      case 'aerojump':
        this.tone(t, 220, 0.3, 'square', 0.18, B, { slideTo: 1100 });
        this._arp(t, [880, 1175, 1760], 0.05, 'p12', 0.1);
        break;
      case 'land':
        this.tone(t, 130, 0.16, 'sine', 0.35, B, { slideTo: 45 });
        this.noiseHit(t, 0.12, 0.2, B, { type: 'lowpass', freq: 600 });
        break;
      case 'bump': {
        const p = Math.min(1, (opt.power || 5) / 15);
        this.noiseHit(t, 0.14, 0.15 + 0.25 * p, B, { type: 'lowpass', freq: 500 });
        this.tone(t, 80, 0.12, 'sine', 0.25 * p + 0.1, B, { slideTo: 40 });
        break;
      }
      case 'wrench':
        // ratchet clicks + metallic ping
        for (let k = 0; k < 7; k++) this.noiseHit(t + k * 0.045, 0.014, 0.22, B, { type: 'highpass', freq: 3800 });
        this.tone(t, 2350, 0.08, 'square', 0.05, B);
        this.tone(t + 0.33, 3100, 0.12, 'triangle', 0.08, B);
        break;
      case 'pitDone':
        this._arp(t, [1046, 1318, 1568, 2093], 0.06, 'p25', 0.14);
        break;
      case 'lap':
        this._arp(t, [784, 988, 1175], 0.07, 'p25', 0.15);
        break;
      case 'best':
        this._arp(t, [1046, 1318, 1568, 2093, 2637], 0.06, 'p25', 0.15);
        break;
      case 'spurt':
        for (let k = 0; k < 6; k++) this.tone(t + k * 0.13, k % 2 ? 660 : 880, 0.11, 'square', 0.12, B, { sustain: 0.9 });
        break;
      case 'burst':
        this.noiseHit(t, 0.7, 0.55, B, { type: 'lowpass', freq: 4000, freqTo: 150, q: 0.5 });
        this.tone(t, 160, 0.4, 'sawtooth', 0.25, B, { slideTo: 30 });
        break;
      case 'skillReady':
        this.tone(t, 1568, 0.06, 'p12', 0.08, B);
        this.tone(t + 0.07, 2093, 0.08, 'p12', 0.08, B);
        break;
      case 'finish':
        this._arp(t, [784, 1046, 1318, 1568, 1318, 1568, 2093], 0.12, 'square', 0.16, 0.22);
        break;
      case 'error':
        this.tone(t, 220, 0.2, 'square', 0.12, B, { slideTo: 110 });
        break;
      case 'shift':
        // automatic gear change: soft mechanical clunk
        this.noiseHit(t, 0.04, 0.12, B, { type: 'bandpass', freq: 1800, q: 2 });
        this.tone(t, 140, 0.06, 'square', 0.06, B, { slideTo: 90 });
        break;
      case 'driftStart':
        this.noiseHit(t, 0.25, 0.18, B, { type: 'bandpass', freq: 2600, freqTo: 1400, q: 3 });
        break;
      case 'driftBoost': {
        const lvl = opt.level || 1;
        this.tone(t, 300, 0.25, 'square', 0.15, B, { slideTo: lvl > 1 ? 1500 : 1000 });
        this._arp(t, lvl > 1 ? [988, 1318, 1760] : [784, 1046], 0.05, 'p25', 0.11);
        this.noiseHit(t, 0.3, 0.15, B, { type: 'bandpass', freq: 900, freqTo: 3500, q: 1.5 });
        break;
      }
      case 'pitEnter':
        this.tone(t, 660, 0.08, 'p25', 0.1, B);
        this.tone(t + 0.1, 880, 0.12, 'p25', 0.1, B);
        break;
    }
  }

  _arp(t, freqs, step, type, vol, len = null) {
    freqs.forEach((f, i) => this.tone(t + i * step, f, len || step * 1.6, type, vol, this.seBus));
  }
}

export const sound = new SoundEngine();
