import * as db from './db.js';
import {
  DEFAULT_RIVER_SETTINGS, THEME_COLOR, defaultRiverColor, defaultRiverPos,
  WEATHER, LEVEL_WORDS, CLARITY, AKA, SIZE_FEEL, JIAI, SPOTS, METHODS, TACKLE_FIELDS,
  newTrip, normalizeTrip, sortTrips, formatDate, formatLevel, formatWeather, formatMoves, normalizeTime, tackleSummary,
  has, num, uid, todayISO, seasonOf,
} from './model.js';
import { emptyQuery, isEmptyQuery, filterTrips, describeQuery } from './search.js';
import { summarize, seasons } from './stats.js';
import { seasonXlsx } from './export.js';
import { shareTrip, downloadBlob, renderSeasonImage, shareBlob } from './share.js';
import { pointStats, similarTrips, personalBests, recordBadges, newRecords } from './insights.js';
import { fetchWeather } from './weather.js';

const APP_VERSION = '0.1.0';

const state = {
  trips: [],
  presets: [],
  rivers: DEFAULT_RIVER_SETTINGS,
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
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
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

function riverSetting(name) {
  return state.rivers.find((r) => r.name === name);
}
function riverColor(name) {
  return riverSetting(name)?.color || (name ? defaultRiverColor(name) : THEME_COLOR);
}
function riverNames() {
  return uniq([...state.rivers.map((r) => r.name), ...state.trips.map((t) => t.river)]);
}

function setTheme(color = THEME_COLOR) {
  $('#top').style.background = color;
  $('meta[name="theme-color"]')?.setAttribute('content', color);
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
function timeInput(obj, path) {
  return input(obj, path, 'data-time inputmode="numeric" maxlength="5" placeholder="例: 0730"');
}
function chips(obj, path, options, multi = false) {
  const v = getPath(obj, path);
  const on = (o) => (multi ? (v || []).includes(o) : v === o);
  return `<div class="chips" data-path="${path}" data-mode="${multi ? 'multi' : 'single'}">${options
    .map((o) => `<button type="button" class="chip${on(o) ? ' on' : ''}" data-chip="${esc(o)}">${esc(o)}</button>`)
    .join('')}</div>`;
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
      if (box.dataset.mode === 'multi') {
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
    if (v === null) { toast('時刻は 0730 のように4桁で入力してください'); return; }
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
const cell = (label, value, wide = false) => (value ? `<div class="cell${wide ? ' wide' : ''}"><span>${label}</span>${value}</div>` : '');
const tags = (arr, cls = '') => (arr || []).map((v) => `<span class="pill ${cls}">${esc(v)}</span>`).join('');

function cardHtml(t) {
  const color = riverColor(t.river);
  const rs = riverSetting(t.river);
  const moves = formatMoves(t);
  const photo = t.photos?.[0]?.data;
  const time = t.startTime || t.endTime ? `${esc(t.startTime || '?')}〜${esc(t.endTime || '?')}` : '';
  const weather = formatWeather(t);
  const ps = pointStats(state.trips, t.river, t.point);
  const badges = recordBadges(state.trips, t);
  const level = formatLevel(t);
  const tk = TACKLE_FIELDS.filter(([k]) => t.tackle?.[k]);

  return `<article class="card" data-id="${t.id}" style="--river:${esc(color)}">
    <header class="card-head${photo ? ' has-photo' : ''}" ${photo ? `data-bg="${photo}"` : ''}>
      <div class="card-date">${formatDate(t.date)}${time ? `<span>${time}</span>` : ''}</div>
      <div class="card-place"><b>${esc(t.river || '河川未入力')}</b>${t.point ? ` ${esc(t.point)}` : ''}</div>
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
    ${ps && ps.trips >= 2 ? `<div class="point-stats">📍 このポイント 全${ps.trips}回・平均${ps.avg}匹・最多${ps.best}匹${ps.max ? `・最大${ps.max}cm` : ''}</div>` : ''}
    ${(t.jiai?.length || t.spots?.length || t.methods?.length || t.spotsNote) ? `<section class="pills">
      ${t.jiai?.length ? `<div><em>時合</em>${tags(t.jiai)}</div>` : ''}
      ${t.spots?.length || t.spotsNote ? `<div><em>場所</em>${tags(t.spots)}${t.spotsNote ? `<span class="pill plain">${esc(t.spotsNote)}</span>` : ''}</div>` : ''}
      ${t.methods?.length ? `<div><em>釣り方</em>${tags(t.methods, 'method')}</div>` : ''}
    </section>` : ''}
    <section class="grid">
      ${cell('天気・気温', esc(weather), weather.length > 9)}
      ${cell('水温', has(t.waterTemp) ? `${esc(t.waterTemp)}℃` : '')}
      ${cell('濁り', esc(t.clarity))}
      ${cell('垢', esc(t.aka))}
      ${cell('水位', level ? esc(level) + (rs?.url ? ` <a href="${esc(rs.url)}" target="_blank" rel="noopener" class="mini-link">↗</a>` : '') : '', true)}
    </section>
    ${tk.length ? `<section class="grid tackle">${tk.map(([k, label]) => cell(label, esc(t.tackle[k]))).join('')}</section>` : ''}
    ${t.memo ? `<section class="memo" data-act="memo">${esc(t.memo)}</section>` : ''}
    ${t.photos?.length > 1 || (t.photos?.length === 1) ? `<section class="strip">${t.photos.map((p) => `<img data-src="${p.data}" alt="写真" data-act="photo">`).join('')}</section>` : ''}
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
      : `<div class="empty"><div class="empty-fish">🐟</div><p>まだ釣行の記録がありません。</p><p class="muted">川に入る前に「釣行前」を、上がったら「釣行後」を入力します。</p><a class="btn primary" href="#/new">最初の釣行を記録する</a></div>`);
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
    const r = await shareTrip(t, riverColor(t.river));
    if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
  };

  const deck = $('#deck');
  const update = () => {
    if (!deck.isConnected) return; // 別の画面へ移った後は何もしない
    const i = Math.max(0, Math.min(list.length - 1, Math.round(deck.scrollLeft / deck.clientWidth)));
    const t = list[i];
    state.currentId = t?.id;
    $('#pos').textContent = `${i + 1} / ${list.length}`;
    setTheme(riverColor(t?.river));
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
      <a class="choice" href="#/edit/${t.id}?tab=after" style="--river:${esc(riverColor(t.river))}">
        <span class="choice-date">${formatDate(t.date)}</span>
        <b>${esc(t.river || '河川未入力')} ${esc(t.point)}</b>
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
  return sortTrips(state.trips.filter((t) => t.id !== id && Object.values(t.tackle || {}).some(Boolean))).pop();
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function viewEdit(id, tab = 'before') {
  setActiveTab(id ? '' : 'new');
  const existing = id && state.trips.find((t) => t.id === id);
  if (id && !existing) { location.hash = '#/'; return; }
  const trip = existing ? clone(existing) : newTrip();
  let isNew = !existing;
  let dirty = false;
  let timer;
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
  setTheme(riverColor(trip.river));

  const setStatus = (s) => { const el = $('#save-status'); if (el) el.textContent = s; };

  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    trip.updatedAt = new Date().toISOString();
    await db.put('trips', clone(trip));
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

  const riverChips = state.rivers.map((r) => r.name);
  const tackleValues = (k) => [...state.trips.map((t) => t.tackle?.[k]), ...state.presets.map((p) => p.tackle?.[k])];
  const allPoints = state.trips.flatMap((t) => [t.point, ...(t.moves || []).map((m) => m.point)]);

  root.innerHTML = `
    <div class="seg" role="tablist">
      <button type="button" data-tab="before" class="${tab === 'before' ? 'on' : ''}">釣行前</button>
      <button type="button" data-tab="after" class="${tab === 'after' ? 'on' : ''}">釣行後</button>
    </div>

    <form class="form" autocomplete="off" onsubmit="return false">
    <div class="pane" data-pane="before" ${tab === 'before' ? '' : 'hidden'}>
      <div class="row2">
        ${field('日付', input(trip, 'date', 'type="date" required'))}
        ${field('開始時刻', timeInput(trip, 'startTime'))}
      </div>
      ${group('河川', `${chips(trip, 'river', riverChips)}${input(trip, 'river', 'list="dl-river" placeholder="その他の河川は入力"')}`)}
      ${field('ポイント', input(trip, 'point', 'list="dl-point" placeholder="例: 仕七川小学校前"'))}
      <div id="point-stats" class="hint"></div>

      <h3>状況</h3>
      <div class="tools"><button type="button" class="btn small" data-act="weather">☀ 天気・気温を自動入力</button><span class="muted" id="weather-note"></span></div>
      ${group('天気', chips(trip, 'weather', WEATHER))}
      <div class="row3">
        ${field('朝の気温', `<div class="with-unit">${numInput(trip, 'tempMorning', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('最高気温(予想)', `<div class="with-unit">${numInput(trip, 'tempMax', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('水温', `<div class="with-unit">${numInput(trip, 'waterTemp', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      ${group('水位', chips(trip, 'levelWord', LEVEL_WORDS))}
      <div class="row2">
        ${group('水位（数値）', `<div class="with-unit">
            <button type="button" class="sign" data-act="sign" aria-label="プラスマイナス切替">±</button>
            ${numInput(trip, 'levelCm', 'step="1" placeholder="例: -15"')}<span>cm</span></div>`)}
        ${field('観測所', input(trip, 'station', 'list="dl-station" placeholder="例: 仕出"'))}
      </div>
      <div id="level-link"></div>
      ${group('濁り', chips(trip, 'clarity', CLARITY))}
      ${group('垢の状態', chips(trip, 'aka', AKA))}

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
      ${TACKLE_FIELDS.map(([k, label, ph]) => field(label, input(trip, `tackle.${k}`, `list="dl-t-${k}" placeholder="${esc(ph)}"`))).join('')}

      <button type="button" class="btn wide" data-tab="after">釣行後の入力へ ›</button>
      <p class="muted center">釣行前の内容は自動で保存されています。釣行後のタブに移っても消えません。</p>
    </div>

    <div class="pane" data-pane="after" ${tab === 'after' ? '' : 'hidden'}>
      ${field('ひとこと（この日を一言で）', input(trip, 'title', 'maxlength="40" placeholder="例: 昼の荒瀬で大型連発"'))}
      ${field('終了時刻', timeInput(trip, 'endTime'))}
      ${group('匹数', stepper(trip, 'count', '匹'), 'big')}
      ${field('最大サイズ', `<div class="with-unit">${numInput(trip, 'maxSize', 'step="0.1" min="0"')}<span>cm</span></div>`)}
      ${group('バラシ', stepper(trip, 'bare', '回'))}
      ${group('サイズ感', chips(trip, 'sizeFeel', SIZE_FEEL))}
      ${group('時合（複数可）', chips(trip, 'jiai', JIAI, true))}
      ${group('釣れた場所（複数可）', `${chips(trip, 'spots', SPOTS, true)}${input(trip, 'spotsNote', 'placeholder="その他・詳しく（例: 大石の裏、左岸ヘチ）"')}`)}
      ${group('釣り方（複数可）', chips(trip, 'methods', METHODS, true))}

      <h3>移動した場所</h3>
      <p class="muted">途中でポイントや河川を変えたときだけ追加します。</p>
      <div id="moves"></div>
      <button type="button" class="btn small" data-act="add-move">＋ 移動先を追加</button>

      <h3>メモ・写真</h3>
      ${group('メモ', `<textarea data-path="memo" rows="5" placeholder="垢の付き具合、追い気、次回への反省など">${esc(trip.memo)}</textarea>
        ${SpeechRec ? '<button type="button" class="btn small mic" data-act="voice">🎤 音声で入力</button>' : ''}`)}
      ${group('写真', `<div class="photo-edit" id="photo-edit"></div>
        <label class="btn small"><input type="file" accept="image/*" multiple hidden id="photo-input">写真を追加</label>`)}

      <button type="button" class="btn wide danger" data-act="delete">この釣行を削除</button>
    </div>
    </form>
    ${datalist('dl-river', riverNames())}
    <datalist id="dl-point"></datalist>
    ${datalist('dl-point-all', allPoints)}
    ${datalist('dl-station', [...state.rivers.map((r) => r.station), ...state.trips.map((t) => t.station)])}
    ${TACKLE_FIELDS.map(([k]) => datalist(`dl-t-${k}`, tackleValues(k))).join('')}
  `;

  const refreshInputs = () => {
    $$('input[data-path], textarea[data-path]', root).forEach((el) => {
      const v = getPath(trip, el.dataset.path);
      if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('.chips', root).forEach((box) => {
      const v = getPath(trip, box.dataset.path);
      $$('.chip', box).forEach((c) => c.classList.toggle('on', box.dataset.mode === 'multi' ? (v || []).includes(c.dataset.chip) : v === c.dataset.chip));
    });
  };

  const refreshRiver = () => {
    const points = state.trips.filter((t) => t.river === trip.river && t.id !== trip.id).map((t) => t.point);
    $('#dl-point', root).innerHTML = uniq(points).map((p) => `<option value="${esc(p)}">`).join('');
    const rs = riverSetting(trip.river);
    $('#level-link', root).innerHTML = rs?.url
      ? `<a class="btn small level-btn" href="${esc(rs.url)}" target="_blank" rel="noopener">🌊 ${esc(rs.station || trip.river)}の水位を確認</a>`
      : '';
    setTheme(riverColor(trip.river));
  };

  const refreshPointStats = () => {
    const ps = pointStats(state.trips.filter((t) => t.id !== trip.id), trip.river, trip.point);
    $('#point-stats', root).innerHTML = ps
      ? `📍 このポイントの過去 ${ps.trips}回：平均${ps.avg}匹・最多${ps.best}匹${ps.max ? `・最大${ps.max}cm` : ''}`
      : '';
  };

  // 作戦ボード：同じ河川で条件の近い過去の釣行
  const refreshBoard = () => {
    const list = similarTrips(state.trips, trip, trip.id, 3);
    $('#board', root).innerHTML = !trip.river
      ? '<p class="muted">河川を選ぶと、似た条件の過去の釣行が出ます。</p>'
      : !list.length
        ? `<p class="muted">${esc(trip.river)}の過去の記録がまだありません。記録がたまるほど役に立ちます。</p>`
        : `<p class="muted">水位・濁り・垢・ポイントなどが近い順です。</p>${list.map(({ trip: t, why }) => `
          <div class="board-item" style="--river:${esc(riverColor(t.river))}">
            <div class="board-head"><b>${formatDate(t.date)}</b> ${esc(t.point)}<span class="board-count">${esc(t.count)}匹${has(t.maxSize) ? `・${esc(t.maxSize)}cm` : ''}</span></div>
            ${t.title ? `<div class="board-title">「${esc(t.title)}」</div>` : ''}
            <div class="board-meta">${esc([formatLevel(t), t.clarity, t.aka ? `垢${t.aka}` : ''].filter(Boolean).join('・'))}</div>
            ${t.methods?.length || t.spots?.length ? `<div class="board-meta">${esc([...(t.methods || []), ...(t.spots || [])].join('・'))}</div>` : ''}
            ${tackleSummary(t.tackle) ? `<div class="board-tackle">${esc(tackleSummary(t.tackle))}</div>` : ''}
            <div class="board-foot">
              <span class="board-why">${why.map((w) => `<span>${esc(w)}</span>`).join('')}</span>
              ${tackleSummary(t.tackle) ? `<button type="button" class="btn small" data-act="use-tackle" data-id="${t.id}">この仕掛けを使う</button>` : ''}
            </div>
          </div>`).join('')}`;
  };

  // 天気の自動入力。silent=true は河川を選んだときの自動実行（空欄のときだけ）
  const fillWeather = async (silent) => {
    const rs = riverSetting(trip.river);
    let lat = rs?.lat, lon = rs?.lon;
    if (!has(lat) || !has(lon)) {
      if (silent) return;
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
        lat = pos.coords.latitude; lon = pos.coords.longitude;
      } catch { toast('位置がわかりません。設定画面で河川の位置を入れてください'); return; }
    }
    const note = $('#weather-note', root);
    note.textContent = '取得中…';
    try {
      const w = await fetchWeather(lat, lon, trip.date || todayISO());
      if (w.weather) trip.weather = w.weather;
      if (w.tempMorning !== null) trip.tempMorning = w.tempMorning;
      if (w.tempMax !== null) trip.tempMax = w.tempMax;
      refreshInputs(); touch();
      note.textContent = `${trip.river || '現在地'}付近の予報を入れました`;
    } catch {
      note.textContent = '';
      if (!silent) toast(navigator.onLine ? '天気を取得できませんでした（16日より先の日付は取得できません）' : '電波がないため天気を取得できません');
    }
  };

  const renderMoves = () => {
    $('#moves', root).innerHTML = trip.moves.map((m, i) => `
      <div class="move-row" data-mi="${i}">
        <input data-mf="time" data-time inputmode="numeric" maxlength="5" placeholder="時刻" value="${esc(m.time)}">
        <input data-mf="river" list="dl-river" placeholder="河川" value="${esc(m.river)}">
        <input data-mf="point" list="dl-point-all" placeholder="ポイント" value="${esc(m.point)}">
        <button type="button" data-act="del-move" aria-label="この移動先を削除">×</button>
      </div>`).join('');
  };

  const renderPhotos = () => {
    $('#photo-edit', root).innerHTML = trip.photos.map((p) => `
      <div class="thumb"><img src="${p.data}" alt=""><button type="button" data-act="del-photo" data-id="${p.id}" aria-label="写真を削除">×</button></div>`).join('');
  };

  let prevRiver = trip.river;
  bindControls(root, trip, (path) => {
    if (path === 'river') {
      // 河川に観測所が設定されていれば自動で入れる（手で変えた値は上書きしない）
      const prevDefault = riverSetting(prevRiver)?.station || '';
      const nextDefault = riverSetting(trip.river)?.station || '';
      if (!trip.station || trip.station === prevDefault) trip.station = nextDefault;
      prevRiver = trip.river;
      refreshInputs();
      refreshRiver();
      // 天気が空欄なら自動で入れる
      if (!trip.weather && !has(trip.tempMorning) && !has(trip.tempMax) && navigator.onLine) fillWeather(true);
    }
    if (['river', 'point', 'levelWord', 'levelCm', 'station', 'clarity', 'aka', 'date'].includes(path)) {
      refreshPointStats();
      refreshBoard();
    }
    touch();
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
    } else if (act === 'use-tackle') {
      const src = state.trips.find((t) => t.id === el.dataset.id);
      trip.tackle = { ...trip.tackle, ...clone(src.tackle) };
      refreshInputs(); touch();
      toast(`${formatDate(src.date)}の仕掛けを入れました`);
    } else if (act === 'sign') {
      if (has(trip.levelCm)) { trip.levelCm = -Number(trip.levelCm); refreshInputs(); touch(); refreshBoard(); }
      else $('input[data-path="levelCm"]', root).focus();
    } else if (act === 'copy-last') {
      const last = latestOtherTrip(trip.id);
      if (!last) return toast('前回の仕掛けがありません');
      trip.tackle = { ...trip.tackle, ...clone(last.tackle) };
      refreshInputs(); touch();
      toast(`${formatDate(last.date)}の仕掛けを入れました`);
    } else if (act === 'save-preset') {
      if (!Object.values(trip.tackle).some(Boolean)) return toast('仕掛けを入力してから保存してください');
      const name = prompt('プリセットの名前', trip.tackle.mainLine || '');
      if (!name) return;
      const p = { id: uid(), name, tackle: clone(trip.tackle) };
      await db.put('presets', p);
      state.presets.push(p);
      $('#preset-select', root).insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
      toast('プリセットに保存しました');
    } else if (act === 'add-move') {
      trip.moves.push({ time: '', river: trip.moves.at(-1)?.river || trip.river, point: '' });
      renderMoves(); touch();
      $$('.move-row input[data-mf="point"]', root).pop()?.focus();
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
    trip.tackle = { ...trip.tackle, ...clone(p.tackle) };
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

  refreshRiver();
  refreshPointStats();
  refreshBoard();
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

  root.innerHTML = `
    <form class="form" autocomplete="off" onsubmit="return false">
      ${field('キーワード', input(q, 'text', 'type="search" placeholder="ポイント・仕掛け・釣り方・メモなど（空白でAND）"'))}
      ${group('河川', chips(q, 'river', riverNames()))}
      <div class="row2">
        ${field('シーズン', `<select data-path="season"><option value="">すべて</option>${seasonOpts.map((y) => `<option value="${y}" ${String(q.season) === String(y) ? 'selected' : ''}>${y}年</option>`).join('')}</select>`)}
        ${field('匹数', `<div class="with-unit">${numInput(q, 'minCount', 'inputmode="numeric" min="0"')}<span>匹以上</span></div>`)}
      </div>
      <div class="row2">
        ${field('期間（から）', input(q, 'from', 'type="date"'))}
        ${field('期間（まで）', input(q, 'to', 'type="date"'))}
      </div>
      ${group('水位', chips(q, 'levelWord', LEVEL_WORDS))}
      ${group('濁り', chips(q, 'clarity', CLARITY))}
      ${group('垢の状態', chips(q, 'aka', AKA))}
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
      <li><button type="button" data-open="${t.id}" style="--river:${esc(riverColor(t.river))}">
        <span class="r-date">${formatDate(t.date)}</span>
        <span class="r-main">${esc(t.river)} ${esc(t.title || t.point)}</span>
        <span class="r-num">${has(t.count) ? esc(t.count) + '匹' : '-'}${has(t.maxSize) ? ` / ${esc(t.maxSize)}cm` : ''}</span>
      </button></li>`).join('') || '<li class="muted">該当なし</li>';
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

// ---------- シーズンまとめ ----------
function viewSeason(season) {
  setActiveTab('season');
  const years = seasons(state.trips);
  const year = Number(season) || years[0] || new Date().getFullYear();
  const trips = state.trips.filter((t) => seasonOf(t) === year);
  const s = summarize(trips);

  const root = mount(`<div class="top-title"><div>シーズンまとめ</div></div>
    <select id="season-select" class="top-select" aria-label="シーズン">
      ${(years.length ? years : [year]).map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('')}
    </select>`);

  const table = (head, rows) => rows.length
    ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">データなし</p>';

  root.innerHTML = trips.length ? `
    <div class="tiles">
      <div class="tile"><span>釣行回数</span><b>${s.tripCount}</b>回</div>
      <div class="tile"><span>総匹数</span><b>${s.totalCount}</b>匹</div>
      <div class="tile"><span>平均</span><b>${s.avgCount}</b>匹/回</div>
      <div class="tile"><span>最大サイズ</span><b>${s.maxSize ?? '-'}</b>cm</div>
      <div class="tile"><span>最多釣果</span><b>${s.bestTrip ? esc(s.bestTrip.count) : '-'}</b>匹</div>
      <div class="tile"><span>総バラシ</span><b>${s.totalBare}</b>回</div>
    </div>
    ${s.maxTrip ? `<p class="note">最大：${formatDate(s.maxTrip.date)} ${esc(s.maxTrip.river)} ${esc(s.maxTrip.point)}</p>` : ''}
    ${s.bestTrip ? `<p class="note">最多：${formatDate(s.bestTrip.date)} ${esc(s.bestTrip.river)} ${esc(s.bestTrip.point)}</p>` : ''}

    <h3>河川別</h3>
    ${table(['河川', '回数', '匹数', '平均', '最大'], s.byRiver.map((r) => [esc(r.river), r.trips, r.count, r.avg, r.max]))}
    <p class="muted">途中で河川を移動した日は、最初の河川で数えています。</p>
    <h3>月別</h3>
    ${table(['月', '回数', '匹数', '平均', '最大'], s.byMonth.map((r) => [`${r.month}月`, r.trips, r.count, r.avg, r.max]))}
    <h3>水位（数値）別</h3>
    ${table(['河川・観測所', '水位', '回数', '平均', '最大'], s.byLevel.map((r) => [esc(r.river + (r.station ? `・${r.station}` : '')), r.range, r.trips, r.avg, r.max]))}

    <button type="button" class="btn line wide" id="season-image">🖼 まとめ画像をLINEで送る</button>
    <button type="button" class="btn primary wide" id="export">📊 ${year}シーズンをExcelで出力</button>
  ` : `<div class="empty"><p>${year}年の釣行はまだありません。</p></div>`;

  $('#season-select').addEventListener('change', (e) => { location.hash = `#/season/${e.target.value}`; });
  $('#season-image', root)?.addEventListener('click', async () => {
    toast('画像を作成中…');
    const blob = await renderSeasonImage(year, s, riverColor);
    const r = await shareBlob(blob, `アジ日記_${year}シーズンまとめ.png`, `【アジ日記】${year}シーズン ${s.tripCount}回 ${s.totalCount}匹${s.maxSize ? ` 最大${s.maxSize}cm` : ''}`);
    if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
  });
  $('#export', root)?.addEventListener('click', () => {
    const bytes = seasonXlsx(trips, year);
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `アジ日記_${year}シーズン.xlsx`);
    toast('Excelファイルを保存しました');
  });
}

// ---------- 設定 ----------
function viewSettings() {
  setActiveTab('settings');
  const root = mount(`<div class="top-title"><div>設定</div></div>`);

  const render = () => {
    root.innerHTML = `
      <h3>河川と水位ページ</h3>
      <p class="muted">ここにある河川は入力画面でワンタップ選択できます。観測所は河川を選んだときに自動で入り、色はカードや画面の色になります。位置（緯度・経度）は天気の自動入力に使います。最初はおおよその値なので、よく行くポイントで「今いる場所を位置に」を押すと正確になります。</p>
      <div class="river-list">
        ${state.rivers.map((r, i) => `
          <div class="river-item" data-i="${i}" style="--river:${esc(r.color || THEME_COLOR)}">
            <div class="row2">
              ${field('河川名', `<input data-rf="name" value="${esc(r.name)}">`)}
              ${field('観測所', `<input data-rf="station" value="${esc(r.station)}" placeholder="未設定">`)}
            </div>
            ${field('水位ページURL', `<input data-rf="url" type="url" value="${esc(r.url)}" placeholder="https://...">`)}
            <div class="row2">
              ${field('天気用の位置：緯度', `<input data-rf="lat" type="number" step="0.01" inputmode="decimal" value="${esc(r.lat ?? '')}">`)}
              ${field('経度', `<input data-rf="lon" type="number" step="0.01" inputmode="decimal" value="${esc(r.lon ?? '')}">`)}
            </div>
            <div class="tools">
              <label class="color-pick"><input data-rf="color" type="color" value="${esc(r.color || THEME_COLOR)}">色</label>
              <button type="button" class="btn small" data-act="here">📍 今いる場所を位置に</button>
              ${r.url ? `<a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">開いて確認</a>` : ''}
              <button type="button" class="btn small danger" data-act="del-river">この河川を外す</button>
            </div>
          </div>`).join('')}
      </div>
      <button type="button" class="btn small" data-act="add-river">＋ 河川を追加</button>

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

      <h3>このアプリについて</h3>
      <p class="muted">アジ日記 v${APP_VERSION}<br>Androidでは Chrome のメニューから「ホーム画面に追加」（または「アプリをインストール」）すると、アプリとして使えます。電波のない河原でも動きます（音声入力と天気の自動入力だけは電波が必要です）。天気は Open-Meteo の予報データを使っています。</p>
    `;
  };

  const saveRivers = async () => { await db.setKV('rivers', state.rivers); };

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-rf]');
    if (!el) return;
    const item = el.closest('.river-item');
    const i = Number(item.dataset.i);
    const rf = el.dataset.rf;
    state.rivers[i][rf] = rf === 'lat' || rf === 'lon' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
    if (el.dataset.rf === 'color') item.style.setProperty('--river', el.value);
    saveRivers();
  });
  root.addEventListener('change', (e) => { if (e.target.closest('[data-rf="url"]')) render(); });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (act === 'here') {
      const i = Number(btn.closest('.river-item').dataset.i);
      navigator.geolocation.getCurrentPosition((pos) => {
        state.rivers[i].lat = Math.round(pos.coords.latitude * 1000) / 1000;
        state.rivers[i].lon = Math.round(pos.coords.longitude * 1000) / 1000;
        saveRivers(); render();
        toast('今いる場所を登録しました');
      }, () => toast('位置を取得できませんでした（位置情報の許可を確認してください）'), { timeout: 10000 });
    } else if (act === 'add-river') {
      state.rivers.push({ name: '', station: '', url: '', color: THEME_COLOR, lat: null, lon: null });
      await saveRivers(); render();
      $$('.river-item input[data-rf="name"]', root).pop()?.focus();
    } else if (act === 'del-river') {
      const i = Number(btn.closest('.river-item').dataset.i);
      if (!confirm(`「${state.rivers[i].name || '（無名）'}」をボタンから外しますか？（過去の記録は消えません）`)) return;
      state.rivers.splice(i, 1);
      await saveRivers(); render();
    } else if (act === 'del-preset') {
      const p = state.presets.find((x) => x.id === btn.dataset.id);
      if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
      await db.del('presets', p.id);
      state.presets = state.presets.filter((x) => x.id !== p.id);
      render();
    } else if (act === 'backup') {
      const data = { app: 'aji-nikki', version: 1, exportedAt: new Date().toISOString(), trips: state.trips, presets: state.presets, rivers: state.rivers };
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `アジ日記_バックアップ_${todayISO()}.json`);
      toast('バックアップを保存しました');
    }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'restore') return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'aji-nikki' || !Array.isArray(data.trips)) throw new Error('format');
      if (!confirm(`${data.trips.length}件の釣行を読み込みます。同じ記録は上書きされます。よろしいですか？`)) return;
      const trips = data.trips.map(normalizeTrip);
      await db.putMany('trips', trips);
      if (Array.isArray(data.presets)) await db.putMany('presets', data.presets);
      if (Array.isArray(data.rivers) && data.rivers.length) { state.rivers = data.rivers; await saveRivers(); }
      await load();
      toast(`${trips.length}件を読み込みました`);
      render();
    } catch {
      toast('バックアップファイルを読み込めませんでした');
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
  const rivers = await db.getKV('rivers', clone(DEFAULT_RIVER_SETTINGS));
  // 以前に保存した設定には色がないので補う
  state.rivers = rivers.map((r) => ({ ...defaultRiverPos(r.name), ...r, color: r.color || defaultRiverColor(r.name) }));
}

async function start() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>データを読み込めませんでした。</p><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
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
