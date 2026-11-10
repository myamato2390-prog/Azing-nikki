import * as db from './db.js';
import {
  APP_ID, KIND, DEFAULT_PLACES, THEME_COLOR, SIDES, SIDE_COLOR, sideName, defaultPlace,
  WEATHER, WIND_DIRS, LIGHTS, SHIOMAWARI, SIZE_FEEL, JIAI, TIDE_STAGES, JIG_WEIGHTS, RANGES, ACTIONS, BYCATCH, LINE_TYPES, TACKLE_FIELDS,
  newTrip, normalizeTrip, sortTrips, formatDate, formatWeather, formatDayTemps, formatWind, formatHighs, formatLows,
  formatMoves, formatTimeRange, endsNextDay, isNextDayTime, normalizeTime, tackleSummary,
  starKey, starItem, starLabel, starState, cycleStar, starredFirst, starText,
  has, num, uid, todayISO, seasonOf,
} from './model.js';
import { emptyQuery, isEmptyQuery, filterTrips, describeQuery } from './search.js';
import { summarize, seasons } from './stats.js';
import { seasonXlsx } from './export.js';
import { shareTrip, downloadBlob, renderSeasonImage, shareBlob } from './share.js';
import { placeStats, similarTrips, personalBests, recordBadges, newRecords } from './insights.js';
import { fetchWeather } from './weather.js';
import { shiomawari } from './tide.js';

const APP_VERSION = '0.1.0';
const STAR_TYPES = ['jigheads', 'worms', 'ranges', 'actions'];

const state = {
  trips: [],
  presets: [],
  places: DEFAULT_PLACES,
  theme: 'dark',
  query: emptyQuery(),
  currentId: null,
  onLeave: null,
};

// ---------- 小さなヘルパー ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const nowHM = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}
function readValue(el) {
  if (el.type === 'number') return el.value === '' ? null : Number(el.value);
  return el.value;
}

// 港（内部の項目名は鮎日記と同じ river）
function placeSetting(name) {
  return state.places.find((r) => r.name === name);
}
function placeColor(name) {
  return placeSetting(name)?.color || defaultPlace(name)?.color || THEME_COLOR;
}
function placeNames() {
  return uniq([...state.places.map((r) => r.name), ...state.trips.map((t) => t.river)]);
}

function setTheme(color = THEME_COLOR) {
  $('#top').style.background = color;
  $('meta[name="theme-color"]')?.setAttribute('content', color);
}
function applyMode() {
  document.documentElement.dataset.theme = state.theme === 'light' ? 'light' : 'dark';
}

// ---------- 画面の枠 ----------
function mount(topHtml) {
  $('#top').innerHTML = topHtml;
  setTheme();
  const root = document.createElement('div');
  root.className = 'view';
  $('#view').replaceChildren(root);
  $('#view').scrollTop = 0;
  $('#view').classList.remove('no-scroll');
  return root;
}

function setActiveTab(name) {
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
}

// ---------- フォーム部品 ----------
const field = (label, inner, cls = '') => `<label class="field ${cls}"><span class="lbl">${label}</span>${inner}</label>`;
const group = (label, inner, cls = '') => `<div class="field ${cls}"><span class="lbl">${label}</span>${inner}</div>`;

function input(obj, path, attrs = '') {
  const v = getPath(obj, path);
  return `<input data-path="${path}" value="${esc(v ?? '')}" ${attrs}>`;
}
function numInput(obj, path, attrs = '') {
  return input(obj, path, `type="number" inputmode="decimal" ${attrs}`);
}
// 時刻は数字だけで入力（0730 → 07:30）。Androidの時刻ピッカーは使わない
function timeInput(obj, path, ph = '例: 1830') {
  return input(obj, path, `data-time inputmode="numeric" maxlength="5" placeholder="${ph}"`);
}
function chips(obj, path, options, multi = false) {
  const v = getPath(obj, path);
  const on = (o) => (multi ? (v || []).includes(o) : v === o);
  return `<div class="chips" data-path="${path}" data-mode="${multi ? 'multi' : 'single'}">${options
    .map((o) => (Array.isArray(o) ? o : [o, o]))
    .map(([val, label]) => `<button type="button" class="chip${on(val) ? ' on' : ''}" data-chip="${esc(val)}">${esc(label)}</button>`)
    .join('')}</div>`;
}
// ★付きのボタン：押すたびに なし → 使った → ★良かった → なし
function starChips(obj, path, type, keys) {
  const list = getPath(obj, path);
  return `<div class="chips" data-path="${path}" data-mode="star" data-type="${type}">${keys.map((k) => {
    const st = starState(list, type, k);
    return `<button type="button" class="chip${st ? ' on' : ''}${st === 2 ? ' star' : ''}" data-chip="${esc(k)}">${st === 2 ? '★ ' : ''}${esc(starLabel(type, starItem(type, k)))}</button>`;
  }).join('')}</div>`;
}
function stepper(obj, path, unit) {
  return `<div class="stepper">
    <button type="button" class="step" data-step="-1" data-for="${path}" aria-label="減らす">−</button>
    ${input(obj, path, 'type="number" inputmode="numeric" min="0"')}
    <span class="unit">${unit}</span>
    <button type="button" class="step" data-step="1" data-for="${path}" aria-label="増やす">＋</button>
  </div>`;
}
const datalist = (id, values) => `<datalist id="${id}">${uniq(values).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;

// チップ・ステッパー・入力欄の共通処理。変更があれば onChange(path) を呼ぶ
function bindControls(root, obj, onChange) {
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const box = chip.closest('.chips');
      const path = box.dataset.path;
      const val = chip.dataset.chip;
      if (box.dataset.mode === 'star') {
        const type = box.dataset.type;
        const next = cycleStar(getPath(obj, path), type, val);
        setPath(obj, path, next);
        const st = starState(next, type, val);
        chip.classList.toggle('on', st > 0);
        chip.classList.toggle('star', st === 2);
        chip.textContent = (st === 2 ? '★ ' : '') + starLabel(type, starItem(type, val));
      } else if (box.dataset.mode === 'multi') {
        const arr = [...(getPath(obj, path) || [])];
        const i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        const order = $$('.chip', box).map((c) => c.dataset.chip);
        arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        setPath(obj, path, arr);
        chip.classList.toggle('on', i < 0);
      } else {
        const next = getPath(obj, path) === val ? '' : val;
        setPath(obj, path, next);
        $$('.chip', box).forEach((c) => c.classList.toggle('on', c.dataset.chip === next));
      }
      onChange(path);
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const path = step.dataset.for;
      const next = Math.max(0, num(getPath(obj, path)) + Number(step.dataset.step));
      setPath(obj, path, next);
      const el = $(`input[data-path="${path}"]`, root);
      if (el) el.value = next;
      onChange(path);
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]');
    if (!el || el.classList.contains('chips')) return;
    setPath(obj, el.dataset.path, readValue(el));
    onChange(el.dataset.path);
  });
  // 時刻欄は入力を終えたときに 07:30 の形に整える
  root.addEventListener('change', (e) => {
    const el = e.target.closest('input[data-time]');
    if (!el) return;
    const v = normalizeTime(el.value);
    if (v === null) { toast('時刻は 1830 のように4桁の数字で入力してください'); return; }
    el.value = v;
    if (el.dataset.path) { setPath(obj, el.dataset.path, v); onChange(el.dataset.path); }
  });
}

// ---------- 写真の拡大表示 ----------
function showPhoto(src) {
  const ov = document.createElement('div');
  ov.className = 'photo-overlay';
  ov.innerHTML = `<img src="${src}" alt="写真"><button type="button" aria-label="閉じる">×</button>`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

// ---------- カード表示 ----------
function visibleTrips() {
  return sortTrips(filterTrips(state.trips, state.query));
}

// 小さなラベル付きのマス目
const cell = (label, value, cls = '') => (value ? `<div class="cell ${cls}"><span>${label}</span>${value}</div>` : '');
const tags = (arr, cls = '') => (arr || []).map((v) => `<span class="pill ${cls}">${esc(v)}</span>`).join('');

function cardHtml(t) {
  const a = t.aji;
  const color = placeColor(t.river);
  const moves = formatMoves(t);
  const photo = t.photos?.[0]?.data;
  const time = formatTimeRange(t);
  const weather = formatWeather(t);
  const wind = formatWind(t);
  const ps = placeStats(state.trips, t.river);
  const badges = recordBadges(state.trips, t);
  const highs = formatHighs(t), lows = formatLows(t);
  const tackle = tackleSummary(a.tackle);
  const stars = (type) => starredFirst(a[type], type).map((x) => `<span class="pill${x.star ? ' star' : ''}">${x.star ? '★' : ''}${esc(x.label)}</span>`).join('');
  const lure = a.jigheads.length || a.worms.length || a.ranges.length || a.actions.length;

  return `<article class="card" data-id="${t.id}" style="--river:${esc(color)}">
    <header class="card-head${photo ? ' has-photo' : ''}" ${photo ? `data-bg="${photo}"` : ''}>
      <div class="card-date">${formatDate(t.date)}${time ? `<span>${esc(time)}</span>` : ''}</div>
      <div class="card-place"><b>${esc(t.river || '港未入力')}</b>${a.side ? `<small>${esc(sideName(a.side))}</small>` : ''}</div>
      ${moves.map((m) => `<div class="card-move">→ ${esc(m)}</div>`).join('')}
      ${t.title ? `<div class="card-title">「${esc(t.title)}」</div>` : ''}
      ${badges.length ? `<div class="card-badges">${badges.map((b) => `<span>🏆 ${b}</span>`).join('')}</div>` : ''}
    </header>
    ${!has(t.count) ? `<a class="after-banner" href="#/edit/${t.id}?tab=after">釣行後の記録がまだです　入力する ›</a>` : ''}
    <section class="catch">
      <div class="catch-count"><b>${has(t.count) ? esc(t.count) : '-'}</b>匹</div>
      <div class="catch-stat"><span>最大</span><b>${has(t.maxSize) ? esc(t.maxSize) : '-'}</b>cm</div>
      <div class="catch-stat"><span>バラシ</span><b>${has(t.bare) ? esc(t.bare) : '-'}</b></div>
      ${t.sizeFeel ? `<div class="catch-feel">${esc(t.sizeFeel)}</div>` : ''}
    </section>
    ${ps && ps.trips >= 2 ? `<div class="point-stats">📍 この港 全${ps.trips}回・平均${ps.avg}匹・最多${ps.best}匹${ps.max ? `・最大${ps.max}cm` : ''}</div>` : ''}
    ${(t.jiai.length || a.tideStages.length || lure || a.bycatch.length) ? `<section class="pills">
      ${t.jiai.length || a.tideStages.length ? `<div><em>時合</em>${tags(t.jiai)}${tags(a.tideStages, 'plain')}</div>` : ''}
      ${a.jigheads.length ? `<div><em>ジグヘッド</em>${stars('jigheads')}</div>` : ''}
      ${a.worms.length ? `<div><em>ワーム</em>${stars('worms')}</div>` : ''}
      ${a.ranges.length || a.actions.length ? `<div><em>誘い</em>${stars('ranges')}${stars('actions')}</div>` : ''}
      ${a.bycatch.length ? `<div><em>外道</em>${tags(a.bycatch, 'plain')}</div>` : ''}
    </section>` : ''}
    <section class="grid">
      ${cell('潮回り', esc(a.tide.shiomawari))}
      ${cell('常夜灯', esc(a.light))}
      ${cell('天気', esc(weather), 'w2')}
      ${cell('満潮', esc(highs), 'w2')}
      ${cell('干潮', esc(lows), 'w2')}
      ${cell('風', esc(wind), 'w2')}
      ${cell('朝／最高', esc(formatDayTemps(t).replace('朝', '').replace('最高', '')), 'w2')}
      ${cell('水温', has(t.waterTemp) ? `${esc(t.waterTemp)}℃` : '')}
      ${cell('仕掛け', esc(tackle), 'wide')}
    </section>
    ${t.memo ? `<section class="memo" data-act="memo">${esc(t.memo)}</section>` : ''}
    ${t.photos?.length ? `<section class="strip">${t.photos.map((p) => `<img data-src="${p.data}" alt="写真" data-act="photo">`).join('')}</section>` : ''}
  </article>`;
}

function viewCards() {
  setActiveTab('cards');
  const list = visibleTrips();
  const searching = !isEmptyQuery(state.query);
  let idx = list.findIndex((t) => t.id === state.currentId);
  if (idx < 0) idx = list.length - 1;

  const root = mount(`
    <button class="icon-btn" data-nav="-1" aria-label="前の釣行">‹</button>
    <div class="top-title"><div class="pos-big" id="pos"></div></div>
    <button class="icon-btn" data-nav="1" aria-label="次の釣行">›</button>
    <button class="icon-btn small" id="share-btn" aria-label="LINEなどで送る" title="LINEなどで送る">⤴</button>
    <button class="icon-btn small" id="edit-btn" aria-label="編集" title="編集">✎</button>`);
  $('#view').classList.add('no-scroll');

  if (searching) {
    root.insertAdjacentHTML('beforeend', `<div class="search-banner">
      <span>🔍 ${esc(describeQuery(state.query))}（${list.length}件）</span>
      <button type="button" class="link" data-act="clear-search">解除</button></div>`);
  }

  if (!list.length) {
    $('#view').classList.remove('no-scroll');
    root.insertAdjacentHTML('beforeend', searching
      ? `<div class="empty"><p>条件に合う釣行がありません。</p><a class="btn" href="#/search">条件を変える</a></div>`
      : `<div class="empty"><div class="empty-fish">🐟</div><p>まだ釣行の記録がありません。</p><p class="muted">釣り場に着く前に「釣行前」を、終わったら「釣行後」を入力します。</p><a class="btn primary" href="#/new">最初の釣行を記録する</a></div>`);
    $$('#top .icon-btn').forEach((b) => (b.disabled = true));
    return;
  }
  root.insertAdjacentHTML('beforeend', `<div class="deck${searching ? ' with-banner' : ''}" id="deck">${list.map(cardHtml).join('')}</div>`);

  const current = () => state.trips.find((x) => x.id === state.currentId);
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    const act = el?.dataset.act;
    if (act === 'clear-search') { state.query = emptyQuery(); viewCards(); }
    else if (act === 'memo') el.classList.toggle('open');
    else if (act === 'photo' && el.src) showPhoto(el.src);
  });
  $('#edit-btn').onclick = () => { if (state.currentId) location.hash = `#/edit/${state.currentId}`; };
  $('#share-btn').onclick = async () => {
    const t = current();
    if (!t) return;
    toast('画像を作成中…');
    const r = await shareTrip(t, placeColor(t.river));
    if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
  };

  const deck = $('#deck');
  const update = () => {
    if (!deck.isConnected) return; // 別の画面へ移った後は何もしない
    const i = Math.max(0, Math.min(list.length - 1, Math.round(deck.scrollLeft / deck.clientWidth)));
    const t = list[i];
    state.currentId = t?.id;
    $('#pos').textContent = `${i + 1} / ${list.length}`;
    setTheme(placeColor(t?.river));
    $$('[data-nav]').forEach((b) => (b.disabled = (b.dataset.nav === '-1' && i === 0) || (b.dataset.nav === '1' && i === list.length - 1)));
    // 写真は表示中の前後だけ読み込む
    [...deck.children].forEach((card, j) => {
      if (Math.abs(j - i) > 1) return;
      $$('img[data-src]', card).forEach((img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); });
      const head = $('.card-head[data-bg]', card);
      if (head) { head.style.backgroundImage = `linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.55)),url("${head.dataset.bg}")`; head.removeAttribute('data-bg'); }
    });
  };
  $$('[data-nav]').forEach((b) => {
    b.onclick = () => deck.scrollBy({ left: Number(b.dataset.nav) * deck.clientWidth, behavior: 'smooth' });
  });
  let raf;
  deck.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
  requestAnimationFrame(() => {
    deck.style.scrollBehavior = 'auto';
    deck.scrollLeft = idx * deck.clientWidth;
    deck.style.scrollBehavior = '';
    update();
  });
}

// ---------- ＋記録：釣行後が未入力の記録があれば続きを選べる ----------
function viewNew(fresh) {
  const pending = sortTrips(state.trips.filter((t) => !has(t.count))).reverse().slice(0, 3);
  if (fresh || !pending.length) return viewEdit(null, 'before');
  setActiveTab('new');
  const root = mount(`<div class="top-title"><div>記録</div></div>`);
  root.innerHTML = `
    <p class="lead">釣行後の記録がまだの釣行があります。</p>
    ${pending.map((t) => `
      <a class="choice" href="#/edit/${t.id}?tab=after" style="--river:${esc(placeColor(t.river))}">
        <span class="choice-date">${formatDate(t.date)} ${esc(t.startTime)}</span>
        <b>${esc(t.river || '港未入力')}</b>
        <span class="choice-go">釣行後を入力する ›</span>
      </a>`).join('')}
    <a class="btn wide" href="#/new?fresh=1">＋ 新しい釣行を記録する</a>`;
}

// ---------- 入力・編集 ----------
async function resizeImage(file, max = 1280, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function latestOtherTrip(id) {
  return sortTrips(state.trips.filter((t) => t.id !== id && Object.values(t.aji.tackle || {}).some(Boolean))).pop();
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
// 自動入力する天気・風の項目（手で直したら「自動のまま」ではなくなる）
const WEATHER_PATHS = ['weather', 'tempMorning', 'tempMax', 'aji.tempStart', 'aji.windDir', 'aji.windSpeed', 'aji.windMax'];

function viewEdit(id, tab = 'before') {
  setActiveTab(id ? '' : 'new');
  const existing = id && state.trips.find((t) => t.id === id);
  if (id && !existing) { location.hash = '#/'; return; }
  const trip = existing ? clone(existing) : newTrip();
  const aji = trip.aji;
  let isNew = !existing;
  let dirty = false;
  let timer;
  // 潮回りは日付から自動で入れる（手で変えた値は上書きしない）
  let autoShio = shiomawari(trip.date);
  if (isNew) aji.tide.shiomawari = autoShio;
  // 自己ベスト更新の判定用：編集前のベストと、この釣行の元の値
  const bestsBefore = personalBests(state.trips, trip.id);
  const original = { maxSize: trip.maxSize, count: trip.count };
  const celebrateIfRecord = () => {
    const changed = trip.maxSize !== original.maxSize || trip.count !== original.count;
    const recs = changed ? newRecords(bestsBefore, trip) : [];
    if (recs.length) celebrate(recs);
    original.maxSize = trip.maxSize; original.count = trip.count;
  };

  const root = mount(`
    <a class="icon-btn" href="#/" aria-label="戻る">‹</a>
    <div class="top-title"><div>${isNew ? '新しい釣行' : '釣行の編集'}</div><div class="pos" id="save-status">${isNew ? '入力すると自動で保存されます' : '保存済み'}</div></div>
    <button class="btn small primary" id="done">完了</button>`);
  setTheme(placeColor(trip.river));

  const setStatus = (s) => { const el = $('#save-status'); if (el) el.textContent = s; };

  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    trip.updatedAt = new Date().toISOString();
    try {
      await db.put('trips', clone(trip));
    } catch {
      dirty = true;
      setStatus('⚠ 保存できませんでした');
      toast('保存できませんでした。スマホの空き容量を確認してください');
      return;
    }
    const i = state.trips.findIndex((t) => t.id === trip.id);
    if (i >= 0) state.trips[i] = clone(trip); else state.trips.push(clone(trip));
    state.currentId = trip.id;
    if (isNew) {
      isNew = false;
      history.replaceState(null, '', `#/edit/${trip.id}?tab=${tab}`);
      db.requestPersist();
    }
    setStatus(`✓ 保存済み ${nowHM()}`);
  }
  const touch = () => {
    dirty = true;
    setStatus('保存中…');
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  state.onLeave = async () => { await save(); celebrateIfRecord(); };

  const sideChips = (side) => state.places.filter((p) => p.side === side && p.name).map((p) => p.name);
  const tackleValues = (k) => [...state.trips.map((t) => t.aji.tackle?.[k]), ...state.presets.map((p) => p.tackle?.[k])];
  // 満潮・干潮は2つずつの入力欄
  const tideSlots = (key) => [0, 1].map((i) => ({ time: '', cm: null, ...(aji.tide[key][i] || {}) }));
  const slots = { highs: tideSlots('highs'), lows: tideSlots('lows') };
  const tideRow = (key, label) => `<div class="tide-row"><span class="tide-lbl">${label}</span>${slots[key].map((x, i) => `
      <input data-tide="${key}" data-i="${i}" data-tf="time" data-time inputmode="numeric" maxlength="5" placeholder="時刻" value="${esc(x.time)}">
      <span class="with-unit"><input data-tide="${key}" data-i="${i}" data-tf="cm" type="number" inputmode="numeric" placeholder="潮位" value="${esc(x.cm ?? '')}"><span>cm</span></span>`).join('')}</div>`;

  root.innerHTML = `
    <div class="seg" role="tablist">
      <button type="button" data-tab="before" class="${tab === 'before' ? 'on' : ''}">釣行前</button>
      <button type="button" data-tab="after" class="${tab === 'after' ? 'on' : ''}">釣行後</button>
    </div>

    <form class="form" autocomplete="off" onsubmit="return false">
    <div class="pane" data-pane="before" ${tab === 'before' ? '' : 'hidden'}>
      <div class="row2">
        ${field('日付（始めた日）', input(trip, 'date', 'type="date" required'))}
        ${field('開始時刻', timeInput(trip, 'startTime', '例: 1830'))}
      </div>
      ${group('港', `
        ${Object.entries(SIDES).map(([side, label]) => `<div class="side-lbl" style="--river:${SIDE_COLOR[side]}">${label}</div>${chips(trip, 'river', sideChips(side))}`).join('')}
        ${input(trip, 'river', 'list="dl-river" placeholder="その他の港は入力"')}`)}
      <div id="side-pick" hidden>${group('この港はどちら側？', chips(trip, 'aji.side', Object.entries(SIDES)))}</div>
      <div id="place-stats" class="hint"></div>

      <h3>潮</h3>
      ${group('潮回り（日付から自動）', chips(trip, 'aji.tide.shiomawari', SHIOMAWARI))}
      ${group('満潮・干潮（時刻と潮位）', `${tideRow('highs', '満潮')}${tideRow('lows', '干潮')}
        <p class="muted">いまは手入力です。自動計算は準備中です。</p>`)}

      <h3>天気・風</h3>
      <div class="tools"><button type="button" class="btn small" data-act="weather">☀ 天気・風・気温を自動入力</button><span class="muted" id="weather-note"></span></div>
      ${group('天気', chips(trip, 'weather', WEATHER))}
      ${group('風向', chips(trip, 'aji.windDir', WIND_DIRS))}
      <div class="row3">
        ${field('風速', `<div class="with-unit">${numInput(trip, 'aji.windSpeed', 'step="0.1" min="0"')}<span>m/s</span></div>`)}
        ${field('最大風速', `<div class="with-unit">${numInput(trip, 'aji.windMax', 'step="0.1" min="0"')}<span>m/s</span></div>`)}
        ${field('釣り始めの気温', `<div class="with-unit">${numInput(trip, 'aji.tempStart', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      <div class="row3">
        ${field('朝の気温', `<div class="with-unit">${numInput(trip, 'tempMorning', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('最高気温', `<div class="with-unit">${numInput(trip, 'tempMax', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('水温', `<div class="with-unit">${numInput(trip, 'waterTemp', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      ${group('常夜灯', chips(trip, 'aji.light', LIGHTS))}

      <h3>作戦ボード</h3>
      <div id="board" class="board"></div>

      <h3>仕掛け</h3>
      <div class="tools">
        <button type="button" class="btn small" data-act="copy-last">前回の仕掛け</button>
        <select id="preset-select" class="btn small">
          <option value="">プリセットから…</option>
          ${state.presets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn small" data-act="save-preset">プリセットに保存</button>
      </div>
      <div class="row2">
        ${field('ロッド', input(trip, 'aji.tackle.rod', 'list="dl-t-rod" placeholder="例: 6.4ft UL"'))}
        ${field('リール', input(trip, 'aji.tackle.reel', 'list="dl-t-reel" placeholder="例: 2000番"'))}
      </div>
      ${group('ライン', chips(trip, 'aji.tackle.lineType', LINE_TYPES))}
      <div class="row2">
        ${field('ラインの号数', input(trip, 'aji.tackle.lineSize', 'list="dl-t-lineSize" placeholder="例: 0.3号"'))}
        ${field('リーダー', input(trip, 'aji.tackle.leader', 'list="dl-t-leader" placeholder="例: フロロ 0.8号"'))}
      </div>

      <button type="button" class="btn wide" data-tab="after">釣行後の入力へ ›</button>
      <p class="muted center">釣行前の内容は自動で保存されています。釣行後のタブに移っても消えません。</p>
    </div>

    <div class="pane" data-pane="after" ${tab === 'after' ? '' : 'hidden'}>
      ${field('ひとこと（この日を一言で）', input(trip, 'title', 'maxlength="40" placeholder="例: 下げ始めに表層で連発"'))}
      ${field('終了時刻', timeInput(trip, 'endTime', '例: 0200'))}
      <div id="end-note" class="hint"></div>
      ${group('匹数', stepper(trip, 'count', '匹'), 'big')}
      ${field('最大サイズ', `<div class="with-unit">${numInput(trip, 'maxSize', 'step="0.1" min="0"')}<span>cm</span></div>`)}
      ${group('バラシ', stepper(trip, 'bare', '回'))}
      ${group('サイズ感', chips(trip, 'sizeFeel', SIZE_FEEL))}
      ${group('時合（複数可）', chips(trip, 'jiai', JIAI, true))}
      ${group('釣れたときの潮（複数可）', chips(trip, 'aji.tideStages', TIDE_STAGES, true))}

      <h3>ジグヘッド・ワーム</h3>
      <p class="star-help">1回押す＝使った　2回押す＝<b>★ 良かった</b>　3回押す＝取り消し</p>
      ${group('ジグヘッドの重さ', `<div id="st-jigheads"></div>
        <div class="add-row"><span class="with-unit"><input id="add-jig" type="number" inputmode="decimal" step="0.1" min="0" placeholder="その他の重さ"><span>g</span></span><button type="button" class="btn small" data-act="add-jig">追加</button></div>`)}
      ${group('ワーム', `<div id="st-worms"></div>
        <div class="add-row"><input id="add-worm-name" list="dl-worm-name" placeholder="名前（例: 〇〇 2インチ）"><input id="add-worm-color" list="dl-worm-color" placeholder="カラー"><button type="button" class="btn small" data-act="add-worm">追加</button></div>`)}
      ${group('レンジ', starChips(trip, 'aji.ranges', 'ranges', RANGES))}
      ${group('誘い方', starChips(trip, 'aji.actions', 'actions', ACTIONS))}

      <h3>外道</h3>
      <div id="bycatch"></div>
      <div class="add-row"><input id="add-bycatch" placeholder="その他の魚"><button type="button" class="btn small" data-act="add-bycatch">追加</button></div>

      <h3>移動した場所</h3>
      <p class="muted">途中で港を変えたときだけ追加します。</p>
      <div id="moves"></div>
      <button type="button" class="btn small" data-act="add-move">＋ 移動先を追加</button>

      <h3>メモ・写真</h3>
      ${group('メモ', `<textarea data-path="memo" rows="5" placeholder="釣れた場所、アタリの出方、次回への反省など">${esc(trip.memo)}</textarea>
        ${SpeechRec ? '<button type="button" class="btn small mic" data-act="voice">🎤 音声で入力</button>' : ''}`)}
      ${group('写真', `<div class="photo-edit" id="photo-edit"></div>
        <label class="btn small"><input type="file" accept="image/*" multiple hidden id="photo-input">写真を追加</label>`)}

      <button type="button" class="btn wide danger" data-act="delete">この釣行を削除</button>
    </div>
    </form>
    ${datalist('dl-river', placeNames())}
    ${TACKLE_FIELDS.map(([k]) => datalist(`dl-t-${k}`, tackleValues(k))).join('')}
    ${datalist('dl-worm-name', state.trips.flatMap((t) => t.aji.worms.map((w) => w.name)))}
    ${datalist('dl-worm-color', state.trips.flatMap((t) => t.aji.worms.map((w) => w.color)))}
  `;

  const refreshInputs = () => {
    $$('input[data-path], textarea[data-path]', root).forEach((el) => {
      const v = getPath(trip, el.dataset.path);
      if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('.chips', root).forEach((box) => {
      if (box.dataset.mode === 'star') return;
      const v = getPath(trip, box.dataset.path);
      $$('.chip', box).forEach((c) => c.classList.toggle('on', box.dataset.mode === 'multi' ? (v || []).includes(c.dataset.chip) : v === c.dataset.chip));
    });
  };

  // ジグヘッド・ワーム・外道のボタン：いつもの選択肢＋過去に使ったもの＋この釣行のもの
  const renderLures = () => {
    const others = state.trips.filter((t) => t.id !== trip.id);
    const jigs = uniq([...JIG_WEIGHTS, ...others.flatMap((t) => t.aji.jigheads.map((j) => Number(j.g))), ...aji.jigheads.map((j) => Number(j.g))].map(String))
      .sort((a, b) => Number(a) - Number(b));
    const worms = uniq([...aji.worms, ...sortTrips(others).reverse().flatMap((t) => t.aji.worms)].map((w) => starKey('worms', w)));
    $('#st-jigheads', root).innerHTML = starChips(trip, 'aji.jigheads', 'jigheads', jigs);
    $('#st-worms', root).innerHTML = worms.length
      ? starChips(trip, 'aji.worms', 'worms', worms)
      : '<p class="muted">下の欄に名前とカラーを入れて「追加」を押すと、次からボタンで選べます。</p>';
    const fish = uniq([...BYCATCH, ...others.flatMap((t) => t.aji.bycatch), ...aji.bycatch]);
    $('#bycatch', root).innerHTML = chips(trip, 'aji.bycatch', fish, true);
  };

  const refreshPlace = () => {
    const ps = placeSetting(trip.river);
    $('#side-pick', root).hidden = !trip.river || !!ps;
    setTheme(placeColor(trip.river));
    const st = placeStats(state.trips.filter((t) => t.id !== trip.id), trip.river);
    $('#place-stats', root).innerHTML = st
      ? `📍 この港の過去 ${st.trips}回：平均${st.avg}匹・最多${st.best}匹${st.max ? `・最大${st.max}cm` : ''}`
      : '';
  };

  const refreshEndNote = () => {
    $('#end-note', root).textContent = endsNextDay(trip) ? `翌日の ${trip.endTime} として記録します` : '';
  };

  // 作戦ボード：同じ港・同じ側で条件の近い過去の釣行
  const lureText = (t) => ['jigheads', 'worms', 'ranges', 'actions'].map((k) => starText(t.aji[k].filter((x) => x.star), k)).filter(Boolean).join('　');
  const refreshBoard = () => {
    const list = similarTrips(state.trips, trip, trip.id, 3);
    $('#board', root).innerHTML = !trip.river
      ? '<p class="muted">港を選ぶと、似た条件の過去の釣行が出ます。</p>'
      : !list.length
        ? `<p class="muted">${esc(trip.river)}${aji.side ? `や${esc(sideName(aji.side))}` : ''}の過去の記録がまだありません。記録がたまるほど役に立ちます。</p>`
        : `<p class="muted">港・潮回り・常夜灯・風・時間帯などが近い順です。</p>${list.map(({ trip: t, why }) => `
          <div class="board-item" style="--river:${esc(placeColor(t.river))}">
            <div class="board-head"><b>${formatDate(t.date)}</b> ${esc(t.river)}<span class="board-count">${esc(t.count)}匹${has(t.maxSize) ? `・${esc(t.maxSize)}cm` : ''}</span></div>
            ${t.title ? `<div class="board-title">「${esc(t.title)}」</div>` : ''}
            <div class="board-meta">${esc([formatTimeRange(t), t.aji.tide.shiomawari, t.aji.light ? `常夜灯${t.aji.light}` : '', formatWind(t)].filter(Boolean).join('・'))}</div>
            ${t.jiai.length || t.aji.tideStages.length ? `<div class="board-meta">${esc([...t.jiai, ...t.aji.tideStages].join('・'))}</div>` : ''}
            ${lureText(t) ? `<div class="board-tackle">${esc(lureText(t))}</div>` : ''}
            ${tackleSummary(t.aji.tackle) ? `<div class="board-meta">${esc(tackleSummary(t.aji.tackle))}</div>` : ''}
            <div class="board-foot">
              <span class="board-why">${why.map((w) => `<span>${esc(w)}</span>`).join('')}</span>
              ${lureText(t) || tackleSummary(t.aji.tackle) ? `<button type="button" class="btn small" data-act="use-trip" data-id="${t.id}">これを使う</button>` : ''}
            </div>
          </div>`).join('')}`;
  };

  // 天気・風の自動入力。silent=true は港や時刻を入れたときの自動実行
  const fillWeather = async (silent) => {
    const ps = placeSetting(trip.river);
    let lat = ps?.lat, lon = ps?.lon;
    if (!has(lat) || !has(lon)) {
      if (silent) return;
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
        lat = pos.coords.latitude; lon = pos.coords.longitude;
      } catch { toast('位置がわかりません。設定画面で港の位置を入れてください'); return; }
    }
    const note = $('#weather-note', root);
    note.textContent = '取得中…';
    try {
      const w = await fetchWeather(lat, lon, trip.date || todayISO(), trip.startTime, trip.endTime);
      if (w.weather) trip.weather = w.weather;
      if (w.tempMorning !== null) trip.tempMorning = w.tempMorning;
      if (w.tempMax !== null) trip.tempMax = w.tempMax;
      if (w.tempStart !== null) aji.tempStart = w.tempStart;
      if (w.windDir) aji.windDir = w.windDir;
      if (w.windSpeed !== null) aji.windSpeed = w.windSpeed;
      if (w.windMax !== null) aji.windMax = w.windMax;
      aji.weatherAuto = true;
      refreshInputs(); touch(); refreshBoard();
      note.textContent = `${trip.river || '現在地'}付近の${trip.startTime ? '釣りの時間帯' : '18〜24時'}の予報を入れました`;
    } catch {
      note.textContent = '';
      if (!silent) toast(navigator.onLine ? '天気を取得できませんでした（16日より先の日付は取得できません）' : '電波がないため天気を取得できません');
    }
  };
  const weatherEmpty = () => !trip.weather && !has(trip.tempMax) && !has(aji.windSpeed) && !aji.windDir;

  const renderMoves = () => {
    $('#moves', root).innerHTML = trip.moves.map((m, i) => `
      <div class="move-row" data-mi="${i}">
        <input data-mf="time" data-time inputmode="numeric" maxlength="5" placeholder="時刻" value="${esc(m.time)}">
        <input data-mf="river" list="dl-river" placeholder="港" value="${esc(m.river)}">
        <button type="button" data-act="del-move" aria-label="この移動先を削除">×</button>
      </div>`).join('');
  };

  const renderPhotos = () => {
    $('#photo-edit', root).innerHTML = trip.photos.map((p) => `
      <div class="thumb"><img src="${p.data}" alt=""><button type="button" data-act="del-photo" data-id="${p.id}" aria-label="写真を削除">×</button></div>`).join('');
  };

  // 満潮・干潮の入力欄 → 記録（空の欄は入れない。午前の時刻は翌日とみなす）
  const syncTide = () => {
    for (const key of ['highs', 'lows']) {
      aji.tide[key] = slots[key].filter((x) => x.time || has(x.cm))
        .map((x) => ({ time: x.time, cm: has(x.cm) ? Number(x.cm) : null, nextDay: isNextDayTime(trip, x.time) }));
    }
  };

  bindControls(root, trip, (path) => {
    if (path === 'river') {
      const ps = placeSetting(trip.river);
      if (ps) aji.side = ps.side;
      refreshInputs();
      refreshPlace();
      if ((weatherEmpty() || aji.weatherAuto) && navigator.onLine) fillWeather(true);
    }
    if (path === 'date') {
      const next = shiomawari(trip.date);
      if (!aji.tide.shiomawari || aji.tide.shiomawari === autoShio) aji.tide.shiomawari = next;
      autoShio = next;
      refreshInputs();
    }
    if (WEATHER_PATHS.includes(path)) aji.weatherAuto = false;
    // 時刻や日付を入れたら、自動入力のままの天気・風を取り直す
    if (['startTime', 'endTime', 'date'].includes(path) && aji.weatherAuto && navigator.onLine) fillWeather(true);
    if (path === 'startTime' || path === 'endTime') { syncTide(); refreshEndNote(); }
    if (['river', 'date', 'startTime', 'aji.side', 'aji.light', 'aji.windDir', 'aji.windSpeed', 'aji.tide.shiomawari'].includes(path)) refreshBoard();
    touch();
  });

  // 満潮・干潮の入力
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-tide]');
    if (!el || el.dataset.tf === 'time') return; // 時刻は入力を終えたときに整える
    slots[el.dataset.tide][Number(el.dataset.i)].cm = el.value === '' ? null : Number(el.value);
    aji.tide.auto = false;
    syncTide(); touch();
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-tide][data-tf="time"]');
    if (!el) return;
    const v = normalizeTime(el.value);
    if (v === null) return; // 「4桁で入力してください」は共通の処理が出す
    el.value = v;
    slots[el.dataset.tide][Number(el.dataset.i)].time = v;
    aji.tide.auto = false;
    syncTide(); touch();
  });

  // 移動先の入力
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-mf]');
    if (!el) return;
    trip.moves[Number(el.closest('.move-row').dataset.mi)][el.dataset.mf] = el.value;
    touch();
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-mf="time"]');
    if (!el) return;
    const v = normalizeTime(el.value);
    if (v === null) return;
    el.value = v;
    trip.moves[Number(el.closest('.move-row').dataset.mi)].time = v;
    touch();
  });

  root.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      await save();
      $$('.seg button', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('.pane', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
      if (!isNew) history.replaceState(null, '', `#/edit/${trip.id}?tab=${tab}`);
      $('#view').scrollTop = 0;
      return;
    }
    const el = e.target.closest('[data-act]');
    const act = el?.dataset.act;
    if (act === 'weather') {
      fillWeather(false);
    } else if (act === 'use-trip') {
      // 仕掛けと、★だったジグヘッド・ワームを「使った」として入れる
      const src = state.trips.find((t) => t.id === el.dataset.id);
      for (const [k, v] of Object.entries(src.aji.tackle)) if (v) aji.tackle[k] = v;
      for (const type of ['jigheads', 'worms']) {
        for (const it of src.aji[type].filter((x) => x.star)) {
          const key = starKey(type, it);
          if (!starState(aji[type], type, key)) aji[type] = cycleStar(aji[type], type, key);
        }
      }
      refreshInputs(); renderLures(); touch();
      toast(`${formatDate(src.date)}の仕掛けと★のジグヘッド・ワームを入れました`);
    } else if (act === 'copy-last') {
      const last = latestOtherTrip(trip.id);
      if (!last) return toast('前回の仕掛けがありません');
      aji.tackle = { ...aji.tackle, ...clone(last.aji.tackle) };
      refreshInputs(); touch();
      toast(`${formatDate(last.date)}の仕掛けを入れました`);
    } else if (act === 'save-preset') {
      if (!Object.values(aji.tackle).some(Boolean)) return toast('仕掛けを入力してから保存してください');
      const name = prompt('プリセットの名前', aji.tackle.rod || 'いつもの仕掛け');
      if (!name) return;
      const p = { id: uid(), name, kind: KIND, tackle: clone(aji.tackle) };
      await db.put('presets', p);
      state.presets.push(p);
      $('#preset-select', root).insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
      toast('プリセットに保存しました');
    } else if (act === 'add-jig') {
      const inp = $('#add-jig', root);
      const g = Number(inp.value);
      if (!inp.value || !(g > 0)) return toast('重さを数字で入れてください（例: 0.5）');
      if (!starState(aji.jigheads, 'jigheads', String(g))) aji.jigheads = cycleStar(aji.jigheads, 'jigheads', String(g));
      inp.value = '';
      renderLures(); touch();
    } else if (act === 'add-worm') {
      const name = $('#add-worm-name', root).value.trim(), color = $('#add-worm-color', root).value.trim();
      if (!name) return toast('ワームの名前を入れてください');
      const key = starKey('worms', { name, color });
      if (!starState(aji.worms, 'worms', key)) aji.worms = cycleStar(aji.worms, 'worms', key);
      $('#add-worm-name', root).value = ''; $('#add-worm-color', root).value = '';
      renderLures(); touch();
    } else if (act === 'add-bycatch') {
      const inp = $('#add-bycatch', root);
      const name = inp.value.trim();
      if (!name) return;
      if (!aji.bycatch.includes(name)) aji.bycatch.push(name);
      inp.value = '';
      renderLures(); touch();
    } else if (act === 'add-move') {
      trip.moves.push({ time: '', river: '', point: '' });
      renderMoves(); touch();
      $$('.move-row input[data-mf="time"]', root).pop()?.focus();
    } else if (act === 'del-move') {
      trip.moves.splice(Number(el.closest('.move-row').dataset.mi), 1);
      renderMoves(); touch();
    } else if (act === 'voice') {
      const rec = new SpeechRec();
      rec.lang = 'ja-JP';
      rec.interimResults = false;
      el.disabled = true;
      el.textContent = '🎤 聞き取り中…話してください';
      rec.onresult = (ev) => {
        const text = ev.results[0][0].transcript;
        trip.memo = trip.memo ? `${trip.memo}\n${text}` : text;
        $('textarea[data-path="memo"]', root).value = trip.memo;
        touch();
      };
      rec.onerror = (ev) => toast(ev.error === 'network' ? '音声入力には電波が必要です' : '音声を聞き取れませんでした');
      rec.onend = () => { el.disabled = false; el.textContent = '🎤 音声で入力'; };
      rec.start();
    } else if (act === 'del-photo') {
      trip.photos = trip.photos.filter((p) => p.id !== el.dataset.id);
      renderPhotos(); touch();
    } else if (act === 'delete') {
      if (isNew && !dirty) { location.hash = '#/'; return; }
      if (!confirm(`${formatDate(trip.date)} ${trip.river} の釣行を削除しますか？`)) return;
      clearTimeout(timer);
      dirty = false;
      state.onLeave = null;
      await db.del('trips', trip.id);
      state.trips = state.trips.filter((t) => t.id !== trip.id);
      state.currentId = null;
      toast('削除しました');
      location.hash = '#/';
    }
  });

  $('#preset-select', root).addEventListener('change', (e) => {
    const p = state.presets.find((x) => x.id === e.target.value);
    e.target.value = '';
    if (!p) return;
    aji.tackle = { ...aji.tackle, ...clone(p.tackle) };
    refreshInputs(); touch();
    toast(`「${p.name}」を入れました`);
  });

  $('#photo-input', root).addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('写真を取り込み中…');
    for (const f of files) {
      try { trip.photos.push({ id: uid(), data: await resizeImage(f) }); } catch { toast('読み込めない写真がありました'); }
    }
    renderPhotos(); touch();
  });

  $('#done').addEventListener('click', async () => {
    await save();
    state.onLeave = null;
    celebrateIfRecord();
    if (state.trips.some((t) => t.id === trip.id)) state.currentId = trip.id;
    location.hash = '#/';
  });

  refreshPlace();
  refreshEndNote();
  refreshBoard();
  renderLures();
  renderMoves();
  renderPhotos();
}

// 自己ベスト更新のお祝い
function celebrate(recs) {
  const ov = document.createElement('div');
  ov.className = 'celebrate';
  ov.innerHTML = `<div class="celebrate-box">
    <div class="celebrate-icon">🏆</div>
    <div class="celebrate-title">自己ベスト更新！</div>
    ${recs.map((r) => `<div class="celebrate-row">${r.kind} <b>${esc(r.value)}</b><span>（これまで ${esc(r.prev)}）</span></div>`).join('')}
    <div class="confetti">${'🐟🎉✨'.repeat(4)}</div>
  </div>`;
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
  setTimeout(() => ov.remove(), 4000);
}

// ---------- 検索 ----------
function viewSearch() {
  setActiveTab('search');
  const q = { ...emptyQuery(), ...state.query };
  const root = mount(`<div class="top-title"><div>検索</div><div class="pos" id="hit"></div></div>`);
  const seasonOpts = seasons(state.trips);
  const jigs = uniq([...JIG_WEIGHTS, ...state.trips.flatMap((t) => t.aji.jigheads.map((j) => Number(j.g)))].map(String)).sort((a, b) => a - b);

  root.innerHTML = `
    <form class="form" autocomplete="off" onsubmit="return false">
      ${field('言葉でさがす', input(q, 'text', 'type="search" placeholder="ワーム・外道・メモなど（空白で区切ると両方を含むもの）"'))}
      ${group('側', chips(q, 'side', Object.entries(SIDES)))}
      ${group('港', chips(q, 'river', placeNames()))}
      <div class="row2">
        ${field('年', `<select data-path="season"><option value="">すべて</option>${seasonOpts.map((y) => `<option value="${y}" ${String(q.season) === String(y) ? 'selected' : ''}>${y}年</option>`).join('')}</select>`)}
        ${field('匹数', `<div class="with-unit">${numInput(q, 'minCount', 'inputmode="numeric" min="0"')}<span>匹以上</span></div>`)}
      </div>
      <div class="row2">
        ${field('期間（から）', input(q, 'from', 'type="date"'))}
        ${field('期間（まで）', input(q, 'to', 'type="date"'))}
      </div>
      ${group('潮回り', chips(q, 'shiomawari', SHIOMAWARI))}
      ${group('常夜灯', chips(q, 'light', LIGHTS))}
      ${group('ジグヘッドの重さ', chips(q, 'jig', jigs.map((g) => [g, starLabel('jigheads', { g })])))}
      <div class="tools">
        <button type="button" class="btn primary" data-act="show">カードで見る</button>
        <button type="button" class="btn" data-act="clear">条件をクリア</button>
      </div>
    </form>
    <ul class="result-list" id="results"></ul>`;

  const refresh = () => {
    const list = sortTrips(filterTrips(state.trips, q)).reverse();
    $('#hit').textContent = `${list.length}件`;
    $('#results', root).innerHTML = list.slice(0, 100).map((t) => `
      <li><button type="button" data-open="${t.id}" style="--river:${esc(placeColor(t.river))}">
        <span class="r-date">${formatDate(t.date)}</span>
        <span class="r-main">${esc(t.river)} ${esc(t.title)}</span>
        <span class="r-num">${has(t.count) ? esc(t.count) + '匹' : '-'}${has(t.maxSize) ? ` / ${esc(t.maxSize)}cm` : ''}</span>
      </button></li>`).join('') || '<li class="muted">当てはまる釣行がありません</li>';
  };

  bindControls(root, q, refresh);
  root.addEventListener('change', (e) => {
    if (e.target.matches('select[data-path]')) { setPath(q, e.target.dataset.path, e.target.value); refresh(); }
  });
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (open || act === 'show') {
      state.query = { ...q };
      state.currentId = open ? open.dataset.open : null;
      location.hash = '#/';
    } else if (act === 'clear') {
      state.query = emptyQuery();
      viewSearch();
    }
  });
  refresh();
}

// ---------- 年ごとのまとめ ----------
function viewSeason(season) {
  setActiveTab('season');
  const years = seasons(state.trips);
  const year = Number(season) || years[0] || new Date().getFullYear();
  const trips = state.trips.filter((t) => seasonOf(t) === year);
  const s = summarize(trips);

  const root = mount(`<div class="top-title"><div>まとめ</div></div>
    <select id="season-select" class="top-select" aria-label="年">
      ${(years.length ? years : [year]).map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('')}
    </select>`);

  const table = (head, rows) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">まだ記録がありません</p>';
  const catchTable = (first, rows, labelOf) => table([first, '回数', '匹数', '平均', '最大'], rows.map((r) => [esc(labelOf(r)), r.trips, r.count, r.avg, r.max]));
  const starTable = (first, rows) => table([first, '★良かった', '使った'], rows.slice(0, 5).map((r) => [esc(r.label), r.stars ? `★ ${r.stars}` : '-', r.used]));

  root.innerHTML = trips.length ? `
    <div class="tiles">
      <div class="tile"><span>釣行回数</span><b>${s.tripCount}</b>回</div>
      <div class="tile"><span>総匹数</span><b>${s.totalCount}</b>匹</div>
      <div class="tile"><span>平均</span><b>${s.avgCount}</b>匹/回</div>
      <div class="tile"><span>最大サイズ</span><b>${s.maxSize ?? '-'}</b>cm</div>
      <div class="tile"><span>最多釣果</span><b>${s.bestTrip ? esc(s.bestTrip.count) : '-'}</b>匹</div>
      <div class="tile"><span>総バラシ</span><b>${s.totalBare}</b>回</div>
    </div>
    ${s.maxTrip ? `<p class="note">最大：${formatDate(s.maxTrip.date)} ${esc(s.maxTrip.river)}</p>` : ''}
    ${s.bestTrip ? `<p class="note">最多：${formatDate(s.bestTrip.date)} ${esc(s.bestTrip.river)}</p>` : ''}

    <h3>港別</h3>
    ${catchTable('港', s.byRiver, (r) => r.river)}
    <p class="muted">途中で港を移動した日は、最初の港で数えています。</p>
    <h3>側別</h3>
    ${catchTable('側', s.bySide, (r) => r.label)}
    <h3>月別</h3>
    ${catchTable('月', s.byMonth, (r) => `${r.month}月`)}
    <h3>潮回り別</h3>
    ${catchTable('潮回り', s.byShio, (r) => r.shio)}

    <h3>★ 良かったもの（多い順・5位まで）</h3>
    ${starTable('ジグヘッド', s.stars.jigheads)}
    <div class="gap"></div>${starTable('ワーム', s.stars.worms)}
    <div class="gap"></div>${starTable('レンジ', s.stars.ranges)}
    <div class="gap"></div>${starTable('誘い方', s.stars.actions)}

    <button type="button" class="btn line wide" id="season-image">🖼 まとめ画像をLINEで送る</button>
    <button type="button" class="btn primary wide" id="export">📊 ${year}年をExcelで出力</button>
  ` : `<div class="empty"><p>${year}年の釣行はまだありません。</p></div>`;

  $('#season-select').addEventListener('change', (e) => { location.hash = `#/season/${e.target.value}`; });
  $('#season-image', root)?.addEventListener('click', async () => {
    toast('画像を作成中…');
    const blob = await renderSeasonImage(year, s, placeColor);
    const r = await shareBlob(blob, `アジ日記_${year}年まとめ.png`, `【アジ日記】${year}年 ${s.tripCount}回 ${s.totalCount}匹${s.maxSize ? ` 最大${s.maxSize}cm` : ''}`);
    if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
  });
  $('#export', root)?.addEventListener('click', () => {
    const bytes = seasonXlsx(trips, year);
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `アジ日記_${year}年.xlsx`);
    toast('Excelファイルを保存しました');
  });
}

// ---------- 設定 ----------
function viewSettings() {
  setActiveTab('settings');
  const root = mount(`<div class="top-title"><div>設定</div></div>`);

  const render = () => {
    root.innerHTML = `
      <h3>画面の明るさ</h3>
      <div class="chips" id="mode">
        <button type="button" class="chip${state.theme !== 'light' ? ' on' : ''}" data-mode-set="dark">🌙 暗い画面（夜釣り向け）</button>
        <button type="button" class="chip${state.theme === 'light' ? ' on' : ''}" data-mode-set="light">☀ 明るい画面</button>
      </div>

      <h3>港</h3>
      <p class="muted">ここにある港は入力画面でワンタップ選択できます。色はカードや画面の色になります。位置（緯度・経度）は天気・風の自動入力に使います。最初はおおよその値なので、その港で「今いる場所を位置に」を押すと正確になります。</p>
      <div class="river-list">
        ${state.places.map((r, i) => `
          <details class="river-item" data-i="${i}" style="--river:${esc(r.color || THEME_COLOR)}">
            <summary><b>${esc(r.name || '（名前なし）')}</b><span class="muted">${esc(sideName(r.side))}</span></summary>
            <div class="row2">
              ${field('港の名前', `<input data-rf="name" value="${esc(r.name)}">`)}
              ${field('側', `<select data-rf="side">${Object.entries(SIDES).map(([k, v]) => `<option value="${k}" ${r.side === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
            </div>
            <div class="row3">
              ${field('緯度', `<input data-rf="lat" type="number" step="0.01" inputmode="decimal" value="${esc(r.lat ?? '')}">`)}
              ${field('経度', `<input data-rf="lon" type="number" step="0.01" inputmode="decimal" value="${esc(r.lon ?? '')}">`)}
              ${field('潮の補正', `<div class="with-unit"><input data-rf="tideOffsetMin" type="number" step="1" inputmode="numeric" value="${esc(r.tideOffsetMin ?? 0)}"><span>分</span></div>`)}
            </div>
            <div class="tools">
              <label class="color-pick"><input data-rf="color" type="color" value="${esc(r.color || THEME_COLOR)}">色</label>
              <button type="button" class="btn small" data-act="here">📍 今いる場所を位置に</button>
              <button type="button" class="btn small danger" data-act="del-river">この港を外す</button>
            </div>
          </details>`).join('')}
      </div>
      <button type="button" class="btn small" data-act="add-river">＋ 港を追加</button>

      <h3>仕掛けプリセット</h3>
      ${state.presets.length ? `<ul class="preset-list">${state.presets.map((p) => `
        <li><div><b>${esc(p.name)}</b><div class="muted">${esc(tackleSummary(p.tackle))}</div></div>
        <button type="button" class="btn small danger" data-act="del-preset" data-id="${p.id}">削除</button></li>`).join('')}</ul>`
        : '<p class="muted">入力画面の「仕掛け」欄にある「プリセットに保存」から登録できます。</p>'}

      <h3>バックアップ</h3>
      <p class="muted">記録はこのスマホの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどき書き出してください。（現在 ${state.trips.length} 件）</p>
      <div class="tools">
        <button type="button" class="btn" data-act="backup">書き出す</button>
        <label class="btn"><input type="file" accept="application/json,.json" hidden id="restore">読み込む</label>
      </div>
      <p class="muted">読み込んでも、今ある記録は消えません（同じ記録は新しい方を残します）。</p>

      <h3>このアプリについて</h3>
      <p class="muted">アジ日記 v${APP_VERSION}<br>Androidでは Chrome のメニューから「ホーム画面に追加」（または「アプリをインストール」）すると、アプリとして使えます。電波のない堤防でも動きます（音声入力と天気・風の自動入力だけは電波が必要です）。天気は Open-Meteo の予報データを使っています。</p>
    `;
  };

  const savePlaces = async () => { await db.setKV('places', state.places); };

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-rf]');
    if (!el) return;
    const item = el.closest('.river-item');
    const i = Number(item.dataset.i);
    const rf = el.dataset.rf;
    const numeric = ['lat', 'lon', 'tideOffsetMin'].includes(rf);
    state.places[i][rf] = numeric ? (el.value === '' ? (rf === 'tideOffsetMin' ? 0 : null) : Number(el.value)) : el.value.trim();
    if (rf === 'color') item.style.setProperty('--river', el.value);
    if (rf === 'name') $('summary b', item).textContent = el.value.trim() || '（名前なし）';
    if (rf === 'side') $('summary span', item).textContent = sideName(el.value);
    savePlaces();
  });

  root.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-mode-set]');
    if (mode) {
      state.theme = mode.dataset.modeSet;
      await db.setKV('theme', state.theme);
      applyMode(); render();
      return;
    }
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (act === 'here') {
      const i = Number(btn.closest('.river-item').dataset.i);
      navigator.geolocation.getCurrentPosition((pos) => {
        state.places[i].lat = Math.round(pos.coords.latitude * 1000) / 1000;
        state.places[i].lon = Math.round(pos.coords.longitude * 1000) / 1000;
        savePlaces(); render();
        $(`.river-item[data-i="${i}"]`, root).open = true;
        toast('今いる場所を登録しました');
      }, () => toast('位置を取得できませんでした（位置情報の許可を確認してください）'), { timeout: 10000 });
    } else if (act === 'add-river') {
      state.places.push({ name: '', side: 'seto', color: SIDE_COLOR.seto, lat: null, lon: null, tideOffsetMin: 0 });
      await savePlaces(); render();
      const last = $$('.river-item', root).pop();
      last.open = true;
      $('input[data-rf="name"]', last)?.focus();
    } else if (act === 'del-river') {
      const i = Number(btn.closest('.river-item').dataset.i);
      if (!confirm(`「${state.places[i].name || '（名前なし）'}」をボタンから外しますか？（過去の記録は消えません）`)) return;
      state.places.splice(i, 1);
      await savePlaces(); render();
    } else if (act === 'del-preset') {
      const p = state.presets.find((x) => x.id === btn.dataset.id);
      if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
      await db.del('presets', p.id);
      state.presets = state.presets.filter((x) => x.id !== p.id);
      render();
    } else if (act === 'backup') {
      // 鮎日記のバックアップと同じ形（app・version・exportedAt・trips・presets＋港の設定）
      const data = { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), trips: state.trips, presets: state.presets, places: state.places };
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `アジ日記_バックアップ_${todayISO()}.json`);
      toast('バックアップを保存しました');
    }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'restore') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('バックアップファイルを読み込めませんでした'); }
    if (data?.app === 'ayu-nikki') return toast('これは鮎日記のバックアップです。アジ日記には読み込めません');
    if (data?.app !== APP_ID || !Array.isArray(data.trips)) return toast('アジ日記のバックアップファイルではないようです');
    try {
      // 今ある記録は消さない。同じ記録は新しい方を残す
      const mine = new Map(state.trips.map((t) => [t.id, t]));
      const trips = data.trips.filter((t) => !t.kind || t.kind === KIND).map(normalizeTrip)
        .filter((t) => !mine.has(t.id) || (t.updatedAt || '') > (mine.get(t.id).updatedAt || ''));
      if (!confirm(`${data.trips.length}件のうち、新しい記録 ${trips.length}件を読み込みます。今ある記録は消えません。よろしいですか？`)) return;
      await db.putMany('trips', trips);
      if (Array.isArray(data.presets)) {
        const have = new Set(state.presets.map((p) => p.id));
        await db.putMany('presets', data.presets.filter((p) => !have.has(p.id)));
      }
      if (Array.isArray(data.places)) {
        const names = new Set(state.places.map((p) => p.name));
        state.places.push(...data.places.filter((p) => p.name && !names.has(p.name)));
        await savePlaces();
      }
      await load();
      toast(`${trips.length}件を読み込みました`);
      render();
    } catch {
      toast('読み込みの途中で失敗しました。今ある記録はそのままです');
    }
  });

  render();
}

// ---------- ルーティング ----------
async function route() {
  if (state.onLeave) {
    const fn = state.onLeave;
    state.onLeave = null;
    await fn();
  }
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  switch (parts[0]) {
    case 'new': return viewNew(params.get('fresh') === '1');
    case 'edit': return viewEdit(parts[1], params.get('tab') || 'before');
    case 'search': return viewSearch();
    case 'season': return viewSeason(parts[1]);
    case 'settings': return viewSettings();
    default: return viewCards();
  }
}

async function load() {
  state.trips = (await db.getAll('trips')).map(normalizeTrip);
  state.presets = await db.getAll('presets');
  const places = await db.getKV('places', clone(DEFAULT_PLACES));
  // 欠けた項目（色・位置・潮の補正）を初期値で補う
  state.places = places.map((r) => {
    const d = defaultPlace(r.name);
    const side = r.side || d?.side || 'seto';
    return { lat: d?.lat ?? null, lon: d?.lon ?? null, tideOffsetMin: 0, ...r, side, color: r.color || d?.color || SIDE_COLOR[side] };
  });
  state.theme = await db.getKV('theme', 'dark');
}

async function start() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>データを読み込めませんでした。</p><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  applyMode();
  window.addEventListener('hashchange', route);
  // 画面を閉じる・アプリを切り替えるときも保存する
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') state.onLeave?.(); });
  window.addEventListener('pagehide', () => state.onLeave?.());
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const deck = $('#deck');
    if (deck && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      deck.scrollBy({ left: (e.key === 'ArrowLeft' ? -1 : 1) * deck.clientWidth, behavior: 'smooth' });
    }
  });
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
