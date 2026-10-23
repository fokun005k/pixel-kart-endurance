// ============================================================
//  Settings modal: key bindings (PC), smartphone controls, sound
//  + the toolbar of the touch-button layout editor
// ============================================================
import { ACTIONS, TOUCH_ITEMS, keyLabel } from './controls.js';
import { sound } from './audio.js';

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Settings {
  /**
   * @param {{bindings: import('./controls.js').KeyBindings, layout: import('./controls.js').TouchLayout,
   *          touch: import('./touch.js').TouchControls, toast: (msg:string)=>void}} deps
   */
  constructor({ bindings, layout, touch, toast }) {
    this.bindings = bindings;
    this.layout = layout;
    this.touch = touch;
    this.toast = toast;
    this.capture = null;   // { action, slot, el } while waiting for a key
    this.tab = touch.enabled ? 'touch' : 'keys';

    // open / close
    for (const b of document.querySelectorAll('.btn-settings')) b.addEventListener('click', () => { sound.ensure(); sound.sfx('click'); this.open(); });
    $('btn-settings-close').addEventListener('click', () => this.close());
    $('settings-modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'settings-modal' && !this.capture) this.close(); });
    for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => { sound.sfx('click'); this.showTab(t.dataset.tab); });

    this._initKeys();
    this._initTouch();
    this._initEditor();

    bindings.onChange(() => { this.renderKeys(); this.renderHelp(); });
    this.renderKeys();
    this.renderHelp();
  }

  get isOpen() { return !$('settings-modal').classList.contains('hidden'); }
  get busy() { return this.isOpen || this.touch.editing; }

  open(tab = this.tab) {
    $('settings-modal').classList.remove('hidden');
    this.showTab(tab);
    this.refreshTouch();
  }

  close() {
    this._cancelCapture();
    $('settings-modal').classList.add('hidden');
  }

  showTab(tab) {
    this.tab = tab;
    this._cancelCapture();
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === tab);
    for (const b of document.querySelectorAll('.tab-body')) b.classList.toggle('on', b.dataset.tab === tab);
  }

  // ------------------------------------------------------------------
  //  key bindings
  // ------------------------------------------------------------------
  _initKeys() {
    $('btn-keys-reset').addEventListener('click', () => {
      sound.sfx('click');
      this.bindings.reset();
      this.toast('キー設定を初期状態に戻しました');
    });
    // capture phase so the game never sees the key that is being assigned
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') this._cancelCapture();
        else if (e.code === 'Delete' || e.code === 'Backspace') this._assign(null);
        else this._assign(e.code);
        return;
      }
      if (e.code === 'Escape' && this.touch.editing) { e.stopImmediatePropagation(); this._endEdit(false); return; }
      if (e.code === 'Escape' && this.isOpen) { e.stopImmediatePropagation(); this.close(); }
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (!this.capture || e.pointerType !== 'mouse') return;
      // clicking another control of the dialog = change of mind, not a mouse binding
      if (e.target.closest('button, input, .tab')) { this._cancelCapture(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      this._assign('Mouse' + e.button);
    }, true);
    window.addEventListener('contextmenu', (e) => { if (this.capture || this._swallowMenu) e.preventDefault(); }, true);
  }

  renderKeys() {
    const body = $('keymap-body');
    body.innerHTML = '';
    for (const a of ACTIONS) {
      const tr = document.createElement('tr');
      const [k1, k2] = this.bindings.get(a.id);
      tr.innerHTML = `<td>${esc(a.label)}</td>`;
      [k1, k2].forEach((code, slot) => {
        const td = document.createElement('td');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'key-slot' + (code ? '' : ' empty');
        b.textContent = code ? keyLabel(code) : '（なし）';
        b.dataset.action = a.id;
        b.dataset.slot = slot;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          sound.sfx('click');
          this._startCapture(a.id, slot, b);
        });
        td.appendChild(b);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  _startCapture(action, slot, el) {
    this._cancelCapture();
    this.capture = { action, slot, el };
    el.classList.add('waiting');
    el.textContent = 'キーを押して…';
  }

  _cancelCapture() {
    if (!this.capture) return;
    this.capture = null;
    this.renderKeys();
  }

  _assign(code) {
    const { action, slot } = this.capture;
    this.capture = null;
    // a right-click binding would otherwise open the context menu on release
    this._swallowMenu = true;
    setTimeout(() => { this._swallowMenu = false; }, 400);
    const taken = this.bindings.set(action, slot, code);
    sound.sfx('click');
    const label = ACTIONS.find(a => a.id === action).label;
    if (taken && taken !== label) this.toast(`「${keyLabel(code)}」を「${taken}」から「${label}」に移しました`, 2600);
    // flash the slot that changed
    const el = document.querySelector(`.key-slot[data-action="${action}"][data-slot="${slot}"]`);
    if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 500); }
  }

  /** "操作方法" on the title screen always shows the current keys */
  renderHelp() {
    const ul = $('help-keys');
    if (!ul) return;
    const d = a => `<b>${esc(this.bindings.describe(a))}</b>`;
    ul.innerHTML = `
      <li>${d('accel')} アクセル　${d('brake')} ブレーキ・バック</li>
      <li>${d('left')} / ${d('right')} ハンドル</li>
      <li>${d('skill')} アクティブスキル発動</li>
      <li><b>1 / 2 / 3 / 4</b> ピットでタイヤ選択（ソフト / ミディアム / ハード / ウェット）</li>
      <li>${d('respawn')} コースに復帰　${d('mute')} ミュート　${d('pause')} メニュー</li>
      <li>キーは「⚙ 設定 → キー操作」で自由に変更できます</li>`;
  }

  // ------------------------------------------------------------------
  //  smartphone controls tab
  // ------------------------------------------------------------------
  _initTouch() {
    for (const b of document.querySelectorAll('#steer-mode button')) {
      b.addEventListener('click', () => {
        sound.sfx('click');
        this.touch.setSteerMode(b.dataset.mode);
        this.layout.save();
        this.refreshTouch();
      });
    }
    const sens = $('steer-sens');
    sens.addEventListener('input', () => {
      this.layout.data.sens = Number(sens.value) / 100;
      this.layout.save();
      this.refreshTouch();
    });
    $('btn-layout-edit').addEventListener('click', () => { sound.sfx('click'); this._beginEdit(); });
    $('btn-layout-reset').addEventListener('click', () => {
      sound.sfx('click');
      this.layout.reset();
      this.layout.save();
      this.touch.applyLayout();
      this.refreshTouch();
      this.toast('ボタン配置を初期状態に戻しました');
    });
  }

  refreshTouch() {
    const L = this.layout.data;
    for (const b of document.querySelectorAll('#steer-mode button')) b.classList.toggle('on', b.dataset.mode === L.steerMode);
    for (const b of document.querySelectorAll('.le-steer')) b.classList.toggle('on', b.dataset.mode === L.steerMode);
    $('steer-sens').value = Math.round(L.sens * 100);
    $('steer-sens-val').textContent = `${Math.round(L.sens * 100)}%`;
  }

  // ------------------------------------------------------------------
  //  layout editor toolbar
  // ------------------------------------------------------------------
  _initEditor() {
    $('le-size').addEventListener('input', () => {
      const v = this.layout.data.items[this.touch.selected];
      v.s = Number($('le-size').value) / 100;
      $('le-size-val').textContent = `${$('le-size').value}%`;
      this.touch.applyLayout();
    });
    $('le-opacity').addEventListener('input', () => {
      this.layout.data.opacity = Number($('le-opacity').value) / 100;
      $('le-opacity-val').textContent = `${$('le-opacity').value}%`;
      this.touch.applyLayout();
    });
    for (const b of document.querySelectorAll('.le-steer')) {
      b.addEventListener('click', () => {
        sound.sfx('click');
        this.touch.setSteerMode(b.dataset.mode);
        // pick something visible in the new mode
        if (b.dataset.mode === 'slide' && (this.touch.selected === 'left' || this.touch.selected === 'right')) this.touch.select('accel');
        this.refreshTouch();
      });
    }
    $('le-reset').addEventListener('click', () => {
      sound.sfx('click');
      const mode = this.layout.data.steerMode;
      this.layout.reset();
      this.layout.data.steerMode = mode;
      this.touch.applyLayout();
      this._syncEditor(this.touch.selected);
    });
    $('le-cancel').addEventListener('click', () => { sound.sfx('click'); this._endEdit(false); });
    $('le-save').addEventListener('click', () => { sound.sfx('click'); this._endEdit(true); });
    $('le-save-mini').addEventListener('click', () => { sound.sfx('click'); this._endEdit(true); });
    $('le-move').addEventListener('click', () => $('layout-editor').classList.toggle('bottom'));
    $('le-fold').addEventListener('click', () => {
      const bar = $('layout-editor');
      bar.classList.toggle('folded');
      $('le-fold').textContent = bar.classList.contains('folded') ? '▤ ひらく' : '▬ たたむ';
    });
    // keep the toolbar out of the way: it moves to the side (top/bottom) that hides fewer buttons,
    // and jumps away when a button is dragged underneath it
    this.touch.onDrag = (id) => this._dodge(id);
  }

  /** number of buttons whose centre lies under a toolbar placed at the top / bottom */
  _covered(bottom) {
    const h = $('layout-editor').getBoundingClientRect().height + 12;
    let n = 0;
    for (const it of TOUCH_ITEMS) {
      if (it.steerButtons && this.layout.data.steerMode !== 'buttons') continue;
      const y = this.layout.data.items[it.id].y * innerHeight;
      if (bottom ? y > innerHeight - h : y < h) n++;
    }
    return n;
  }

  _placeBar() {
    const bar = $('layout-editor');
    bar.classList.remove('bottom');
    if (this._covered(false) > this._covered(true)) bar.classList.add('bottom');
  }

  _dodge(id) {
    const bar = $('layout-editor');
    const r = bar.getBoundingClientRect();
    const y = this.layout.data.items[id].y * innerHeight;
    if (y > r.top - 20 && y < r.bottom + 20) bar.classList.toggle('bottom');
  }

  _beginEdit() {
    this.close();
    $('layout-editor').classList.remove('hidden');
    this.touch.startEdit(id => this._syncEditor(id));
    this.refreshTouch();
    requestAnimationFrame(() => this._placeBar());
  }

  _syncEditor(id) {
    const it = TOUCH_ITEMS.find(t => t.id === id);
    $('le-selected').textContent = it ? it.label : id;
    const v = this.layout.data.items[id];
    $('le-size').value = Math.round(v.s * 100);
    $('le-size-val').textContent = `${Math.round(v.s * 100)}%`;
    $('le-opacity').value = Math.round(this.layout.data.opacity * 100);
    $('le-opacity-val').textContent = `${Math.round(this.layout.data.opacity * 100)}%`;
  }

  _endEdit(keep) {
    this.touch.stopEdit(keep);
    $('layout-editor').classList.add('hidden');
    this.toast(keep ? 'ボタン配置を保存しました' : '編集を取り消しました');
    this.open('touch');
  }
}
