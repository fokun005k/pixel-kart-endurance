'use strict';
// ============================================================
//  Pixel Kart Endurance - game server
//  Express (static files) + Socket.io (rooms / sync / race timer)
//  + course rankings with ghost data (records.js)
// ============================================================
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { RecordStore, Recorder, genId, GHOST_HZ } = require('./records');

// optional .env file next to server.js (e.g. DATABASE_URL for the shared ranking).
// Real environment variables (Render's "Environment" page) take precedence.
try {
  for (const line of require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env */ }

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.disable('x-powered-by');
app.use(compression()); // gzip: three.module.js 1.3MB -> ~0.3MB per visitor
const server = http.createServer(app);
// small messages only: this server may be exposed to the internet through a tunnel
const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));
// Three.js is served straight from node_modules (no CDN needed)
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
// public URL for invite links: set by share.js (Cloudflare tunnel) or by Render (RENDER_EXTERNAL_URL)
app.get('/api/info', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null });
});

const MAX_ROOMS = 200;
const MAX_PLAYERS = 8;
const COURSE_COUNT = 17;                   // must match public/js/courses.js (7 circuits, 7 rally, 3 city)
const DURATIONS = [60, 300, 900];          // 60 = dev only (?dev=1)
const COUNTDOWN_MS = 5000;                 // READY(2s) + 3,2,1
const TICK_MS = 50;                        // 20Hz snapshots
const TYRES = ['S', 'M', 'H', 'W'];
const SKILLS = ['meister', 'junkie', 'offroader', 'sliphunter', 'quickpit',
  'nitro', 'smoke', 'aerojump', 'overclock', 'highroller', 'jammer'];
const BOT_SKILLS = ['meister', 'junkie', 'sliphunter', 'overclock', 'highroller'];
const CARS = ['yaris', 'eg6', 'impreza', 'evo', 'delta', 'p205'];   // rally car looks (public/js/config.js)
const RANKED_DURATIONS = [300, 900];       // test races (1 min) are not ranked
const MAX_GHOSTS = 4;

// ------------------------------------------------------------
//  Rankings & ghosts (HTTP, so that big ghosts are gzip-compressed)
// ------------------------------------------------------------
// DATABASE_URL (PostgreSQL) = one ranking shared by every server; otherwise files in data/
const records = new RecordStore({
  dir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  databaseUrl: process.env.DATABASE_URL || '',
});
// pick up records made on other servers, retry writes that failed
setInterval(() => { records.flush().then(() => records.fresh(55000)); }, 60000);
const restoreOpt = {
  courseCount: COURSE_COUNT, durations: RANKED_DURATIONS, tyres: TYRES, cars: CARS,
  skills: SKILLS.concat(['none']), cleanName: n => cleanName(n),
};

app.get('/api/ranking', async (req, res) => {
  const course = Number(req.query.course), duration = Number(req.query.duration);
  await records.fresh();
  res.set('Cache-Control', 'no-store');
  res.json({ course, duration, shared: records.shared, entries: records.list(course, duration) });
});
app.get('/api/records/ids', async (_req, res) => {
  await records.fresh();
  res.set('Cache-Control', 'no-store');
  res.json({ ids: records.ids() });
});
app.get('/api/ghost/:id', async (req, res) => {
  const json = await records.ghost(String(req.params.id));
  if (!json) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'public, max-age=86400');   // a ghost never changes
  res.type('json').send(json);
});
// a browser uploads its own record again (after the server lost its disk)
let restoreBudget = { t: 0, n: 0 };
app.post('/api/records/restore', express.json({ limit: '3mb' }), (req, res) => {
  const now = Date.now();
  if (now - restoreBudget.t > 60000) restoreBudget = { t: now, n: 0 };
  if (++restoreBudget.n > 120) return res.status(429).json({ ok: false, error: 'busy' });
  const body = req.body || {};
  res.json(records.restore(body.entry, body.ghost, restoreOpt));
});

/** @type {Map<string, any>} */
const rooms = new Map();

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(id));
  return id;
}

function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 12);
  return s || 'Racer';
}

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function freeColor(room) {
  const used = new Set([...room.players.values()].map(p => p.color));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return 0;
}

function humans(room) {
  return [...room.players.values()].filter(p => !p.isBot);
}

function lobbyView(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    duration: room.duration,
    course: room.course,
    night: room.night,
    weather: room.weather,
    noSkills: room.noSkills,
    ghosts: room.ghosts,
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, tyre: p.tyre, skill: p.skill, car: p.car, color: p.color, isBot: p.isBot,
      ready: p.isBot || p.ready,
    })),
  };
}

function broadcastLobby(room) {
  io.to(room.id).emit('lobby', lobbyView(room));
}

// guests who are not ready yet (the host's START press is the final OK)
function notReady(room) {
  return humans(room).filter(p => p.id !== room.hostId && !p.ready);
}

// rules changed: everyone has to confirm again
function resetReady(room) {
  for (const p of room.players.values()) p.ready = false;
}

function makePlayer(id, name, room, isBot = false) {
  return {
    id, name, isBot,
    tyre: isBot ? 'M' : 'M',
    skill: isBot ? BOT_SKILLS[Math.floor(Math.random() * BOT_SKILLS.length)] : 'meister',
    car: isBot ? CARS[Math.floor(Math.random() * CARS.length)] : 'yaris',
    color: freeColor(room),
    ready: false,
    state: null,
  };
}

// ------------------------------------------------------------
//  Weather: mostly sunny, with the occasional shower or fog bank.
//  Returns [{type: 'rain'|'fog', start, end}] in seconds from the green light;
//  clients fade each event in/out and integrate track wetness themselves.
// ------------------------------------------------------------
function rnd(a, b) { return a + Math.random() * (b - a); }

function genWeather(duration) {
  let count;
  if (duration <= 60) count = 1;                         // dev races: always show something
  else if (duration <= 300) count = Math.random() < 0.3 ? 1 : 0;           // 5 min: 70% sunny
  else { const r = Math.random(); count = r < 0.4 ? 0 : r < 0.9 ? 1 : 2; } // 15 min: 40% sunny
  const events = [];
  // one event per equal slice of the race, so events never overlap
  const slice = duration / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const type = Math.random() < 0.6 ? 'rain' : 'fog';
    const lo = i * slice, hi = (i + 1) * slice;
    let len = duration <= 60 ? 35 : type === 'rain' ? rnd(70, 150) : rnd(50, 100);
    len = Math.min(len, hi - lo - 20);
    const start = duration <= 60 ? 8 : rnd(lo + Math.min(40, slice * 0.2), Math.max(lo + 20, hi - len - 10));
    events.push({ type, start: Math.round(start), end: Math.round(Math.min(duration - 5, start + len)) });
  }
  return events;
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    x: num(s.x), y: num(s.y), z: num(s.z), h: num(s.h), v: num(s.v), st: num(s.st),
    d: num(s.d, -1), lap: Math.trunc(num(s.lap)), tt: TYRES.includes(s.tt) ? s.tt : 'M',
    tw: Math.max(0, Math.min(100, num(s.tw, 100))), b: s.b ? 1 : 0, p: s.p ? 1 : 0,
    bl: num(s.bl, 0), ll: num(s.ll, 0),
  };
}

// ------------------------------------------------------------
function startRace(room) {
  const now = Date.now();
  room.status = 'countdown';
  room.startAt = now + COUNTDOWN_MS;
  room.endAt = room.startAt + room.duration * 1000;
  // grid: humans in join order, then bots
  const order = [...room.players.values()].sort((a, b) => (a.isBot - b.isBot));
  const grid = order.map((p, i) => ({ id: p.id, slot: i }));
  for (const p of room.players.values()) p.state = null;
  room.wx = room.weather ? genWeather(room.duration) : [];
  // every human is recorded for the ranking; a ghost is only made when racing alone
  // (with or without CPUs / ghosts)
  room.rec = new Map(humans(room).map(p => [p.id, new Recorder()]));
  room.solo = humans(room).length === 1;
  room.ghosts = room.ghosts.filter(id => ghostOk(room, id));
  io.to(room.id).emit('raceInit', {
    serverNow: now,
    startAt: room.startAt,
    endAt: room.endAt,
    duration: room.duration,
    grid,
    weather: room.wx,
    ghosts: room.ghosts.map(id => records.find(id)),
    room: lobbyView(room),
  });
}

/** a ranking entry that can race as a ghost in this room */
function ghostOk(room, id) {
  const e = records.find(id);
  return !!e && e.hasGhost !== false && e.course === room.course && e.duration === room.duration;
}

/** put every human who finished the race into the course ranking */
function recordResults(room) {
  const out = {};
  if (!room.rec || !RANKED_DURATIONS.includes(room.duration)) return out;
  const field = room.players.size;
  for (const p of humans(room)) {
    const rec = room.rec.get(p.id);
    if (!rec || !p.state || p.state.d <= 0) continue;
    const dist = p.state.d;
    if (!records.wouldRank(room.course, room.duration, dist)) continue;
    const entry = {
      id: genId(), course: room.course, duration: room.duration,
      name: p.name, color: p.color,
      skill: room.noSkills ? 'none' : p.skill,
      tyres: rec.tyres, laps: rec.laps, car: p.car,
      lapCount: Math.max(0, Math.floor(dist)),
      dist: Math.round(dist * 1e5) / 1e5,
      bestLap: p.state.bl || (rec.laps.length ? Math.min(...rec.laps) : 0),
      date: Date.now(), night: room.night,
      weather: room.wx.map(w => w.type), noSkills: room.noSkills, field,
    };
    const ghost = room.solo && rec.n >= GHOST_HZ * 10 ? rec.ghost() : null;
    if (records.add(entry, ghost)) out[p.id] = { rank: 0, id: entry.id };
  }
  // final ranks (several players of the same race may have pushed each other down)
  const table = records.list(room.course, room.duration);
  for (const [pid, r] of Object.entries(out)) {
    r.rank = table.findIndex(e => e.id === r.id) + 1;
    if (!r.rank) delete out[pid];
  }
  return out;
}

function endRace(room) {
  room.status = 'lobby';
  const ranked = recordResults(room);
  room.rec = null;
  const results = [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    isBot: p.isBot,
    dist: p.state ? p.state.d : -1,
    lap: p.state ? p.state.lap : 0,
    bestLap: p.state ? p.state.bl : 0,
    tyre: p.state ? p.state.tt : p.tyre,
    record: ranked[p.id] || null,     // {rank, id} when it entered the course ranking
  })).sort((a, b) => b.dist - a.dist);
  io.to(room.id).emit('raceEnd', { results });
  for (const p of room.players.values()) p.state = null;
  resetReady(room);
  broadcastLobby(room);
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  socket.data.roomId = null;
  socket.leave(roomId);
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.delete(socket.id);
  io.to(room.id).emit('playerLeft', { id: socket.id });

  if (humans(room).length === 0) {
    rooms.delete(room.id);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = humans(room)[0].id;
    // bots are simulated by the host client, so they cannot survive a host change mid-race
    if (room.status !== 'lobby') {
      for (const p of [...room.players.values()]) {
        if (p.isBot) {
          room.players.delete(p.id);
          io.to(room.id).emit('playerLeft', { id: p.id });
        }
      }
    }
  }
  broadcastLobby(room);
}

// ------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.roomId = null;

  socket.on('timeSync', (_t0, cb) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  socket.on('createRoom', (data, cb) => {
    if (typeof cb !== 'function') return;
    const now = Date.now();
    if (now - (socket.data.lastCreate || 0) < 1500) return cb({ ok: false, error: '少し待ってから作成してください' });
    socket.data.lastCreate = now;
    if (rooms.size >= MAX_ROOMS) return cb({ ok: false, error: 'サーバーが混雑しています' });
    leaveRoom(socket);
    const room = {
      id: genRoomId(),
      hostId: socket.id,
      duration: 300,
      course: 0,
      night: false,
      weather: false,      // sunny by default; the host can enable random rain / fog
      noSkills: false,     // everyone races without skills
      ghosts: [],          // ranking entries raced as ghosts
      status: 'lobby',
      players: new Map(),
      startAt: 0,
      endAt: 0,
      botSeq: 0,
    };
    rooms.set(room.id, room);
    const p = makePlayer(socket.id, cleanName(data && data.name), room);
    room.players.set(socket.id, p);
    socket.join(room.id);
    socket.data.roomId = room.id;
    cb({ ok: true, roomId: room.id, you: socket.id });
    broadcastLobby(room);
  });

  socket.on('joinRoom', (data, cb) => {
    if (typeof cb !== 'function') return;
    const roomId = String((data && data.roomId) || '').trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) return cb({ ok: false, error: 'ルームが見つかりません' });
    if (room.status !== 'lobby') return cb({ ok: false, error: 'レース中のため参加できません' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'ルームが満員です' });
    leaveRoom(socket);
    const p = makePlayer(socket.id, cleanName(data && data.name), room);
    room.players.set(socket.id, p);
    socket.join(room.id);
    socket.data.roomId = room.id;
    cb({ ok: true, roomId: room.id, you: socket.id });
    broadcastLobby(room);
  });

  socket.on('leaveRoom', () => leaveRoom(socket));

  socket.on('updatePlayer', (data) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status !== 'lobby' || !data) return;
    const p = room.players.get(socket.id);
    if (!p || p.ready) return;          // choices are locked while READY
    if (TYRES.includes(data.tyre)) p.tyre = data.tyre;
    if (SKILLS.includes(data.skill)) p.skill = data.skill;
    if (CARS.includes(data.car)) p.car = data.car;
    broadcastLobby(room);
  });

  socket.on('setReady', (on) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status !== 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !!on;
    broadcastLobby(room);
  });

  // host-only race rules. Any change sends the guests back to "not ready".
  const hostRoom = () => {
    const room = rooms.get(socket.data.roomId);
    return room && room.hostId === socket.id && room.status === 'lobby' ? room : null;
  };
  const setRule = (key, value) => {
    const room = hostRoom();
    if (!room || room[key] === value) return;
    room[key] = value;
    if (key === 'course' || key === 'duration') room.ghosts = [];   // ghosts belong to one course & length
    resetReady(room);
    broadcastLobby(room);
  };

  // ghosts from the ranking of the current course & race length
  socket.on('setGhosts', (ids) => {
    const room = hostRoom();
    if (!room || !Array.isArray(ids)) return;
    const ok = [...new Set(ids.map(String))].filter(id => ghostOk(room, id)).slice(0, MAX_GHOSTS);
    if (ok.join() === room.ghosts.join()) return;
    room.ghosts = ok;
    resetReady(room);
    broadcastLobby(room);
  });

  socket.on('setDuration', (sec) => {
    const d = Number(sec);
    if (DURATIONS.includes(d)) setRule('duration', d);
  });

  socket.on('setCourse', (id) => {
    const c = Number(id);
    if (Number.isInteger(c) && c >= 0 && c < COURSE_COUNT) setRule('course', c);
  });

  socket.on('setNight', (on) => setRule('night', !!on));
  socket.on('setWeather', (on) => setRule('weather', !!on));
  socket.on('setNoSkills', (on) => setRule('noSkills', !!on));

  socket.on('addBot', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    if (room.players.size >= MAX_PLAYERS) return;
    room.botSeq += 1;
    const id = `bot-${room.id}-${room.botSeq}`;
    const bot = makePlayer(id, `CPU ${room.botSeq}`, room, true);
    bot.tyre = ['M', 'H'][Math.floor(Math.random() * 2)];
    room.players.set(id, bot);
    broadcastLobby(room);
  });

  socket.on('removeBot', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    const bots = [...room.players.values()].filter(p => p.isBot);
    if (bots.length) room.players.delete(bots[bots.length - 1].id);
    broadcastLobby(room);
  });

  socket.on('startRace', (_data, cb) => {
    const room = hostRoom();
    if (!room) return;
    const waiting = notReady(room);
    if (waiting.length) {
      if (typeof cb === 'function') cb({ ok: false, error: `${waiting.map(p => p.name).join('、')} の準備OK待ちです` });
      return;
    }
    startRace(room);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('state', (s) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status === 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const st = sanitizeState(s);
    if (!st) return;
    p.state = st;
    const rec = room.rec && room.status === 'racing' && room.rec.get(socket.id);
    if (rec) rec.observe(st);
  });

  socket.on('botStates', (arr) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status === 'lobby' || room.hostId !== socket.id || !Array.isArray(arr)) return;
    for (const s of arr) {
      const p = s && room.players.get(s.id);
      if (!p || !p.isBot) continue;
      const st = sanitizeState(s);
      if (st) p.state = st;
    }
  });

  // active skill events (smoke screen, nitro flame, jump, jammer...) relayed to everyone else
  socket.on('skill', (evt) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status === 'lobby' || room.noSkills || !evt) return;
    const p = room.players.get(socket.id);
    const type = String(evt.type || '');
    if (!p || p.skill !== type || !['nitro', 'smoke', 'aerojump', 'jammer'].includes(type)) return;
    const out = { id: socket.id, type };
    if (type === 'jammer') {
      // every rival ahead in the race order (chosen by the sender)
      const targets = Array.isArray(evt.targets) ? [...new Set(evt.targets.map(String))] : [];
      out.targets = targets.filter(t => t !== socket.id && room.players.has(t)).slice(0, MAX_PLAYERS);
      if (!out.targets.length) return;
    }
    socket.to(room.id).emit('skill', out);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

// ------------------------------------------------------------
//  Race timer / snapshot loop
// ------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.status === 'lobby') continue;
    if (room.status === 'countdown' && now >= room.startAt) room.status = 'racing';
    if (room.status === 'racing' && now >= room.endAt) {
      endRace(room);
      continue;
    }
    if (room.status === 'racing' && room.rec) {
      const idx = Math.floor(((now - room.startAt) / 1000) * GHOST_HZ);
      for (const [id, rec] of room.rec) {
        const p = room.players.get(id);
        if (!p || !p.state || !room.solo) continue;   // ghost samples: solo races only
        while (rec.n <= idx) rec.sample(p.state);
      }
    }
    const players = [];
    for (const p of room.players.values()) {
      if (p.state) players.push({ id: p.id, ...p.state });
    }
    io.to(room.id).volatile.emit('snapshot', {
      t: now,
      rem: Math.max(0, room.endAt - now),
      status: room.status,
      players,
    });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log('==============================================');
  console.log(`  PIXEL KART ENDURANCE server running`);
  console.log(`  -> http://localhost:${PORT}`);
  console.log(`  ranking: ${records.backend.name}${records.shared ? ' (shared)' : ''}`);
  console.log('==============================================');
});
