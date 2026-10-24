// ============================================================
//  Course rankings & ghosts (client side)
//  - fetches the top 10 of a course / race length and ghost data from the server
//  - replays a ghost (whole race, 10 Hz, interpolated)
//  - keeps a copy of the player's own records in IndexedDB and uploads them
//    again when the server has lost them (free hosts wipe their disk)
// ============================================================
const TYRE_BY_IDX = ['S', 'M', 'H', 'W'];

export const RANKED_DURATIONS = [300, 900];

/** whether the server's ranking is shared by every server (database) or local to it */
export let rankingShared = null;

export async function fetchRanking(course, duration) {
  try {
    const r = await fetch(`/api/ranking?course=${course}&duration=${duration}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    rankingShared = !!j.shared;
    return j.entries || [];
  } catch { return []; }
}

const ghostCache = new Map();   // id -> Promise<raw ghost | null>

export function fetchGhostRaw(id) {
  if (!ghostCache.has(id)) {
    ghostCache.set(id, fetch(`/api/ghost/${encodeURIComponent(id)}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((g) => { if (!g) ghostCache.delete(id); return g; }));
  }
  return ghostCache.get(id);
}

/** raw (delta-encoded ints) -> typed arrays in world units */
export function decodeGhost(g) {
  const n = g.n;
  const plain = (a, k) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i] * k; return o; };
  const sum = (a, k) => { const o = new Float64Array(n); let acc = 0; for (let i = 0; i < n; i++) { acc += a[i]; o[i] = acc * k; } return o; };
  return {
    n, hz: g.hz,
    x: sum(g.x, 0.1), z: sum(g.z, 0.1), h: sum(g.h, 0.01), d: sum(g.d, 1e-4),
    y: plain(g.y, 0.1), v: plain(g.sp, 0.1), st: plain(g.s, 0.1), f: g.f,
  };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** replays a recorded race: at(t) with t = seconds since the green light */
export class GhostPlayer {
  constructor(entry, raw) {
    this.entry = entry;
    this.g = decodeGhost(raw);
  }

  at(t) {
    const g = this.g;
    const f = Math.max(0, Math.min(g.n - 1, t * g.hz));
    const i = Math.min(g.n - 2, Math.floor(f));
    if (i < 0) return this._sample(0, 0);
    return this._sample(i, f - i);
  }

  _sample(i, k) {
    const g = this.g, j = Math.min(g.n - 1, i + 1);
    const lerp = a => a[i] + (a[j] - a[i]) * k;
    const flags = g.f[k < 0.5 ? i : j];
    return {
      x: lerp(g.x), z: lerp(g.z), y: lerp(g.y), d: lerp(g.d), v: lerp(g.v), st: lerp(g.st),
      h: g.h[i] + wrapAngle(g.h[j] - g.h[i]) * k,
      tt: TYRE_BY_IDX[flags & 3], b: !!(flags & 4), p: !!(flags & 8),
    };
  }
}

// ------------------------------------------------------------
//  Local backup of the player's own records (IndexedDB)
// ------------------------------------------------------------
const DB_NAME = 'pke-records';
const STORE = 'mine';
const KEEP = 10;   // per course & race length

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

async function allMine() {
  try { return (await tx('readonly', s => s.getAll())) || []; } catch { return []; }
}

async function deleteMine(id) {
  try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
}

/** after a race: keep a copy of my new record (entry + ghost, if it has one) */
export async function backupMine(course, duration, id) {
  try {
    const entry = (await fetchRanking(course, duration)).find(e => e.id === id);
    if (!entry) return;
    const ghost = entry.hasGhost === false ? null : await fetchGhostRaw(id);
    if (entry.hasGhost !== false && !ghost) return;
    await tx('readwrite', s => s.put({ id, entry, ghost }));
    // only the best few per course & length are worth keeping
    const mine = (await allMine()).filter(r => r.entry.course === course && r.entry.duration === duration)
      .sort((a, b) => b.entry.dist - a.entry.dist);
    for (const r of mine.slice(KEEP)) await deleteMine(r.id);
  } catch { /* storage unavailable (private mode etc.) */ }
}

/** upload my records the server does not have any more */
export async function syncMine() {
  try {
    const mine = await allMine();
    if (!mine.length) return 0;
    const r = await fetch('/api/records/ids', { cache: 'no-store' });
    if (!r.ok) return 0;
    const have = new Set((await r.json()).ids || []);
    let restored = 0;
    for (const rec of mine.sort((a, b) => b.entry.dist - a.entry.dist)) {
      if (have.has(rec.id)) continue;
      const res = await fetch('/api/records/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: rec.entry, ghost: rec.ghost }),
      }).then(x => x.json()).catch(() => null);
      if (!res) continue;
      if (res.ok && res.rank) restored++;
      else if (res.ok && !res.exists) await deleteMine(rec.id);   // pushed out of the top 10 for good
    }
    return restored;
  } catch { return 0; }
}
