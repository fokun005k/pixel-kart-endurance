'use strict';
// ============================================================
//  Pixel Kart Endurance - game server
//  Express (static files) + Socket.io (rooms / sync / race timer)
// ============================================================
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

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
const COURSE_COUNT = 6;                    // must match public/js/courses.js
const DURATIONS = [60, 300, 900];          // 60 = dev only (?dev=1)
const COUNTDOWN_MS = 5000;                 // READY(2s) + 3,2,1
const TICK_MS = 50;                        // 20Hz snapshots
const TYRES = ['S', 'M', 'H'];
const TRANS = ['AT', 'MT'];
const SKILLS = ['meister', 'junkie', 'offroader', 'sliphunter', 'quickpit',
  'nitro', 'smoke', 'aerojump', 'overclock', 'highroller'];
const BOT_SKILLS = ['meister', 'junkie', 'sliphunter', 'overclock', 'highroller'];

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
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, tyre: p.tyre, skill: p.skill, trans: p.trans, color: p.color, isBot: p.isBot,
    })),
  };
}

function broadcastLobby(room) {
  io.to(room.id).emit('lobby', lobbyView(room));
}

function makePlayer(id, name, room, isBot = false) {
  return {
    id, name, isBot,
    tyre: isBot ? 'M' : 'M',
    skill: isBot ? BOT_SKILLS[Math.floor(Math.random() * BOT_SKILLS.length)] : 'meister',
    trans: 'AT',
    color: freeColor(room),
    state: null,
  };
}

function sanitizeState(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    x: num(s.x), y: num(s.y), z: num(s.z), h: num(s.h), v: num(s.v), st: num(s.st),
    d: num(s.d, -1), lap: Math.trunc(num(s.lap)), tt: TYRES.includes(s.tt) ? s.tt : 'M',
    tw: Math.max(0, Math.min(100, num(s.tw, 100))), b: s.b ? 1 : 0, p: s.p ? 1 : 0,
    bl: num(s.bl, 0),
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
  io.to(room.id).emit('raceInit', {
    serverNow: now,
    startAt: room.startAt,
    endAt: room.endAt,
    duration: room.duration,
    grid,
    room: lobbyView(room),
  });
}

function endRace(room) {
  room.status = 'lobby';
  const results = [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    isBot: p.isBot,
    dist: p.state ? p.state.d : -1,
    lap: p.state ? p.state.lap : 0,
    bestLap: p.state ? p.state.bl : 0,
    tyre: p.state ? p.state.tt : p.tyre,
  })).sort((a, b) => b.dist - a.dist);
  io.to(room.id).emit('raceEnd', { results });
  for (const p of room.players.values()) p.state = null;
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
    if (!p) return;
    if (TYRES.includes(data.tyre)) p.tyre = data.tyre;
    if (SKILLS.includes(data.skill)) p.skill = data.skill;
    if (TRANS.includes(data.trans)) p.trans = data.trans;
    broadcastLobby(room);
  });

  socket.on('setDuration', (sec) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    const d = Number(sec);
    if (DURATIONS.includes(d)) {
      room.duration = d;
      broadcastLobby(room);
    }
  });

  socket.on('setCourse', (id) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    const c = Number(id);
    if (Number.isInteger(c) && c >= 0 && c < COURSE_COUNT) {
      room.course = c;
      broadcastLobby(room);
    }
  });

  socket.on('setNight', (on) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    room.night = !!on;
    broadcastLobby(room);
  });

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

  socket.on('startRace', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    startRace(room);
  });

  socket.on('state', (s) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status === 'lobby') return;
    const p = room.players.get(socket.id);
    if (!p) return;
    const st = sanitizeState(s);
    if (st) p.state = st;
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

  // active skill events (smoke screen, nitro flame, jump...) relayed to everyone else
  socket.on('skill', (evt) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.status === 'lobby' || !evt) return;
    const type = String(evt.type || '');
    if (!['nitro', 'smoke', 'aerojump'].includes(type)) return;
    socket.to(room.id).emit('skill', { id: socket.id, type });
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
  console.log('==============================================');
});
