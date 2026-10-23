// ============================================================
//  Socket.io client wrapper + server clock synchronisation
// ============================================================
/* global io */

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Net {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.offset = 0;
    this.connected = false;
    this.socket.on('connect', () => {
      this.connected = true;
      this.syncTime();
    });
    this.socket.on('disconnect', () => { this.connected = false; });
    setInterval(() => { if (this.connected) this.syncTime(3); }, 15000);
  }

  get id() { return this.socket.id; }

  on(evt, fn) { this.socket.on(evt, fn); }

  _ask(evt, payload, timeout = 5000) {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, error: 'サーバーから応答がありません' }), timeout);
      this.socket.emit(evt, payload, (res) => { clearTimeout(t); resolve(res); });
    });
  }

  async syncTime(rounds = 6) {
    let best = Infinity;
    for (let i = 0; i < rounds; i++) {
      const t0 = Date.now();
      const st = await new Promise((res) => {
        const to = setTimeout(() => res(null), 2000);
        this.socket.emit('timeSync', t0, (v) => { clearTimeout(to); res(v); });
      });
      const t1 = Date.now();
      if (typeof st === 'number' && t1 - t0 < best) {
        best = t1 - t0;
        this.offset = st - (t0 + t1) / 2;
      }
      await sleep(60);
    }
  }

  serverNow() { return Date.now() + this.offset; }

  createRoom(name) { return this._ask('createRoom', { name }); }
  joinRoom(name, roomId) { return this._ask('joinRoom', { name, roomId }); }
  leaveRoom() { this.socket.emit('leaveRoom'); }
  updatePlayer(data) { this.socket.emit('updatePlayer', data); }
  setDuration(sec) { this.socket.emit('setDuration', sec); }
  setCourse(id) { this.socket.emit('setCourse', id); }
  setNight(on) { this.socket.emit('setNight', !!on); }
  setWeather(on) { this.socket.emit('setWeather', !!on); }
  setNoSkills(on) { this.socket.emit('setNoSkills', !!on); }
  setReady(on) { this.socket.emit('setReady', !!on); }
  setGhosts(ids) { this.socket.emit('setGhosts', ids); }
  addBot() { this.socket.emit('addBot'); }
  removeBot() { this.socket.emit('removeBot'); }
  startRace() { return this._ask('startRace', {}); }
  sendState(s) { this.socket.volatile.emit('state', s); }
  sendBotStates(arr) { this.socket.volatile.emit('botStates', arr); }
  sendSkill(type, targets) { this.socket.emit('skill', targets ? { type, targets } : { type }); }
}
