'use strict';
// ============================================================
//  Course records: the top 10 per course and race length, each with a ghost
//  (the whole race, sampled at 10 Hz). index.json holds the tables and every
//  ghost lives in ghosts/<id>.json.
//
//  Free hosts such as Render wipe the disk on restart, so players' browsers
//  keep a copy of their own records and upload them again (see restore()).
// ============================================================
const fs = require('fs');
const path = require('path');

const TOP = 10;
const GHOST_HZ = 10;
const ID_RE = /^[A-Za-z0-9]{12}$/;
const TYRE_IDX = { S: 0, M: 1, H: 2, W: 3 };

function genId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// ------------------------------------------------------------
//  Recorder: one per human kart during a race
// ------------------------------------------------------------
class Recorder {
  constructor() {
    this.x = []; this.z = []; this.y = []; this.h = []; this.v = []; this.s = []; this.f = []; this.d = [];
    this.laps = [];        // lap times (s)
    this.tyres = [];       // compounds in the order they were used
    this.maxLap = null;
    this.inPit = false;
  }

  get n() { return this.x.length; }

  /** called for every state the client sends (lap times, pit stops) */
  observe(st) {
    if (!this.tyres.length) this.tyres.push(st.tt);
    if (this.maxLap === null) this.maxLap = st.lap;
    if (st.lap > this.maxLap) {
      if (st.lap >= 1 && st.ll > 0) this.laps.push(Math.round(st.ll * 1000) / 1000);
      this.maxLap = st.lap;
    }
    if (this.inPit && !st.p) this.tyres.push(st.tt);   // the tyre fitted in this stop
    this.inPit = !!st.p;
  }

  /** one 10 Hz sample */
  sample(st) {
    this.x.push(Math.round(st.x * 10));
    this.z.push(Math.round(st.z * 10));
    this.y.push(Math.round(st.y * 10));
    this.h.push(Math.round(st.h * 100));
    this.v.push(Math.round(st.v * 10));
    this.s.push(Math.round(st.st * 10));
    this.f.push((TYRE_IDX[st.tt] || 0) | (st.b ? 4 : 0) | (st.p ? 8 : 0));
    this.d.push(Math.round(st.d * 10000));
  }

  /** compact ghost: positions / heading / distance are delta-encoded */
  ghost() {
    const delta = a => a.map((v, i) => (i ? v - a[i - 1] : v));
    return {
      v: 1, hz: GHOST_HZ, n: this.n,
      x: delta(this.x), z: delta(this.z), y: this.y, h: delta(this.h),
      sp: this.v, s: this.s, f: this.f, d: delta(this.d),
    };
  }
}

// ------------------------------------------------------------
//  Validation (used for restored records, which come from browsers)
// ------------------------------------------------------------
const isInt = v => Number.isInteger(v) && Math.abs(v) < 1e8;

function cleanGhost(g, duration) {
  if (!g || typeof g !== 'object' || g.v !== 1 || g.hz !== GHOST_HZ) return null;
  const n = g.n;
  if (!Number.isInteger(n) || n < 10 || n > duration * GHOST_HZ + 50) return null;
  const out = { v: 1, hz: GHOST_HZ, n };
  for (const k of ['x', 'z', 'y', 'h', 'sp', 's', 'f', 'd']) {
    const a = g[k];
    if (!Array.isArray(a) || a.length !== n || !a.every(isInt)) return null;
    out[k] = a;
  }
  return out;
}

function cleanEntry(e, opt) {
  if (!e || typeof e !== 'object' || !ID_RE.test(e.id)) return null;
  const course = Number(e.course), duration = Number(e.duration), dist = Number(e.dist);
  if (!Number.isInteger(course) || course < 0 || course >= opt.courseCount) return null;
  if (!opt.durations.includes(duration)) return null;
  if (!Number.isFinite(dist) || dist <= 0 || dist > duration / 25) return null;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const laps = Array.isArray(e.laps) ? e.laps.slice(0, 200).map(Number).filter(v => Number.isFinite(v) && v > 0 && v < 3600) : [];
  const tyres = Array.isArray(e.tyres) ? e.tyres.slice(0, 50).filter(t => opt.tyres.includes(t)) : [];
  return {
    id: e.id, course, duration,
    name: opt.cleanName(e.name),
    color: Math.max(0, Math.min(7, Math.trunc(num(e.color)))),
    skill: opt.skills.includes(e.skill) ? e.skill : 'none',
    tyres: tyres.length ? tyres : ['M'],
    laps,
    lapCount: Math.max(0, Math.floor(dist)),
    dist: Math.round(dist * 1e5) / 1e5,
    bestLap: Math.max(0, num(e.bestLap)),
    date: Math.max(0, Math.min(Date.now(), num(e.date, Date.now()))),
    night: !!e.night,
    weather: Array.isArray(e.weather) ? e.weather.filter(w => w === 'rain' || w === 'fog').slice(0, 4) : [],
    noSkills: !!e.noSkills,
    field: Math.max(1, Math.min(8, Math.trunc(num(e.field, 1)))),
  };
}

// ------------------------------------------------------------
class RecordStore {
  constructor(dir) {
    this.dir = dir;
    this.ghostDir = path.join(dir, 'ghosts');
    this.tables = {};
    try { fs.mkdirSync(this.ghostDir, { recursive: true }); } catch { /* read-only disk: memory only */ }
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      if (j && j.tables && typeof j.tables === 'object') this.tables = j.tables;
    } catch { /* first run */ }
    this.ghosts = new Map();   // id -> JSON string, for disks that cannot be written
  }

  key(course, duration) { return `${course}-${duration}`; }
  list(course, duration) { return this.tables[this.key(course, duration)] || []; }
  ids() { return Object.values(this.tables).flat().map(e => e.id); }

  find(id) {
    for (const t of Object.values(this.tables)) {
      const e = t.find(x => x.id === id);
      if (e) return e;
    }
    return null;
  }

  wouldRank(course, duration, dist) {
    const t = this.list(course, duration);
    return t.length < TOP || dist > t[t.length - 1].dist;
  }

  /** insert a record; returns its rank (1..10), or 0 if it did not make the table */
  add(entry, ghost) {
    if (this.find(entry.id) || !this.wouldRank(entry.course, entry.duration, entry.dist)) return 0;
    const k = this.key(entry.course, entry.duration);
    const t = (this.tables[k] = this.tables[k] || []);
    t.push(entry);
    t.sort((a, b) => b.dist - a.dist || a.date - b.date);
    for (const e of t.splice(TOP)) this._dropGhost(e.id);
    const rank = t.indexOf(entry) + 1;
    if (rank > 0) {
      this._writeGhost(entry.id, JSON.stringify(ghost));
      this._save();
    }
    return rank;
  }

  /** ghost JSON string (or null) */
  ghost(id) {
    if (!ID_RE.test(id) || !this.find(id)) return null;
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    try { return fs.readFileSync(path.join(this.ghostDir, `${id}.json`), 'utf8'); } catch { return null; }
  }

  /** a record uploaded again by the browser that owns it */
  restore(rawEntry, rawGhost, opt) {
    const entry = cleanEntry(rawEntry, opt);
    if (!entry) return { ok: false, error: 'bad record' };
    if (this.find(entry.id)) return { ok: true, rank: 0, exists: true };
    const ghost = cleanGhost(rawGhost, entry.duration);
    if (!ghost) return { ok: false, error: 'bad ghost' };
    return { ok: true, rank: this.add(entry, ghost) };
  }

  _writeGhost(id, json) {
    try { fs.writeFileSync(path.join(this.ghostDir, `${id}.json`), json); this.ghosts.delete(id); } catch { this.ghosts.set(id, json); }
  }

  _dropGhost(id) {
    this.ghosts.delete(id);
    fs.unlink(path.join(this.ghostDir, `${id}.json`), () => {});
  }

  /** written at once (small file, changes only when a race ends) so a restart never loses a record */
  _save() {
    const file = path.join(this.dir, 'index.json');
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, tables: this.tables }));
      fs.renameSync(file + '.tmp', file);
    } catch (err) {
      console.warn('records: could not save', err.message);
    }
  }
}

module.exports = { RecordStore, Recorder, genId, GHOST_HZ, TOP };
