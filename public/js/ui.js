// ============================================================
//  DOM UI: title / lobby / pit menu / pause / results / audio controls
// ============================================================
import { TYRES, TYRE_ORDER, SKILLS, SKILL_BY_ID, KART_COLORS, PIT } from './config.js';
import { sound } from './audio.js';
import { fmtLap, renderTrackMap } from './hud.js';
import { fetchRanking, RANKED_DURATIONS } from './records.js';

const $ = id => document.getElementById(id);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MAX_GHOSTS = 4;
const WEATHER_LABEL = { rain: '☂ 雨', fog: '🌫 霧' };

/** ids of ranking entries set by this browser (highlighted in the tables) */
export function myRecordIds() {
  try { return new Set(JSON.parse(localStorage.getItem('pke.myRecords') || '[]')); } catch { return new Set(); }
}
export function addMyRecordId(id) {
  const ids = [...myRecordIds(), id].slice(-200);
  try { localStorage.setItem('pke.myRecords', JSON.stringify(ids)); } catch { /* ignore */ }
}

function distText(dist, trackLen) {
  const laps = Math.max(0, Math.floor(dist));
  const pct = Math.round((Math.max(0, dist) - laps) * 100);
  return { km: (Math.max(0, dist) * trackLen / 1000).toFixed(2), laps: `${laps}周+${pct}%` };
}

function tyreSeq(tyres) {
  return `<span class="tyre-seq">${tyres.map(t => `<i style="background:${(TYRES[t] || TYRES.M).color}">${t}</i>`).join('<b>›</b>')}</span>`;
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const TYRE_STATS = {
  S: { speed: 5, grip: 5, life: 2, rain: 1 },
  M: { speed: 4, grip: 4, life: 3, rain: 1 },
  H: { speed: 3, grip: 3, life: 5, rain: 1 },
  W: { speed: 3, grip: 2, life: 3, rain: 5 },
};

export class UI {
  constructor(h) {
    this.h = h;
    this.dev = new URLSearchParams(location.search).has('dev');

    // title
    const nameInput = $('name-input');
    try { nameInput.value = localStorage.getItem('pke.name') || ''; } catch { /* ignore */ }
    $('btn-create').onclick = () => { sound.ensure(); sound.sfx('click'); h.onCreate(this.getName()); };
    $('btn-join').onclick = () => { sound.ensure(); sound.sfx('click'); h.onJoin(this.getName(), $('room-input').value.trim().toUpperCase()); };
    $('room-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });
    document.addEventListener('pointerdown', () => sound.ensure(), { once: true });

    // lobby
    $('btn-copy').onclick = () => this.copyRoomId();
    $('btn-leave').onclick = () => { sound.sfx('click'); h.onLeave(); };
    $('btn-add-bot').onclick = () => { sound.sfx('click'); h.onAddBot(); };
    $('btn-remove-bot').onclick = () => { sound.sfx('click'); h.onRemoveBot(); };
    $('btn-start').onclick = () => { sound.sfx('click'); h.onStart(); };
    $('btn-ready').onclick = () => { sound.sfx('click'); h.onReady(!this.myReady); };

    // ranking
    this.rankCache = new Map();   // "course-duration" -> {t, entries}
    this.rankView = { course: 0, duration: 300 };
    for (const b of document.querySelectorAll('.btn-ranking')) b.onclick = () => { sound.ensure(); sound.sfx('click'); this.openRanking(); };
    $('btn-ranking-close').onclick = () => { sound.sfx('click'); $('ranking-modal').classList.add('hidden'); };
    $('ranking-modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'ranking-modal') $('ranking-modal').classList.add('hidden'); });
    $('ranking-course').onchange = () => { this.rankView.course = Number($('ranking-course').value); this._renderRanking(); };

    // results / pause
    $('btn-back-lobby').onclick = () => { sound.sfx('click'); h.onBackToLobby(); };
    $('btn-resume').onclick = () => h.onResume();
    $('btn-respawn').onclick = () => { h.onResume(); h.onRespawn(); };
    $('btn-quit').onclick = () => h.onQuitRace();
    $('btn-pit-skip').onclick = () => { sound.sfx('click'); h.onPitSkip(); };

    // smartphone helpers
    for (const b of document.querySelectorAll('.fs-btn')) b.onclick = () => h.onFullscreen();
    this.autoAccelBoxes = [...document.querySelectorAll('.auto-accel')];
    for (const cb of this.autoAccelBoxes) cb.onchange = () => { h.onAutoAccel(cb.checked); this.syncAutoAccel(cb.checked); };

    // invite link
    this.publicUrl = null;
    fetch('/api/info').then(r => r.json()).then(info => { this.publicUrl = info.publicUrl || null; }).catch(() => {});
    if (!navigator.share) document.body.classList.add('no-share');
    $('btn-copy-link').onclick = () => this.copyInvite();
    $('btn-share-link').onclick = () => {
      navigator.share({ title: 'PIXEL KART ENDURANCE', text: `カートレースしよう！ ルームID: ${$('room-id').textContent}`, url: $('invite-link').value }).catch(() => {});
    };
    const invited = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (invited) {
      $('room-input').value = invited;
      const note = $('invite-note');
      note.textContent = `ルーム ${invited} に招待されています。名前を入れて「ルームに参加する」を押してください。`;
      note.classList.remove('hidden');
    }

    this._mountAudio();
    this._buildTyreCards($('tyre-select'), t => h.onSelectTyre(t), false);
    this._buildSkillCards();
    this._buildTyreCards($('pit-choices'), t => h.onPitChoose(t), true);
  }

  getName() {
    const n = $('name-input').value.trim().slice(0, 12) || 'RACER';
    try { localStorage.setItem('pke.name', n); } catch { /* ignore */ }
    return n;
  }

  show(screen) {
    for (const s of ['title', 'lobby', 'results']) $('screen-' + s).classList.toggle('hidden', s !== screen);
    if (screen !== 'race') { this.hidePitMenu(); this.setPause(false); }
  }

  setTitleError(msg) { $('title-error').textContent = msg || ''; }

  toast(msg, ms = 2000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  syncAutoAccel(on) {
    for (const cb of this.autoAccelBoxes) cb.checked = !!on;
  }

  /** invite link = public (tunnel) URL when known, else the current origin */
  updateInvite(roomId) {
    if (!this.publicUrl && !this._infoRetry) {
      // the tunnel URL may become known after the page loaded
      this._infoRetry = true;
      fetch('/api/info').then(r => r.json()).then(info => {
        this._infoRetry = false;
        if (info.publicUrl) { this.publicUrl = info.publicUrl; this.updateInvite(roomId); }
      }).catch(() => { this._infoRetry = false; });
    }
    const base = (this.publicUrl || location.origin).replace(/\/$/, '');
    $('invite-link').value = `${base}/?room=${roomId}`;
    const local = !this.publicUrl && /^(localhost|127\.|\[::1\])/.test(location.hostname);
    const warn = $('invite-warn');
    warn.classList.toggle('hidden', !local);
    warn.textContent = local
      ? 'いまは localhost で開いているため、このリンクは他の端末から開けません。友達と遊ぶときは share.bat（npm run share）で起動してください。'
      : '';
  }

  async copyInvite() {
    const link = $('invite-link').value;
    try {
      await navigator.clipboard.writeText(link);
      this.toast('招待リンクをコピーしました');
    } catch {
      $('invite-link').select();
      this.toast('リンクを選択しました（長押し/Ctrl+Cでコピー）');
    }
  }

  async copyRoomId() {
    const id = $('room-id').textContent;
    try {
      await navigator.clipboard.writeText(id);
      this.toast(`ルームID「${id}」をコピーしました`);
    } catch {
      const r = document.createRange();
      r.selectNodeContents($('room-id'));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      this.toast('ルームIDを選択しました（Ctrl+Cでコピー）');
    }
  }

  // ---------------- audio controls (mounted in several places, kept in sync) ----------------
  _mountAudio() {
    this.audioViews = [];
    for (const mount of document.querySelectorAll('.audio-mount')) {
      const view = {};
      for (const [key, label] of [['bgm', 'BGM'], ['se', 'SE']]) {
        const row = el('div', 'audio-row');
        row.appendChild(el('span', 'lbl', label));
        const range = el('input');
        range.type = 'range'; range.min = 0; range.max = 100; range.step = 1;
        const val = el('span', 'val');
        const mute = el('button', 'btn small');
        mute.type = 'button';
        range.oninput = () => { sound.ensure(); sound.setSettings({ [key]: range.value / 100 }); };
        range.onchange = () => { if (key === 'se') sound.sfx('click'); };
        mute.onclick = () => { sound.ensure(); sound.setSettings({ [key + 'Mute']: !sound.settings[key + 'Mute'] }); };
        row.append(range, val, mute);
        mount.appendChild(row);
        view[key] = { range, val, mute };
      }
      this.audioViews.push(view);
    }
    const sync = s => {
      for (const v of this.audioViews) {
        for (const key of ['bgm', 'se']) {
          v[key].range.value = Math.round(s[key] * 100);
          v[key].val.textContent = Math.round(s[key] * 100);
          const muted = s[key + 'Mute'];
          v[key].mute.textContent = muted ? 'ミュート中' : 'ON';
          v[key].mute.classList.toggle('on', !muted);
          v[key].mute.classList.toggle('danger', muted);
        }
      }
    };
    sound.onSettings(sync);
    sync(sound.settings);
  }

  // ---------------- tyre & skill cards ----------------
  _buildTyreCards(container, onPick, isPit) {
    container.innerHTML = '';
    const cards = {};
    TYRE_ORDER.forEach((id, i) => {
      const T = TYRES[id];
      const st = TYRE_STATS[id];
      const card = el('div', 'tyre-card');
      const pips = n => `<span class="pips">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>`;
      card.innerHTML = `
        <span class="key">[${i + 1}]</span>
        <div class="t-head"><span class="badge" style="background:${T.color}">${id}</span>${T.name}</div>
        <div class="stat"><span class="k">最高速</span>${pips(st.speed)}</div>
        <div class="stat"><span class="k">グリップ</span>${pips(st.grip)}</div>
        <div class="stat"><span class="k">耐久</span>${pips(st.life)}</div>
        <div class="stat"><span class="k">雨</span>${pips(st.rain)}</div>
        <div class="life">寿命 ${T.lifeText}</div>`;
      card.onclick = () => { sound.sfx('click'); onPick(id); };
      container.appendChild(card);
      cards[id] = card;
    });
    if (isPit) this.pitCards = cards; else this.tyreCards = cards;
  }

  _buildSkillCards() {
    const c = $('skill-select');
    c.innerHTML = '';
    this.skillCards = {};
    for (const s of SKILLS) {
      const card = el('div', 'skill-card');
      const type = s.type === 'active'
        ? `<span class="s-type active">アクティブ CT${s.cd}秒</span>`
        : '<span class="s-type passive">パッシブ</span>';
      card.innerHTML = `<div class="s-head"><span>${s.name}</span>${type}</div><div class="s-desc">${s.desc}</div>`;
      card.onclick = () => { sound.sfx('click'); this.h.onSelectSkill(s.id); };
      c.appendChild(card);
      this.skillCards[s.id] = card;
    }
  }

  /** course cards with pixel map previews (tracks = prebuilt Track objects) */
  setCourses(courses, tracks) {
    const c = $('course-select');
    c.innerHTML = '';
    this.courseCards = [];
    this.courses = courses;
    courses.forEach((course, i) => {
      const card = el('div', 'course-card');
      const map = renderTrackMap(tracks[i], 160, 104, { pad: 6, dot: 2 }).canvas;
      card.appendChild(map);
      card.appendChild(el('div', 'c-name', esc(course.name)));
      card.appendChild(el('div', 'c-meta', `${course.en} ・ ${(tracks[i].length / 1000).toFixed(2)}km`));
      card.onclick = () => { if (!card.classList.contains('locked')) { sound.sfx('click'); this.h.onCourse(i); } };
      c.appendChild(card);
      this.courseCards.push(card);
    });
    const desc = el('p', 'course-desc');
    desc.id = 'course-desc';
    c.after(desc);
    this.tracks = tracks;
    $('ranking-course').innerHTML = courses.map((co, i) => `<option value="${i}">${i + 1}. ${esc(co.name)}（${co.en}）</option>`).join('');
  }

  // ---------------- ranking ----------------
  /** cached ranking of a course & race length (refreshes after 20 s) */
  async ranking(course, duration, force = false) {
    const key = `${course}-${duration}`;
    const c = this.rankCache.get(key);
    if (!force && c && performance.now() - c.t < 20000) return c.entries;
    const entries = await fetchRanking(course, duration);
    this.rankCache.set(key, { t: performance.now(), entries });
    return entries;
  }

  invalidateRanking() { this.rankCache.clear(); }

  openRanking(course = null, duration = null) {
    if (course === null && this.room) course = this.room.course;
    if (duration === null && this.room && RANKED_DURATIONS.includes(this.room.duration)) duration = this.room.duration;
    if (course !== null) this.rankView.course = course;
    if (duration !== null) this.rankView.duration = duration;
    $('ranking-modal').classList.remove('hidden');
    this._renderRanking(true);
  }

  async _renderRanking(force = false) {
    const { course, duration } = this.rankView;
    $('ranking-course').value = String(course);
    const ds = $('ranking-duration');
    ds.innerHTML = '';
    for (const [sec, label] of [[300, '5分レース'], [900, '15分レース']]) {
      const b = el('button', 'btn small' + (duration === sec ? ' on' : ''), label);
      b.type = 'button';
      b.onclick = () => { sound.sfx('click'); this.rankView.duration = sec; this._renderRanking(); };
      ds.appendChild(b);
    }
    const body = $('ranking-body');
    body.innerHTML = '<tr><td colspan="7" class="ranking-empty">読み込み中…</td></tr>';
    const entries = await this.ranking(course, duration, force);
    if (this.rankView.course !== course || this.rankView.duration !== duration) return;
    body.innerHTML = '';
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="7" class="ranking-empty">まだ記録がありません。このコースでレースを最後まで走りきると記録されます。</td></tr>';
      return;
    }
    const mine = myRecordIds();
    const trackLen = this.tracks ? this.tracks[course].length : 1500;
    entries.forEach((e, i) => {
      const tr = el('tr', 'entry' + (mine.has(e.id) ? ' mine' : ''));
      const dt = distText(e.dist, trackLen);
      const skill = SKILL_BY_ID[e.skill] || SKILL_BY_ID.none;
      tr.innerHTML = `
        <td class="pos">${i + 1}</td>
        <td><span class="chip" style="background:${KART_COLORS[e.color % KART_COLORS.length]}"></span>${esc(e.name)}</td>
        <td>${dt.km} km<br><small>${dt.laps}</small></td>
        <td>${fmtLap(e.bestLap)}</td>
        <td>${esc(skill.name)}</td>
        <td>${tyreSeq(e.tyres)}</td>
        <td>${fmtDate(e.date)}</td>`;
      const detail = el('tr', 'detail hidden');
      const best = Math.min(...e.laps);
      const laps = e.laps.map((t, k) => `<span class="${t === best ? 'best' : ''}">L${k + 1} ${fmtLap(t)}</span>`).join('');
      const cond = [
        e.weather.length ? e.weather.map(w => WEATHER_LABEL[w]).join('・') : '☀ 晴れ',
        e.night ? '☾ 夜' : '昼',
        `${e.field}台で走行`,
        `ピット ${Math.max(0, e.tyres.length - 1)}回`,
      ];
      if (e.noSkills) cond.push('個性なしルール');
      detail.innerHTML = `<td colspan="7">${cond.join(' ・ ')}<div class="laps">${laps || 'ラップ記録なし'}</div></td>`;
      tr.onclick = () => detail.classList.toggle('hidden');
      body.append(tr, detail);
    });
  }

  /** lobby: pick ranking entries of this course & length to race as ghosts */
  async _renderGhosts(room, isHost) {
    const list = $('ghost-list');
    const note = $('ghost-note');
    note.textContent = isHost ? '（ホストが選択・最大4台）' : '（ホストが選択）';
    list.classList.toggle('locked', !isHost);
    if (!RANKED_DURATIONS.includes(room.duration)) {
      list.innerHTML = '<div class="ghost-empty">テスト1分のレースは記録・ゴーストの対象外です。</div>';
      return;
    }
    const key = `${room.course}-${room.duration}`;
    const entries = await this.ranking(room.course, room.duration);
    if (!this.room || `${this.room.course}-${this.room.duration}` !== key) return;
    const sel = new Set(this.room.ghosts || []);
    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = '<div class="ghost-empty">このコース・レース時間の記録はまだありません。走りきると上位10位までが記録されます。</div>';
      return;
    }
    const trackLen = this.tracks ? this.tracks[room.course].length : 1500;
    entries.forEach((e, i) => {
      const row = el('label', 'ghost-row' + (sel.has(e.id) ? ' on' : ''));
      row.style.borderLeftColor = KART_COLORS[e.color % KART_COLORS.length];
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = sel.has(e.id);
      cb.disabled = !isHost;
      cb.onchange = () => {
        const ids = (this.room.ghosts || []).filter(id => id !== e.id);
        if (cb.checked) {
          if (ids.length >= MAX_GHOSTS) { cb.checked = false; this.toast(`ゴーストは最大${MAX_GHOSTS}台までです`); return; }
          ids.push(e.id);
        }
        sound.sfx('click');
        this.h.onGhosts(ids);
      };
      const dt = distText(e.dist, trackLen);
      const skill = SKILL_BY_ID[e.skill] || SKILL_BY_ID.none;
      row.append(cb);
      row.insertAdjacentHTML('beforeend', `
        <span class="g-rank">${i + 1}位</span>
        <span class="g-name">${esc(e.name)}</span>
        <span class="g-dist">${dt.km}km ・ ${fmtLap(e.bestLap)} ・ ${esc(skill.name)}</span>`);
      list.appendChild(row);
    });
  }

  // ---------------- lobby ----------------
  renderLobby(room, myId, sel) {
    const isHost = room.hostId === myId;
    this.room = room;
    this._renderGhosts(room, isHost);
    document.body.classList.toggle('is-guest', !isHost);
    $('room-id').textContent = room.id;
    this.updateInvite(room.id);
    $('player-count').textContent = `(${room.players.length}/8)`;

    const list = $('player-list');
    list.innerHTML = '';
    for (const p of room.players) {
      const li = el('li', p.id === myId ? 'me' : '');
      li.style.borderLeftColor = KART_COLORS[p.color % KART_COLORS.length];
      const T = TYRES[p.tyre] || TYRES.M;
      const skill = room.noSkills ? SKILL_BY_ID.none : SKILL_BY_ID[p.skill];
      let tag = '';
      if (p.id === room.hostId) tag = '<span class="tag host">HOST</span>';
      else if (p.isBot) tag = '<span class="tag cpu">CPU</span>';
      else tag = p.ready ? '<span class="tag ready">準備OK</span>' : '<span class="tag wait">選択中</span>';
      li.innerHTML = `
        <span class="pname">${esc(p.name)}</span>
        ${tag}
        <span class="tyre-dot" style="background:${T.color}">${p.tyre}</span>
        <span class="pskill">${skill ? skill.name : ''}</span>`;
      list.appendChild(li);
    }

    // durations
    const ds = $('duration-select');
    ds.innerHTML = '';
    const opts = [[300, '通常 5分'], [900, '長時間 15分']];
    if (this.dev || room.duration === 60) opts.unshift([60, 'テスト 1分']);
    for (const [sec, label] of opts) {
      const b = el('button', 'btn small' + (room.duration === sec ? ' on' : ''), label);
      b.type = 'button';
      b.disabled = !isHost;
      b.onclick = () => { sound.sfx('click'); this.h.onDuration(sec); };
      ds.appendChild(b);
    }
    $('duration-note').textContent = isHost ? '（ホストのみ変更可）' : '（ホストが設定）';

    // course & time of day (host only)
    $('course-note').textContent = isHost ? '（ホストのみ変更可）' : '（ホストが設定）';
    (this.courseCards || []).forEach((card, i) => {
      card.classList.toggle('sel', i === room.course);
      card.classList.toggle('locked', !isHost);
    });
    if (this.courses && this.courses[room.course]) $('course-desc').textContent = this.courses[room.course].desc;
    const ts = $('time-select');
    ts.innerHTML = '';
    for (const [night, label] of [[false, '☀ 昼'], [true, '☾ 夜']]) {
      const b = el('button', 'btn small' + (!!room.night === night ? ' on' : ''), label);
      b.type = 'button';
      b.disabled = !isHost;
      b.onclick = () => { sound.sfx('click'); this.h.onNight(night); };
      ts.appendChild(b);
    }
    // race rules: weather changes, skills on/off (host only)
    const seg = (id, value, opts, onPick) => {
      const box = $(id);
      box.innerHTML = '';
      for (const [v, label] of opts) {
        const b = el('button', 'btn small' + (value === v ? ' on' : ''), label);
        b.type = 'button';
        b.disabled = !isHost;
        b.onclick = () => { sound.sfx('click'); onPick(v); };
        box.appendChild(b);
      }
    };
    seg('weather-select', room.weather !== false, [[true, '☂ 変化あり'], [false, '☀ 晴れのみ']], v => this.h.onWeather(v));
    seg('skillrule-select', !!room.noSkills, [[false, '個性あり'], [true, '個性なし']], v => this.h.onNoSkills(v));
    $('rule-note').textContent = (room.weather !== false
      ? '天候：基本は晴れ。ときどき雨や霧が発生（雨の路面ではウェットタイヤが有利）。'
      : '天候：レース中ずっと晴れ。') + (isHost ? '' : '（ルールはホストが設定）');
    $('noskill-note').classList.toggle('hidden', !room.noSkills);
    $('skill-select').classList.toggle('off', !!room.noSkills);

    $('btn-add-bot').disabled = room.players.length >= 8;
    $('btn-remove-bot').disabled = !room.players.some(p => p.isBot);

    // ready check: guests press READY, then the host starts the race
    const guests = room.players.filter(p => !p.isBot && p.id !== room.hostId);
    const readyN = guests.filter(p => p.ready).length;
    const allReady = readyN === guests.length;
    const me = room.players.find(p => p.id === myId);
    this.myReady = !isHost && !!(me && me.ready);
    $('ready-status').innerHTML = guests.length ? `準備OK <b>${readyN}</b> / ${guests.length}人` : '';
    const start = $('btn-start');
    start.disabled = !allReady;
    start.textContent = allReady
      ? (guests.length ? '全員準備OK！ レース開始！' : 'レース開始！')
      : `準備OK待ち… (${readyN}/${guests.length})`;
    const rb = $('btn-ready');
    rb.classList.toggle('on', this.myReady);
    rb.textContent = this.myReady ? '✔ 準備OK（押すと取り消し）' : '準備OK！';
    const wait = $('wait-msg');
    wait.textContent = !this.myReady
      ? 'タイヤと個性を選んだら「準備OK」を押してください'
      : allReady ? 'ホストの開始を待っています…' : 'ほかのプレイヤーの準備を待っています…';
    wait.classList.toggle('blink', this.myReady);
    $('tyre-select').classList.toggle('locked', this.myReady);
    $('skill-select').classList.toggle('locked', this.myReady);
    this.renderSelection(sel);
  }

  renderSelection(sel) {
    for (const [id, c] of Object.entries(this.tyreCards)) c.classList.toggle('sel', id === sel.tyre);
    for (const [id, c] of Object.entries(this.skillCards)) c.classList.toggle('sel', id === sel.skill);
  }

  // ---------------- pit ----------------
  showPitMenu(info) {
    $('pit-menu').classList.remove('hidden');
    $('pit-choices').classList.remove('hidden');
    $('pit-progress').classList.add('hidden');
    const q = info.err <= PIT.PERFECT ? ['perfect', 'PERFECT STOP!'] : info.err <= 1.5 ? ['good', 'GOOD STOP'] : ['ok', 'ズレあり…'];
    const wet = info.wet > 0.05 ? `<br><small>路面：ウェット ${Math.round(info.wet * 100)}%${info.wet > 0.4 ? '（ウェットタイヤ推奨）' : ''}</small>` : '';
    $('pit-quality').innerHTML = `<span class="${q[0]}">${q[1]}</span>　BOX ${info.box + 1} ・ ズレ ${info.err.toFixed(2)}m ・ 作業時間 約${info.time.toFixed(1)}秒${info.quick ? '（クイックピット）' : ''}${wet}`;
    for (const [id, c] of Object.entries(this.pitCards)) c.classList.toggle('sel', id === info.current);
  }

  showPitWork(progress, left, tyre) {
    $('pit-menu').classList.remove('hidden');
    $('pit-choices').classList.add('hidden');
    $('pit-progress').classList.remove('hidden');
    $('pit-bar').style.width = `${Math.round(progress * 100)}%`;
    $('pit-time').textContent = `${TYRES[tyre].name}に交換中… 残り ${left.toFixed(1)}秒`;
  }

  hidePitMenu() { $('pit-menu').classList.add('hidden'); }

  setPause(on) { $('pause-menu').classList.toggle('hidden', !on); }
  get paused() { return !$('pause-menu').classList.contains('hidden'); }

  setSkillButton(visible) { $('skill-btn').classList.toggle('hidden', !visible); }

  /** label of the on-screen skill button: name + READY / cooldown seconds */
  updateSkillButton(name, cd, keyText = '', jammed = false) {
    const sub = jammed ? `JAM ${Math.ceil(cd)}` : cd > 0 ? `CT ${Math.ceil(cd)}` : 'READY';
    const shown = document.body.classList.contains('touch') || !keyText ? sub : `${keyText} ${cd > 0 ? sub : ''}`;
    if (this._skillLabel === name + shown) return;
    this._skillLabel = name + shown;
    $('skill-btn-label').textContent = name;
    $('skill-btn-sub').textContent = shown;
    $('skill-btn').classList.toggle('cooldown', cd > 0);
  }

  setRotateHint(on) { $('rotate-hint').classList.toggle('hidden', !on); }

  // ---------------- results ----------------
  showResults(results, myId, trackLen) {
    this.show('results');
    const body = $('results-body');
    body.innerHTML = '';
    results.forEach((r, i) => {
      const tr = el('tr', r.id === myId ? 'me' : '');
      const km = Math.max(0, r.dist) * trackLen / 1000;
      const laps = Math.max(0, Math.floor(r.dist));
      const prog = Math.max(0, r.dist - laps);
      const tags = (r.isBot ? ' <small>(CPU)</small>' : '')
        + (r.isGhost ? '<span class="ghost-tag">GHOST</span>' : '')
        + (r.record ? `<span class="rank-badge">🏆 ランキング${r.record.rank}位</span>` : '');
      tr.innerHTML = `
        <td class="pos">${i + 1}</td>
        <td><span class="chip" style="background:${KART_COLORS[r.color % KART_COLORS.length]}${r.isGhost ? ';opacity:0.5' : ''}"></span>${esc(r.name)}${tags}</td>
        <td>${km.toFixed(2)} km</td>
        <td>${laps}周 +${Math.round(prog * 100)}%</td>
        <td>${fmtLap(r.bestLap)}</td>`;
      body.appendChild(tr);
    });
    const w = results[0];
    $('winner').textContent = w ? `★ WINNER: ${w.isGhost ? 'GHOST ' : ''}${w.name} ★` : '';
  }
}
