'use strict';
// ============================================================
//  Course records: the top 10 per course and race length. Records from
//  solo races also carry a ghost (the whole race, sampled at 10 Hz).
//
//  Storage backends:
//   - PgBackend   (DATABASE_URL set): one shared PostgreSQL database, so every
//                 server (Render, a PC running share.bat, ...) sees the same ranking
//   - FileBackend (default): data/index.json + data/ghosts/<id>.json
//
//  The tables are kept in memory for the game logic and reloaded from the
//  database regularly to pick up records made on other servers. Browsers also
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

function sortTable(t) {
  return t.sort((a, b) => b.dist - a.dist || a.date - b.date);
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
    hasGhost: e.hasGhost !== false,   // records made before this flag existed always had one
  };
}

// ------------------------------------------------------------
//  Backends
// ------------------------------------------------------------
class FileBackend {
  constructor(dir) {
    this.name = `files (${dir})`;
    this.dir = dir;
    this.ghostDir = path.join(dir, 'ghosts');
    this.memGhosts = new Map();   // when the disk cannot be written
    try { fs.mkdirSync(this.ghostDir, { recursive: true }); } catch { /* read-only disk: memory only */ }
  }

  async load() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8'));
      if (j && j.tables && typeof j.tables === 'object') return j.tables;
    } catch { /* first run */ }
    return {};
  }

  /** the index is written at once (small, changes only when a race ends) so a restart never loses a record */
  async persist({ tables, entry, ghostJson, dropped }) {
    if (entry && ghostJson) {
      try { fs.writeFileSync(path.join(this.ghostDir, `${entry.id}.json`), ghostJson); } catch { this.memGhosts.set(entry.id, ghostJson); }
    }
    for (const id of dropped) {
      this.memGhosts.delete(id);
      fs.unlink(path.join(this.ghostDir, `${id}.json`), () => {});
    }
    const file = path.join(this.dir, 'index.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, tables }));
    fs.renameSync(file + '.tmp', file);
  }

  async ghost(id) {
    if (this.memGhosts.has(id)) return this.memGhosts.get(id);
    try { return fs.readFileSync(path.join(this.ghostDir, `${id}.json`), 'utf8'); } catch { return null; }
  }
}

class PgBackend {
  /** @param {string|{query:Function}} db connection string, or anything with query(text, params) */
  constructor(db) {
    this.shared = true;
    if (typeof db === 'string') {
      const { Pool } = require('pg');
      this.pool = new Pool({ connectionString: db, max: 3, idleTimeoutMillis: 30000 });
      this.pool.on('error', err => console.warn('records db:', err.message));
      this.name = 'PostgreSQL';
    } else {
      this.pool = db;
      this.name = 'PostgreSQL (injected)';
    }
    this._init = null;
  }

  q(text, params) { return this.pool.query(text, params); }

  init() {
    if (!this._init) {
      this._init = (async () => {
        await this.q(`CREATE TABLE IF NOT EXISTS pke_records (
          id TEXT PRIMARY KEY,
          course INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          dist DOUBLE PRECISION NOT NULL,
          date BIGINT NOT NULL,
          entry JSONB NOT NULL,
          ghost TEXT
        )`);
        await this.q('CREATE INDEX IF NOT EXISTS pke_records_table ON pke_records (course, duration, dist DESC)');
      })().catch((err) => { this._init = null; throw err; });
    }
    return this._init;
  }

  async load() {
    await this.init();
    const { rows } = await this.q('SELECT entry FROM pke_records');
    const tables = {};
    for (const r of rows) {
      const e = typeof r.entry === 'string' ? JSON.parse(r.entry) : r.entry;
      (tables[`${e.course}-${e.duration}`] = tables[`${e.course}-${e.duration}`] || []).push(e);
    }
    for (const t of Object.values(tables)) sortTable(t);
    return tables;
  }

  async persist({ entry, ghostJson }) {
    if (!entry) return;
    await this.init();
    await this.q(
      'INSERT INTO pke_records (id, course, duration, dist, date, entry, ghost) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
      [entry.id, entry.course, entry.duration, entry.dist, entry.date, JSON.stringify(entry), ghostJson || null],
    );
    // keep the top 10 of that table (other servers may have added records meanwhile)
    await this.q(
      `DELETE FROM pke_records WHERE course = $1 AND duration = $2 AND id NOT IN (
         SELECT id FROM pke_records WHERE course = $1 AND duration = $2 ORDER BY dist DESC, date ASC LIMIT ${TOP})`,
      [entry.course, entry.duration],
    );
  }

  async ghost(id) {
    await this.init();
    const { rows } = await this.q('SELECT ghost FROM pke_records WHERE id = $1', [id]);
    return rows.length ? rows[0].ghost : null;
  }
}

// ------------------------------------------------------------
class RecordStore {
  /** @param {{dir?:string, databaseUrl?:string, db?:{query:Function}}} opt */
  constructor(opt = {}) {
    this.backend = opt.db ? new PgBackend(opt.db)
      : opt.databaseUrl ? new PgBackend(opt.databaseUrl)
        : new FileBackend(opt.dir || path.join(__dirname, 'data'));
    this.tables = {};
    this.pending = new Map();   // id -> {entry, ghostJson} not yet stored by the backend
    this.loadedAt = 0;
    this.ready = this.refresh();
  }

  get shared() { return !!this.backend.shared; }

  /** (re)load every table from the backend; records still being written are kept */
  async refresh() {
    try {
      const tables = await this.backend.load();
      for (const { entry } of this.pending.values()) {
        const k = this.key(entry.course, entry.duration);
        const t = (tables[k] = tables[k] || []);
        if (!t.some(e => e.id === entry.id)) { t.push(entry); sortTable(t).splice(TOP); }
      }
      this.tables = tables;
      this.loadedAt = Date.now();
      return true;
    } catch (err) {
      console.warn('records: could not load from', this.backend.name, '-', err.message);
      return false;
    }
  }

  /** refresh first when the cached tables are older than maxAge ms (shared database only) */
  async fresh(maxAge = 15000) {
    if (this.shared && Date.now() - this.loadedAt > maxAge) await this.refresh();
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

  /**
   * insert a record (ghost may be null: multiplayer races are ranked without one);
   * returns its rank (1..10), or 0 if it did not make the table
   */
  add(entry, ghost) {
    if (this.find(entry.id) || !this.wouldRank(entry.course, entry.duration, entry.dist)) return 0;
    entry.hasGhost = !!ghost;
    const k = this.key(entry.course, entry.duration);
    const t = (this.tables[k] = this.tables[k] || []);
    t.push(entry);
    sortTable(t);
    const dropped = t.splice(TOP).map(e => e.id);
    const rank = t.indexOf(entry) + 1;
    if (rank > 0) {
      const ghostJson = ghost ? JSON.stringify(ghost) : null;
      this.pending.set(entry.id, { entry, ghostJson });
      this.backend.persist({ tables: this.tables, entry, ghostJson, dropped })
        .then(() => this.pending.delete(entry.id))
        .catch((err) => {
          console.warn('records: could not save', err.message);
          // keep it pending: retried on the next refresh cycle
        });
    }
    return rank;
  }

  /** retry records whose write failed (e.g. the database was asleep) */
  async flush() {
    for (const { entry, ghostJson } of [...this.pending.values()]) {
      try {
        await this.backend.persist({ tables: this.tables, entry, ghostJson, dropped: [] });
        this.pending.delete(entry.id);
      } catch { /* try again later */ }
    }
  }

  /** ghost JSON string (or null) */
  async ghost(id) {
    if (!ID_RE.test(id)) return null;
    const p = this.pending.get(id);
    if (p) return p.ghostJson;
    const e = this.find(id);
    if (e && e.hasGhost === false) return null;
    try { return await this.backend.ghost(id); } catch { return null; }
  }

  /** a record uploaded again by the browser that owns it */
  restore(rawEntry, rawGhost, opt) {
    const entry = cleanEntry(rawEntry, opt);
    if (!entry) return { ok: false, error: 'bad record' };
    if (this.find(entry.id)) return { ok: true, rank: 0, exists: true };
    let ghost = null;
    if (entry.hasGhost) {
      ghost = cleanGhost(rawGhost, entry.duration);
      if (!ghost) return { ok: false, error: 'bad ghost' };
    }
    return { ok: true, rank: this.add(entry, ghost) };
  }
}

module.exports = { RecordStore, Recorder, PgBackend, FileBackend, genId, GHOST_HZ, TOP };
