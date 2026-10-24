// ============================================================
//  DOM UI: title / lobby / pit menu / pause / results / audio controls
// ============================================================
import { TYRES, TYRE_ORDER, SKILLS, SKILL_BY_ID, KART_COLORS, PIT, CARS, CAR_BY_ID } from './config.js';
import { sound } from './audio.js';
import { fmtLap, renderTrackMap } from './hud.js';
import { fetchRanking, RANKED_DURATIONS, rankingShared } from './records.js';

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
const KINDS = [['circuit', '🏁 サーキット'], ['rally', '🌲 ラリー'], ['city', '🏙 市街地']];

/** side view of a rally car in pixel art (for the car picker) */
export function drawCarSide(carId, colorHex, W = 96, H = 40) {
  const S = (CAR_BY_ID[carId] || CAR_BY_ID.yaris).shape;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const k = (W - 8) / 4.6;                 // pixels per metre
  const gy = H - 3;                        // ground line
  const x0 = Math.round((W - S.len * k) / 2);
  const Y = m => Math.round(gy - m * k);
  const X = m => Math.round(x0 + m * k);   // m = metres from the front bumper
  const rows = (top, bot, xa0, xa1, xb0, xb1, col) => {
    // fill a trapezoid row by row (crisp pixels): x range goes from [xa0,xa1] at top to [xb0,xb1] at bottom
    for (let y = top; y < bot; y++) {
      const t = (y - top) / Math.max(1, bot - top);
      const l = Math.round(xa0 + (xb0 - xa0) * t), r = Math.round(xa1 + (xb1 - xa1) * t);
      g.fillStyle = col; g.fillRect(l, y, r - l, 1);
    }
  };
  const y0 = 0.24, top = y0 + S.bodyH;
  const cf = S.len / 2 + S.cabZ - S.cab / 2, cr = cf + S.cab;   // cabin front / rear (from the front bumper)
  // body
  g.fillStyle = colorHex; g.fillRect(X(0), Y(top), Math.round(S.len * k), Y(y0) - Y(top));
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(X(0), Y(top), Math.round(S.len * k), 1);
  g.fillStyle = '#f4f4f4'; g.fillRect(X(0.1), Y(y0 + S.bodyH * 0.3), Math.round((S.len - 0.2) * k), 2);
  // cabin: sloped windscreen, hatch or boot at the back
  const back = S.trunk ? cr - 0.35 : Math.min(S.len - 0.05, cr);
  rows(Y(top + S.cabH), Y(top), X(cf + 0.45), X(back - (S.trunk ? 0.1 : 0.25)), X(cf), X(back), colorHex);
  rows(Y(top + S.cabH) + 2, Y(top) - 1, X(cf + 0.5), X(back - (S.trunk ? 0.18 : 0.32)), X(cf + 0.12), X(back - 0.08), '#1e2a3a');
  g.fillStyle = colorHex; g.fillRect(X((cf + back) / 2), Y(top + S.cabH), 2, Y(top) - Y(top + S.cabH));
  // wing / spoiler
  if (S.wing === 1) { g.fillStyle = colorHex; g.fillRect(X(back - 0.35), Y(top + S.cabH) - 1, Math.round(0.4 * k), 2); }
  if (S.wing >= 2) {
    const h = S.wing === 3 ? 0.45 : 0.32;
    g.fillStyle = '#1a1a1e'; g.fillRect(X(S.len - 0.35), Y(top + h), 2, Y(top) - Y(top + h));
    g.fillStyle = colorHex; g.fillRect(X(S.len - 0.55), Y(top + h) - 1, Math.round(0.5 * k), 3);
  }
  if (S.scoop) { g.fillStyle = '#1a1a1e'; g.fillRect(X(0.7), Y(top) - 2, Math.round(0.45 * k), 2); }
  // lights, number
  g.fillStyle = '#fff4c0'; g.fillRect(X(0), Y(top) + 2, 2, 3);
  g.fillStyle = '#ff3030'; g.fillRect(X(S.len) - 2, Y(top) + 2, 2, 3);
  if (S.pod) { g.fillStyle = '#fff4c0'; g.fillRect(X(0) + 1, Y(top) - 2, 4, 2); }
  g.fillStyle = '#f4f4f4'; g.fillRect(X(cf + 0.3), Y(top) + 2, 7, 5);
  // wheels (+ arches)
  const wb = S.len * 0.31;
  for (const m of [S.len / 2 - wb, S.len / 2 + wb]) {
    const cx = X(m), cy = Y(0.33), r = Math.round(0.33 * k);
    if (S.flares) { g.fillStyle = colorHex; g.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, 3); }
    g.fillStyle = '#18181c';
    for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); g.fillRect(cx - w, cy + dy, w * 2, 1); }
    g.fillStyle = '#c8c8d0'; g.fillRect(cx - 2, cy - 2, 4, 4);
  }
  return c;
}
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
    this.courseKind = 'circuit';
    const ks = $('course-kind');
    ks.innerHTML = '';
    this.kindBtns = {};
    for (const [k, label] of KINDS) {
      const b = el('button', 'btn small', `${label}（${courses.filter(co => (co.kind || 'circuit') === k).length}）`);
      b.type = 'button';
      b.onclick = () => { sound.sfx('click'); this.showCourseKind(k); };
      ks.appendChild(b);
      this.kindBtns[k] = b;
    }
    courses.forEach((course, i) => {
      const card = el('div', 'course-card');
      card.dataset.kind = course.kind || 'circuit';
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
    $('ranking-course').innerHTML = KINDS.map(([k, label]) => `<optgroup label="${label}">${courses
      .map((co, i) => ((co.kind || 'circuit') === k ? `<option value="${i}">${esc(co.name)}（${co.en}）</option>` : ''))
      .join('')}</optgroup>`).join('');
    this.showCourseKind('circuit');
    this._buildCarCards();
  }

  /** lobby: show only the course cards of one category */
  showCourseKind(kind) {
    this.courseKind = kind;
    for (const [k, b] of Object.entries(this.kindBtns)) b.classList.toggle('on', k === kind);
    for (const card of this.courseCards) card.classList.toggle('other-kind', card.dataset.kind !== kind);
  }

  _buildCarCards(colorHex = KART_COLORS[0]) {
    const box = $('car-select');
    box.innerHTML = '';
    this.carCards = {};
    for (const car of CARS) {
      const card = el('div', 'car-card');
      card.appendChild(drawCarSide(car.id, colorHex));
      card.appendChild(el('div', 'c-name', esc(car.name)));
      card.appendChild(el('div', 'c-desc', esc(car.desc)));
      card.onclick = () => { sound.sfx('click'); this.h.onSelectCar(car.id); };
      box.appendChild(card);
      this.carCards[car.id] = card;
    }
    this._carColor = colorHex;
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
    $('ranking-scope').textContent = rankingShared === null ? ''
      : rankingShared ? '🌐 全サーバー共通のランキングです。'
        : '⚠ このサーバーだけのランキングです（共有データベース未設定。無料サーバーでは再起動で消えることがあります）。';
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
        <td><span class="chip" style="background:${KART_COLORS[e.color % KART_COLORS.length]}"></span>${esc(e.name)}${e.hasGhost === false ? '' : ' <span title="ゴーストあり">👻</span>'}</td>
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
      cond.push(e.hasGhost === false ? 'ゴーストなし（複数人のレース）' : '👻 ゴーストあり');
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
      const noGhost = e.hasGhost === false;
      const row = el('label', 'ghost-row' + (sel.has(e.id) ? ' on' : '') + (noGhost ? ' no-ghost' : ''));
      row.style.borderLeftColor = KART_COLORS[e.color % KART_COLORS.length];
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = sel.has(e.id);
      cb.disabled = !isHost || noGhost;
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
        <span class="g-dist">${noGhost ? 'ゴーストなし（複数人のレース）' : `${dt.km}km ・ ${fmtLap(e.bestLap)} ・ ${esc(skill.name)}`}</span>`);
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
    const rally = this.courses && this.courses[room.course] && this.courses[room.course].kind === 'rally';
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
        <span class="pskill">${skill ? skill.name : ''}${rally && CAR_BY_ID[p.car] ? `<br>${CAR_BY_ID[p.car].en}` : ''}</span>`;
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
    if (this.courses && this.courses[room.course]) {
      const course = this.courses[room.course];
      $('course-desc').textContent = course.desc;
      const kind = course.kind || 'circuit';
      if (this._lastCourse !== room.course) { this._lastCourse = room.course; this.showCourseKind(kind); }
      // rally: pick a car (painted in this player's colour)
      $('car-section').classList.toggle('hidden', kind !== 'rally');
      const me = room.players.find(p => p.id === myId);
      const col = KART_COLORS[(me ? me.color : 0) % KART_COLORS.length];
      if (col !== this._carColor) this._buildCarCards(col);
    }
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
    seg('weather-select', !!room.weather, [[false, '☀ 晴れのみ'], [true, '☂ 変化あり']], v => this.h.onWeather(v));
    seg('skillrule-select', !!room.noSkills, [[false, '個性あり'], [true, '個性なし']], v => this.h.onNoSkills(v));
    $('rule-note').textContent = (room.weather
      ? '天候：基本は晴れ。たまに雨や霧が発生します（雨の路面ではウェットタイヤが有利）。'
      : '天候：レース中ずっと晴れ（「変化あり」にすると、たまに雨や霧が発生します）。') + (isHost ? '' : '（ルールはホストが設定）');
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
    $('car-select').classList.toggle('locked', this.myReady);
    $('skill-select').classList.toggle('locked', this.myReady);
    this.renderSelection(sel);
  }

  renderSelection(sel) {
    for (const [id, c] of Object.entries(this.tyreCards)) c.classList.toggle('sel', id === sel.tyre);
    for (const [id, c] of Object.entries(this.skillCards)) c.classList.toggle('sel', id === sel.skill);
    for (const [id, c] of Object.entries(this.carCards || {})) c.classList.toggle('sel', id === sel.car);
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
