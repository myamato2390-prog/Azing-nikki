import * as db from './db.js';
import {
  APP_ID, KIND, KINDS, KIND_COLOR, kindName, DEFAULT_PLACES, THEME_COLOR, SIDES, SIDE_COLOR, sideName, defaultPlace,
  WEATHER, WIND_DIRS, LIGHTS, SHIOMAWARI, SIZE_FEEL, JIAI, TIDE_STAGES, JIG_WEIGHTS, RANGES, ACTIONS, BYCATCH, LINE_TYPES, TACKLE_FIELDS,
  TACHI_TACKLE_FIELDS, RIGS, TENYA_WEIGHTS, BAITS, HYBRID, TACHI_ACTIONS, F_SIZES, SHARED_KEYS,
  newTrip, normalizeTrip, sortTrips, formatDate, formatWeather, formatDayTemps, formatWind, formatHighs, formatLows,
  formatMoves, formatTimeRange, endsNextDay, isNextDayTime, formatClock, normalizeTime, tackleSummary, block, sizesTotal, maxF,
  starKey, starItem, starLabel, starState, cycleStar, starredFirst, starText,
  has, num, uid, todayISO, seasonOf,
} from './model.js';
import { emptyQuery, isEmptyQuery, filterTrips, describeQuery } from './search.js';
import { summarize, seasons, tripMax, sizeScore } from './stats.js';
import { seasonXlsx } from './export.js';
import { shareTrip, downloadBlob, renderSeasonImage, shareBlob } from './share.js';
import { placeStats, similarTrips, personalBests, recordBadges, newRecords } from './insights.js';
import { fetchWeather } from './weather.js';
import { shiomawari, tideForTrip } from './tide.js';

const APP_VERSION = '0.3.2';

const state = {
  trips: [],
  presets: [],
  places: DEFAULT_PLACES,
  lastKinds: ['aji'], // 新しい釣行の「今日の釣り物」の初期値（前回えらんだもの）
  seasonKind: 'aji',
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

// 下に出るお知らせ。action を渡すとボタン（「元に戻す」など）付きで長めに出す
function toast(msg, action) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('with-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.fn(); };
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), action ? 8000 : 2600);
}

// 記録を消す。「両方」の日の片方を消したら、残った方の「両方」の印を外す。
// 消した直後は「元に戻す」で戻せる（after は戻したあとに画面を描き直す処理）
async function deleteTrips(ids, after) {
  const gone = state.trips.filter((t) => ids.includes(t.id));
  const pids = new Set(gone.map((t) => t.pairId).filter(Boolean));
  const partners = state.trips.filter((t) => !ids.includes(t.id) && t.pairId && pids.has(t.pairId)).map(clone);
  for (const t of gone) await db.del('trips', t.id);
  state.trips = state.trips.filter((t) => !ids.includes(t.id));
  for (const p of partners) {
    const t = state.trips.find((x) => x.id === p.id);
    t.pairId = '';
    await db.put('trips', t);
  }
  if (ids.includes(state.currentId)) state.currentId = null;
  toast(`${gone.length > 1 ? `${gone.length}件の記録を` : ''}削除しました`, {
    label: '元に戻す',
    fn: async () => {
      await db.putMany('trips', [...gone, ...partners]);
      for (const t of [...gone, ...partners]) {
        const i = state.trips.findIndex((x) => x.id === t.id);
        if (i >= 0) state.trips[i] = t; else state.trips.push(t);
      }
      toast('元に戻しました');
      after?.();
    },
  });
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
  const a = t.sea, b = block(t), tachi = t.kind === 'tachiuo';
  const color = placeColor(t.river);
  const moves = formatMoves(t);
  const photo = t.photos?.[0]?.data;
  const time = formatTimeRange(t);
  const weather = formatWeather(t);
  const wind = formatWind(t);
  const ps = placeStats(state.trips, t.river, t.kind);
  const badges = recordBadges(state.trips, t);
  const highs = formatHighs(t), lows = formatLows(t);
  const tackle = tackleSummary(b.tackle);
  const stars = (type) => starredFirst(b[type], type).map((x) => `<span class="pill${x.star ? ' star' : ''}">${x.star ? '★' : ''}${esc(x.label)}</span>`).join('');
  const mx = tachi ? maxF(b.sizes) : has(t.maxSize) ? esc(t.maxSize) : '';
  const lure = tachi
    ? b.rigs.length || b.tenya.length || b.baits.length || b.ranges.length || b.actions.length
    : b.jigheads.length || b.worms.length || b.ranges.length || b.actions.length;
  const sizes = tachi ? F_SIZES.filter((f) => Number(b.sizes[f]) > 0) : [];

  return `<article class="card" data-id="${t.id}" style="--river:${esc(color)};--kind:${KIND_COLOR[t.kind]}">
    <header class="card-head${photo ? ' has-photo' : ''}" ${photo ? `data-bg="${photo}"` : ''}>
      <div class="card-date">${formatDate(t.date)}${time ? `<span>${esc(time)}</span>` : ''}<span class="kind-tag">${esc(kindName(t.kind))}</span>${t.pairId ? '<span class="pair-tag" title="同じ日にアジとタチウオの両方">両方</span>' : ''}</div>
      <div class="card-place"><i class="place-dot"></i><b>${esc(t.river || '港未入力')}</b>${a.side ? `<small>${esc(sideName(a.side))}</small>` : ''}</div>
      ${moves.map((m) => `<div class="card-move">→ ${esc(m)}</div>`).join('')}
      ${t.title ? `<div class="card-title">「${esc(t.title)}」</div>` : ''}
      ${badges.length ? `<div class="card-badges">${badges.map((x) => `<span>🏆 ${x}</span>`).join('')}</div>` : ''}
    </header>
    ${!has(t.count) ? `<a class="after-banner" href="#/edit/${t.id}?tab=after">釣行後の記録がまだです　入力する ›</a>` : ''}
    <section class="catch">
      <div class="catch-count"><b>${has(t.count) ? esc(t.count) : '-'}</b>匹</div>
      <div class="catch-stat"><span>最大</span><b>${mx || '-'}</b>${tachi ? '' : 'cm'}</div>
      <div class="catch-stat"><span>バラシ</span><b>${has(t.bare) ? esc(t.bare) : '-'}</b></div>
      ${!tachi && t.sizeFeel ? `<div class="catch-feel">${esc(t.sizeFeel)}</div>` : ''}
    </section>
    ${sizes.length ? `<div class="size-row">${sizes.map((f) => `<span><b>${f}</b>×${b.sizes[f]}</span>`).join('')}</div>` : ''}
    ${ps && ps.trips >= 2 ? `<div class="point-stats">📍 この港の${esc(kindName(t.kind))} 全${ps.trips}回・平均${ps.avg}匹・最多${ps.best}匹${ps.max ? `・最大${ps.max}${tachi ? '' : 'cm'}` : ''}</div>` : ''}
    ${(t.jiai.length || b.tideStages.length || lure || b.bycatch?.length || (tachi && b.firstHit)) ? `<section class="pills">
      ${tachi && b.firstHit ? `<div><em>初アタリ</em><span class="pill plain">${esc(formatClock(t, b.firstHit))}</span></div>` : ''}
      ${t.jiai.length || b.tideStages.length ? `<div><em>時合</em>${tags(t.jiai)}${tags(b.tideStages, 'plain')}</div>` : ''}
      ${tachi ? `
        ${b.rigs.length || b.tenya.length ? `<div><em>仕掛け</em>${stars('rigs')}${stars('tenya')}</div>` : ''}
        ${b.baits.length ? `<div><em>餌</em>${stars('baits')}</div>` : ''}` : `
        ${b.jigheads.length ? `<div><em>ジグヘッド</em>${stars('jigheads')}</div>` : ''}
        ${b.worms.length ? `<div><em>ワーム</em>${stars('worms')}</div>` : ''}`}
      ${b.ranges.length || b.actions.length ? `<div><em>誘い</em>${stars('ranges')}${stars('actions')}</div>` : ''}
      ${b.bycatch?.length ? `<div><em>外道</em>${tags(b.bycatch, 'plain')}</div>` : ''}
    </section>` : ''}
    <section class="grid">
      ${cell('潮回り', esc(a.tide.shiomawari))}
      ${cell('常夜灯', esc(a.light))}
      ${cell('天気', esc(weather), 'w2')}
      ${cell(a.tide.auto ? '満潮（めやす）' : '満潮', esc(highs), 'w2')}
      ${cell(a.tide.auto ? '干潮（めやす）' : '干潮', esc(lows), 'w2')}
      ${cell('風', esc(wind), 'w2')}
      ${cell('朝／最高', esc(formatDayTemps(t).replace('朝', '').replace('最高', '')), 'w2')}
      ${cell('水温', has(t.waterTemp) ? `${esc(t.waterTemp)}℃` : '')}
      ${cell('タックル', esc(tackle), 'wide')}
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
  // 「両方」の日は1つにまとめて出す
  const seen = new Set();
  const pending = sortTrips(state.trips.filter((t) => !has(t.count))).reverse()
    .filter((t) => { const k = t.pairId || t.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  if (fresh || !pending.length) return viewEdit(null, 'before');
  setActiveTab('new');
  const root = mount(`<div class="top-title"><div>記録</div></div>`);
  const kindsOf = (t) => (t.pairId ? state.trips.filter((x) => x.pairId === t.pairId).map((x) => x.kind) : [t.kind]);
  root.innerHTML = `
    <p class="lead">釣行後の記録がまだの釣行があります。</p>
    ${pending.map((t) => `
      <a class="choice" href="#/edit/${t.id}?tab=after" style="--river:${esc(placeColor(t.river))}">
        <span class="choice-date">${formatDate(t.date)} ${esc(t.startTime)}　${esc(KINDS.filter((k) => kindsOf(t).includes(k)).map(kindName).join('・'))}</span>
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

function latestOtherTrip(ids, kind) {
  return sortTrips(state.trips.filter((t) => !ids.includes(t.id) && t.kind === kind && Object.values(block(t).tackle || {}).some(Boolean))).pop();
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
// 自動入力する天気・風の項目（手で直したら「自動のまま」ではなくなる）
const WEATHER_PATHS = ['s.weather', 's.tempMorning', 's.tempMax', 's.sea.tempStart', 's.sea.windDir', 's.sea.windSpeed', 's.sea.windMax'];
const KIND_CHOICES = [['aji', 'アジ'], ['tachiuo', 'タチウオ'], ['both', '両方']];
// 釣行後の入力があるか（消すときの確認用）
const hasAfter = (t) => has(t.count) || !!t.title || !!t.memo || t.photos.length > 0 ||
  Object.entries(block(t)).some(([k, v]) => k !== 'tackle' && (Array.isArray(v) ? v.length : k === 'sizes' ? sizesTotal(v) > 0 : false));

// 入力・編集。「両方」の日は、アジとタチウオの2つの記録を1つの画面で入力する。
// 入力欄の data-path は form から：s.＝共通の項目（最初の記録）、aji.／tachiuo.＝その釣り物の記録
function viewEdit(id, tab = 'before') {
  setActiveTab(id ? '' : 'new');
  const existing = id && state.trips.find((t) => t.id === id);
  if (id && !existing) { location.hash = '#/'; return; }

  const recs = {};
  const saved = new Set(); // 端末に保存済みの記録の id
  if (existing) {
    const group = existing.pairId ? state.trips.filter((t) => t.pairId === existing.pairId) : [existing];
    for (const t of group) { recs[t.kind] = clone(t); saved.add(t.id); }
  } else {
    for (const k of state.lastKinds) recs[k] = newTrip(todayISO(), k);
    if (recs.aji && recs.tachiuo) { const pid = uid(); recs.aji.pairId = pid; recs.tachiuo.pairId = pid; }
  }
  const kinds = () => KINDS.filter((k) => recs[k]);
  const list = () => kinds().map((k) => recs[k]);
  const form = {};
  const relink = () => { form.s = recs[kinds()[0]]; for (const k of KINDS) form[k] = recs[k]; };
  relink();
  const S = () => form.s; // 共通の項目を持つ記録

  let isNew = !existing;
  let dirty = false;
  let timer;
  // 潮回りは日付から自動で入れる（手で変えた値は上書きしない）
  let autoShio = shiomawari(S().date);
  if (isNew) S().sea.tide.shiomawari = autoShio;
  // 自己ベスト更新の判定用：編集前のベストと、この釣行の元の値（釣り物ごと）
  const bestsBefore = {}, original = {};
  for (const k of KINDS) {
    bestsBefore[k] = personalBests(state.trips, recs[k]?.id, k);
    original[k] = recs[k] ? { size: sizeScore(recs[k]), count: recs[k].count } : null;
  }
  const celebrateIfRecord = () => {
    const out = [];
    for (const k of kinds()) {
      const t = recs[k], o = original[k] || { size: 0, count: null };
      const changed = sizeScore(t) !== o.size || t.count !== o.count;
      if (changed) out.push(...newRecords(bestsBefore[k], t).map((r) => ({ ...r, kind: `${kindName(k)}の${r.kind}` })));
      original[k] = { size: sizeScore(t), count: t.count };
    }
    if (out.length) celebrate(out);
  };

  const root = mount(`
    <a class="icon-btn" href="#/" aria-label="戻る">‹</a>
    <div class="top-title"><div>${isNew ? '新しい釣行' : '釣行の編集'}</div><div class="pos" id="save-status">${isNew ? '入力すると自動で保存されます' : '保存済み'}</div></div>
    <button class="btn small primary" id="done">完了</button>`);
  setTheme(placeColor(S().river));

  const setStatus = (s) => { const el = $('#save-status'); if (el) el.textContent = s; };

  // 共通の項目を、ほかの記録にも同じ値で入れる
  const syncShared = () => {
    for (const t of list()) if (t !== S()) for (const k of SHARED_KEYS) t[k] = clone(S()[k]);
  };

  async function save() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    syncShared();
    const now = new Date().toISOString();
    const out = list().map((t) => ({ ...clone(t), updatedAt: now }));
    try {
      await db.putMany('trips', out);
    } catch {
      dirty = true;
      setStatus('⚠ 保存できませんでした');
      toast('保存できませんでした。スマホの空き容量を確認してください');
      return;
    }
    for (const t of out) {
      recs[t.kind].updatedAt = now;
      saved.add(t.id);
      const i = state.trips.findIndex((x) => x.id === t.id);
      if (i >= 0) state.trips[i] = t; else state.trips.push(t);
    }
    state.currentId = S().id;
    history.replaceState(null, '', `#/edit/${S().id}?tab=${tab}`);
    if (isNew) { isNew = false; db.requestPersist(); }
    setStatus(`✓ 保存済み ${nowHM()}`);
  }
  const touch = () => {
    dirty = true;
    setStatus('保存中…');
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  state.onLeave = async () => { await save(); celebrateIfRecord(); };

  // ---------- 画面の組み立て ----------
  const sideChips = (side) => state.places.filter((p) => p.side === side && p.name).map((p) => p.name);
  const tackleValues = (k, key) => [...state.trips.filter((t) => t.kind === k).map((t) => block(t).tackle?.[key]),
    ...state.presets.filter((p) => (p.kind || 'aji') === k).map((p) => p.tackle?.[key])];
  const tideSlots = (key) => [0, 1].map((i) => ({ time: '', cm: null, ...(S().sea.tide[key][i] || {}) }));
  const slots = {};
  const tideRow = (key, label) => `<div class="tide-row"><span class="tide-lbl">${label}</span>${slots[key].map((x, i) => `
      <input data-tide="${key}" data-i="${i}" data-tf="time" data-time inputmode="numeric" maxlength="5" placeholder="時刻" value="${esc(x.time)}">
      <span class="with-unit"><input data-tide="${key}" data-i="${i}" data-tf="cm" type="number" inputmode="numeric" placeholder="潮位" value="${esc(x.cm ?? '')}"><span>cm</span></span>`).join('')}</div>`;
  const kindHead = (k, text) => `<h3 class="kind-h" style="--kind:${KIND_COLOR[k]}">${text}</h3>`;
  const both = () => kinds().length > 1;
  const kindChoice = () => (both() ? 'both' : kinds()[0]);

  const tackleHtml = (k) => {
    const P = `${k}.${k}.tackle`;
    const presets = state.presets.filter((p) => (p.kind || 'aji') === k);
    const tools = `<div class="tools">
        <button type="button" class="btn small" data-act="copy-last" data-kind="${k}">前回の仕掛け</button>
        <select class="btn small preset-select" data-kind="${k}">
          <option value="">プリセットから…</option>
          ${presets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn small" data-act="save-preset" data-kind="${k}">プリセットに保存</button>
      </div>`;
    const dl = (key) => `list="dl-${k}-${key}"`;
    if (k === 'tachiuo') {
      return `${kindHead(k, both() ? 'タチウオのタックル' : 'タックル')}${tools}
        <div class="row2">
          ${field('ロッド', input(form, `${P}.rod`, `${dl('rod')} placeholder="例: 8.6ft ML"`))}
          ${field('リール', input(form, `${P}.reel`, `${dl('reel')} placeholder="例: 3000番"`))}
        </div>
        <div class="row2">
          ${field('PE（号数）', input(form, `${P}.pe`, `${dl('pe')} placeholder="例: 0.8号"`))}
          ${field('リーダー（種類と号数）', input(form, `${P}.leader`, `${dl('leader')} placeholder="例: フロロ 5号"`))}
        </div>
        ${TACHI_TACKLE_FIELDS.map(([key]) => datalist(`dl-${k}-${key}`, tackleValues(k, key))).join('')}`;
    }
    return `${kindHead(k, both() ? 'アジのタックル' : 'タックル')}${tools}
      <div class="row2">
        ${field('ロッド', input(form, `${P}.rod`, `${dl('rod')} placeholder="例: 6.4ft UL"`))}
        ${field('リール', input(form, `${P}.reel`, `${dl('reel')} placeholder="例: 2000番"`))}
      </div>
      ${group('ライン', chips(form, `${P}.lineType`, LINE_TYPES))}
      <div class="row2">
        ${field('ラインの号数', input(form, `${P}.lineSize`, `${dl('lineSize')} placeholder="例: 0.3号"`))}
        ${field('リーダー', input(form, `${P}.leader`, `${dl('leader')} placeholder="例: フロロ 0.8号"`))}
      </div>
      ${TACKLE_FIELDS.map(([key]) => datalist(`dl-${k}-${key}`, tackleValues(k, key))).join('')}`;
  };

  const afterHtml = (k) => {
    const R = `${k}`, B = `${k}.${k}`;
    const common = `
      ${field('ひとこと（この日を一言で）', input(form, `${R}.title`, `maxlength="40" placeholder="${k === 'tachiuo' ? '例: 下げで指5本' : '例: 下げ始めに表層で連発'}"`))}`;
    const tail = `
      ${group('時合（複数可）', chips(form, `${R}.jiai`, JIAI, true))}
      ${group('釣れたときの潮（複数可）', chips(form, `${B}.tideStages`, TIDE_STAGES, true))}`;
    const memo = `
      ${group('メモ', `<textarea data-path="${R}.memo" rows="4" placeholder="釣れた場所、アタリの出方、次回への反省など">${esc(recs[k].memo)}</textarea>
        ${SpeechRec ? `<button type="button" class="btn small mic" data-act="voice" data-kind="${k}">🎤 音声で入力</button>` : ''}`)}
      ${group('写真', `<div class="photo-edit" id="photo-edit-${k}"></div>
        <label class="btn small"><input type="file" accept="image/*" multiple hidden class="photo-input" data-kind="${k}">写真を追加</label>`)}`;
    if (k === 'tachiuo') {
      return `<div class="kind-pane" style="--kind:${KIND_COLOR[k]}">${kindHead(k, 'タチウオの釣果')}
        ${common}
        ${field('最初にアタリがあった時刻', timeInput(form, `${B}.firstHit`, '例: 1945'))}
        <div id="first-hit-note" class="hint"></div>
        ${group('サイズごとの匹数', `<div class="sizes">${F_SIZES.map((f) => `<div class="size-step"><span class="size-lbl">${f}</span>${stepper(form, `${B}.sizes.${f}`, '匹')}</div>`).join('')}</div>
          <div class="size-total" id="size-total"></div>`)}
        ${group('バラシ', stepper(form, `${R}.bare`, '回'))}
        ${tail}
        <h3>仕掛け・餌</h3>
        <p class="star-help">1回押す＝使った　2回押す＝<b>★ 良かった</b>　3回押す＝取り消し</p>
        ${group('仕掛け', starChips(form, `${B}.rigs`, 'rigs', RIGS))}
        <div id="tenya-box"></div>
        ${group('餌', `<div id="st-baits"></div>
          <div class="add-row"><span class="add-lbl">${HYBRID}</span><input id="add-hybrid" placeholder="硬さ（例: F-15）"><button type="button" class="btn small" data-act="add-hybrid">追加</button></div>`)}
        ${group('レンジ', starChips(form, `${B}.ranges`, 'ranges', RANGES))}
        ${group('誘い方', starChips(form, `${B}.actions`, 'actions', TACHI_ACTIONS))}
        ${memo}
      </div>`;
    }
    return `<div class="kind-pane" style="--kind:${KIND_COLOR[k]}">${kindHead(k, 'アジの釣果')}
      ${common}
      ${group('匹数', stepper(form, `${R}.count`, '匹'), 'big')}
      ${field('最大サイズ', `<div class="with-unit">${numInput(form, `${R}.maxSize`, 'step="0.1" min="0"')}<span>cm</span></div>`)}
      ${group('バラシ', stepper(form, `${R}.bare`, '回'))}
      ${group('サイズ感', chips(form, `${R}.sizeFeel`, SIZE_FEEL))}
      ${tail}
      <h3>ジグヘッド・ワーム</h3>
      <p class="star-help">1回押す＝使った　2回押す＝<b>★ 良かった</b>　3回押す＝取り消し</p>
      ${group('ジグヘッドの重さ', `<div id="st-jigheads"></div>
        <div class="add-row"><span class="with-unit"><input id="add-jig" type="number" inputmode="decimal" step="0.1" min="0" placeholder="その他の重さ"><span>g</span></span><button type="button" class="btn small" data-act="add-jig">追加</button></div>`)}
      ${group('ワーム', `<div id="st-worms"></div>
        <div class="add-row"><input id="add-worm-name" list="dl-worm-name" placeholder="名前（例: 〇〇 2インチ）"><input id="add-worm-color" list="dl-worm-color" placeholder="カラー"><button type="button" class="btn small" data-act="add-worm">追加</button></div>`)}
      ${group('レンジ', starChips(form, `${B}.ranges`, 'ranges', RANGES))}
      ${group('誘い方', starChips(form, `${B}.actions`, 'actions', ACTIONS))}
      <h3>外道</h3>
      <div id="bycatch"></div>
      <div class="add-row"><input id="add-bycatch" placeholder="その他の魚"><button type="button" class="btn small" data-act="add-bycatch">追加</button></div>
      ${memo}
      ${datalist('dl-worm-name', state.trips.filter((t) => t.kind === 'aji').flatMap((t) => t.aji.worms.map((w) => w.name)))}
      ${datalist('dl-worm-color', state.trips.filter((t) => t.kind === 'aji').flatMap((t) => t.aji.worms.map((w) => w.color)))}
    </div>`;
  };

  const render = () => {
    slots.highs = tideSlots('highs'); slots.lows = tideSlots('lows');
    root.innerHTML = `
    <div class="seg" role="tablist">
      <button type="button" data-tab="before" class="${tab === 'before' ? 'on' : ''}">釣行前</button>
      <button type="button" data-tab="after" class="${tab === 'after' ? 'on' : ''}">釣行後</button>
    </div>

    <form class="form" autocomplete="off" onsubmit="return false">
    <div class="kind-pick">
      <span class="lbl">今日の釣り物</span>
      <div class="kind-chips">${KIND_CHOICES.map(([v, label]) => `<button type="button" class="kind-chip k-${v}${kindChoice() === v ? ' on' : ''}" data-kind-set="${v}">${label}</button>`).join('')}</div>
    </div>

    <div class="pane" data-pane="before" ${tab === 'before' ? '' : 'hidden'}>
      <div class="row2">
        ${field('日付（始めた日）', input(form, 's.date', 'type="date" required'))}
        ${field('開始時刻', timeInput(form, 's.startTime', '例: 1830'))}
      </div>
      ${group('港', `
        ${Object.entries(SIDES).map(([side, label]) => `<div class="side-lbl" style="--river:${SIDE_COLOR[side]}">${label}</div>${chips(form, 's.river', sideChips(side))}`).join('')}
        ${input(form, 's.river', 'list="dl-river" placeholder="その他の港は入力"')}`)}
      <div id="side-pick" hidden>${group('この港はどちら側？', chips(form, 's.sea.side', Object.entries(SIDES)))}</div>
      <div id="place-stats" class="hint"></div>

      <h3>潮</h3>
      ${group('潮回り（日付から自動）', chips(form, 's.sea.tide.shiomawari', SHIOMAWARI))}
      ${group('満潮・干潮（時刻と潮位）', `${tideRow('highs', '満潮')}${tideRow('lows', '干潮')}
        <div class="tide-note"><span class="muted" id="tide-note"></span><button type="button" class="btn small" data-act="tide-auto" id="tide-auto" hidden>自動に戻す</button></div>`)}

      <h3>天気・風</h3>
      <div class="tools"><button type="button" class="btn small" data-act="weather">☀ 天気・風・気温を自動入力</button><span class="muted" id="weather-note"></span></div>
      ${group('天気', chips(form, 's.weather', WEATHER))}
      ${group('風向', chips(form, 's.sea.windDir', WIND_DIRS))}
      <div class="row3">
        ${field('風速', `<div class="with-unit">${numInput(form, 's.sea.windSpeed', 'step="0.1" min="0"')}<span>m/s</span></div>`)}
        ${field('最大風速', `<div class="with-unit">${numInput(form, 's.sea.windMax', 'step="0.1" min="0"')}<span>m/s</span></div>`)}
        ${field('釣り始めの気温', `<div class="with-unit">${numInput(form, 's.sea.tempStart', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      <div class="row3">
        ${field('朝の気温', `<div class="with-unit">${numInput(form, 's.tempMorning', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('最高気温', `<div class="with-unit">${numInput(form, 's.tempMax', 'step="0.1"')}<span>℃</span></div>`)}
        ${field('水温', `<div class="with-unit">${numInput(form, 's.waterTemp', 'step="0.1"')}<span>℃</span></div>`)}
      </div>
      ${group('常夜灯', chips(form, 's.sea.light', LIGHTS))}

      <h3>作戦ボード</h3>
      <div id="board" class="board"></div>

      ${kinds().map(tackleHtml).join('')}

      <button type="button" class="btn wide" data-tab="after">釣行後の入力へ ›</button>
      <p class="muted center">釣行前の内容は自動で保存されています。釣行後のタブに移っても消えません。</p>
    </div>

    <div class="pane" data-pane="after" ${tab === 'after' ? '' : 'hidden'}>
      ${field('終了時刻', timeInput(form, 's.endTime', '例: 0200'))}
      <div id="end-note" class="hint"></div>
      ${both() ? '<p class="muted">アジとタチウオは、別々のカード・別々の記録になります。</p>' : ''}
      ${kinds().map(afterHtml).join('')}

      <h3>移動した場所</h3>
      <p class="muted">途中で港を変えたときだけ追加します。</p>
      <div id="moves"></div>
      <button type="button" class="btn small" data-act="add-move">＋ 移動先を追加</button>

      <button type="button" class="btn wide danger" data-act="delete">この釣行を削除</button>
    </div>
    </form>
    ${datalist('dl-river', placeNames())}
  `;
    refreshPlace();
    fillTide();
    refreshEndNote();
    refreshBoard();
    renderLures();
    renderMoves();
    renderPhotos();
    refreshSizes();
    refreshFirstHit();
  };

  const refreshInputs = () => {
    $$('input[data-path], textarea[data-path]', root).forEach((el) => {
      const v = getPath(form, el.dataset.path);
      if (document.activeElement !== el) el.value = v ?? '';
    });
    $$('.chips', root).forEach((box) => {
      if (box.dataset.mode === 'star') return;
      const v = getPath(form, box.dataset.path);
      $$('.chip', box).forEach((c) => c.classList.toggle('on', box.dataset.mode === 'multi' ? (v || []).includes(c.dataset.chip) : v === c.dataset.chip));
    });
  };

  // ジグヘッド・ワーム・外道・テンヤ・餌のボタン：いつもの選択肢＋過去に使ったもの＋この釣行のもの
  const renderLures = () => {
    const ids = list().map((t) => t.id);
    const others = (k) => state.trips.filter((t) => !ids.includes(t.id) && t.kind === k);
    if (recs.aji) {
      const a = recs.aji.aji;
      const jigs = uniq([...JIG_WEIGHTS, ...others('aji').flatMap((t) => t.aji.jigheads.map((j) => Number(j.g))), ...a.jigheads.map((j) => Number(j.g))].map(String))
        .sort((x, y) => Number(x) - Number(y));
      const worms = uniq([...a.worms, ...sortTrips(others('aji')).reverse().flatMap((t) => t.aji.worms)].map((w) => starKey('worms', w)));
      $('#st-jigheads', root).innerHTML = starChips(form, 'aji.aji.jigheads', 'jigheads', jigs);
      $('#st-worms', root).innerHTML = worms.length
        ? starChips(form, 'aji.aji.worms', 'worms', worms)
        : '<p class="muted">下の欄に名前とカラーを入れて「追加」を押すと、次からボタンで選べます。</p>';
      const fish = uniq([...BYCATCH, ...others('aji').flatMap((t) => t.aji.bycatch), ...a.bycatch]);
      $('#bycatch', root).innerHTML = chips(form, 'aji.aji.bycatch', fish, true);
    }
    if (recs.tachiuo) {
      const b = recs.tachiuo.tachiuo;
      // テンヤの重さは、テンヤを選んだときだけ出す
      const tenyaOn = starState(b.rigs, 'rigs', 'テンヤ') > 0;
      const ws = uniq([...TENYA_WEIGHTS, ...others('tachiuo').flatMap((t) => t.tachiuo.tenya.map((j) => Number(j.g))), ...b.tenya.map((j) => Number(j.g))].map(String))
        .sort((x, y) => Number(x) - Number(y));
      $('#tenya-box', root).innerHTML = tenyaOn ? group('テンヤの重さ', starChips(form, 'tachiuo.tachiuo.tenya', 'tenya', ws)) : '';
      const baits = uniq([...BAITS, ...b.baits.map((x) => x.name), ...sortTrips(others('tachiuo')).reverse().flatMap((t) => t.tachiuo.baits.map((x) => x.name))]);
      $('#st-baits', root).innerHTML = starChips(form, 'tachiuo.tachiuo.baits', 'baits', baits);
    }
  };

  const refreshFirstHit = () => {
    const el = $('#first-hit-note', root);
    if (!el || !recs.tachiuo) return;
    const t = recs.tachiuo.tachiuo.firstHit;
    el.textContent = t && isNextDayTime(S(), t) ? `翌日の ${t} として記録します` : '';
  };
  const refreshSizes = () => {
    const el = $('#size-total', root);
    if (!el || !recs.tachiuo) return;
    const sz = recs.tachiuo.tachiuo.sizes;
    el.textContent = has(recs.tachiuo.count) ? `合計 ${sizesTotal(sz)}匹${maxF(sz) ? `　最大 ${maxF(sz)}` : ''}` : '＋を押して、サイズごとに数えます';
  };

  const refreshPlace = () => {
    const ps = placeSetting(S().river);
    $('#side-pick', root).hidden = !S().river || !!ps;
    setTheme(placeColor(S().river));
    const lines = kinds().map((k) => {
      const st = placeStats(state.trips.filter((t) => t.id !== recs[k].id), S().river, k);
      return st ? `📍 この港の${kindName(k)} ${st.trips}回：平均${st.avg}匹・最多${st.best}匹${st.max ? `・最大${st.max}${k === 'tachiuo' ? '' : 'cm'}` : ''}` : '';
    }).filter(Boolean);
    $('#place-stats', root).innerHTML = lines.map(esc).join('<br>');
  };

  const refreshEndNote = () => {
    $('#end-note', root).textContent = endsNextDay(S()) ? `翌日の ${S().endTime} として記録します` : '';
  };

  // 作戦ボード：釣り物ごとに、同じ港・同じ側で条件の近い過去の釣行
  const lureText = (t) => {
    const b = block(t);
    const types = t.kind === 'tachiuo' ? ['rigs', 'tenya', 'baits', 'ranges', 'actions'] : ['jigheads', 'worms', 'ranges', 'actions'];
    return types.map((k) => starText((b[k] || []).filter((x) => x.star), k)).filter(Boolean).join('　');
  };
  const refreshBoard = () => {
    if (!S().river) { $('#board', root).innerHTML = '<p class="muted">港を選ぶと、似た条件の過去の釣行が出ます。</p>'; return; }
    $('#board', root).innerHTML = kinds().map((k) => {
      const cond = { ...recs[k], ...Object.fromEntries(SHARED_KEYS.map((x) => [x, S()[x]])) };
      const found = similarTrips(state.trips, cond, recs[k].id, 3);
      const head = both() ? `<div class="board-kind" style="--kind:${KIND_COLOR[k]}">${kindName(k)}</div>` : '';
      if (!found.length) return `${head}<p class="muted">${esc(S().river)}${S().sea.side ? `や${esc(sideName(S().sea.side))}` : ''}の${kindName(k)}の過去の記録がまだありません。記録がたまるほど役に立ちます。</p>`;
      return `${head}${found.map(({ trip: t, why }) => `
          <div class="board-item" style="--river:${esc(placeColor(t.river))}">
            <div class="board-head"><b>${formatDate(t.date)}</b> ${esc(t.river)}<span class="board-count">${esc(t.count)}匹${tripMax(t) ? `・${esc(tripMax(t))}${t.kind === 'tachiuo' ? '' : 'cm'}` : ''}</span></div>
            ${t.title ? `<div class="board-title">「${esc(t.title)}」</div>` : ''}
            <div class="board-meta">${esc([formatTimeRange(t), t.sea.tide.shiomawari, t.sea.light ? `常夜灯${t.sea.light}` : '', formatWind(t)].filter(Boolean).join('・'))}</div>
            ${t.jiai.length || block(t).tideStages.length ? `<div class="board-meta">${esc([...t.jiai, ...block(t).tideStages].join('・'))}</div>` : ''}
            ${lureText(t) ? `<div class="board-tackle">${esc(lureText(t))}</div>` : ''}
            ${tackleSummary(block(t).tackle) ? `<div class="board-meta">${esc(tackleSummary(block(t).tackle))}</div>` : ''}
            <div class="board-foot">
              <span class="board-why">${why.map((w) => `<span>${esc(w)}</span>`).join('')}</span>
              ${lureText(t) || tackleSummary(block(t).tackle) ? `<button type="button" class="btn small" data-act="use-trip" data-id="${t.id}">これを使う</button>` : ''}
            </div>
          </div>`).join('')}`;
    }).join('') + '<p class="muted">港・潮回り・常夜灯・風・時間帯などが近い順です。</p>';
  };

  // 天気・風の自動入力。silent=true は港や時刻を入れたときの自動実行
  const fillWeather = async (silent) => {
    const ps = placeSetting(S().river);
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
      const t = S(), sea = t.sea;
      const w = await fetchWeather(lat, lon, t.date || todayISO(), t.startTime, t.endTime);
      if (w.weather) t.weather = w.weather;
      if (w.tempMorning !== null) t.tempMorning = w.tempMorning;
      if (w.tempMax !== null) t.tempMax = w.tempMax;
      if (w.tempStart !== null) sea.tempStart = w.tempStart;
      if (w.windDir) sea.windDir = w.windDir;
      if (w.windSpeed !== null) sea.windSpeed = w.windSpeed;
      if (w.windMax !== null) sea.windMax = w.windMax;
      sea.weatherAuto = true;
      refreshInputs(); touch(); refreshBoard();
      $('#weather-note', root).textContent = `${t.river || '現在地'}付近の${t.startTime ? '釣りの時間帯' : '18〜24時'}の予報を入れました`;
    } catch {
      $('#weather-note', root).textContent = '';
      if (!silent) toast(navigator.onLine ? '天気を取得できませんでした（16日より先の日付は取得できません）' : '電波がないため天気を取得できません');
    }
  };
  const weatherEmpty = () => !S().weather && !has(S().tempMax) && !has(S().sea.windSpeed) && !S().sea.windDir;

  const renderMoves = () => {
    $('#moves', root).innerHTML = S().moves.map((m, i) => `
      <div class="move-row" data-mi="${i}">
        <input data-mf="time" data-time inputmode="numeric" maxlength="5" placeholder="時刻" value="${esc(m.time)}">
        <input data-mf="river" list="dl-river" placeholder="港" value="${esc(m.river)}">
        <button type="button" data-act="del-move" aria-label="この移動先を削除">×</button>
      </div>`).join('');
  };

  const renderPhotos = () => {
    for (const k of kinds()) {
      $(`#photo-edit-${k}`, root).innerHTML = recs[k].photos.map((p) => `
        <div class="thumb"><img src="${p.data}" alt=""><button type="button" data-act="del-photo" data-kind="${k}" data-id="${p.id}" aria-label="写真を削除">×</button></div>`).join('');
    }
  };

  // 満潮・干潮の自動計算（めやす）。手で直したら自動では変えない
  const tideNote = () => {
    const t = S(), ps = placeSetting(t.river);
    const off = Number(ps?.tideOffsetMin) || 0;
    $('#tide-note', root).textContent = !t.sea.side
      ? '港を選ぶと、満潮・干潮のめやすが自動で入ります。'
      : t.sea.tide.auto
        ? `めやす：${t.sea.tide.station || ''}（${sideName(t.sea.side)}の基準）の潮から計算${off ? `・補正${off > 0 ? '+' : ''}${off}分` : ''}${!t.startTime || t.startTime >= '12:00' ? '。午前の時刻は翌日です' : ''}`
        : '手で直した値です。';
    $('#tide-auto', root).hidden = t.sea.tide.auto || !t.sea.side;
  };
  const fillTide = () => {
    const t = S(), tide = t.sea.tide;
    if (tide.auto) {
      const ps = placeSetting(t.river);
      const r = tideForTrip(t.sea.side, t.date, t.startTime, ps?.tideOffsetMin || 0);
      if (r) {
        const before = JSON.stringify(tide);
        tide.highs = r.highs.slice(0, 2);
        tide.lows = r.lows.slice(0, 2);
        tide.station = r.station;
        for (const key of ['highs', 'lows']) {
          slots[key] = tideSlots(key);
          slots[key].forEach((x, i) => {
            $(`[data-tide="${key}"][data-i="${i}"][data-tf="time"]`, root).value = x.time || '';
            $(`[data-tide="${key}"][data-i="${i}"][data-tf="cm"]`, root).value = x.cm ?? '';
          });
        }
        if (JSON.stringify(tide) !== before) touch();
      }
    }
    tideNote();
  };

  // 満潮・干潮の入力欄 → 記録（空の欄は入れない。午前の時刻は翌日とみなす）
  const syncTide = () => {
    for (const key of ['highs', 'lows']) {
      S().sea.tide[key] = slots[key].filter((x) => x.time || has(x.cm))
        .map((x) => ({ time: x.time, cm: has(x.cm) ? Number(x.cm) : null, nextDay: isNextDayTime(S(), x.time) }));
    }
  };

  // ---------- 今日の釣り物を変える ----------
  const setKinds = async (choice) => {
    const want = choice === 'both' ? ['aji', 'tachiuo'] : [choice];
    if (want.join() === kinds().join()) return;
    syncShared();
    // 外す釣り物：入力済みなら確かめてから消す
    for (const k of kinds().filter((x) => !want.includes(x))) {
      const t = recs[k];
      if (saved.has(t.id) && hasAfter(t) && !confirm(`${kindName(k)}の記録（釣果・メモなど）を消しますか？`)) return;
    }
    for (const k of kinds().filter((x) => !want.includes(x))) {
      const t = recs[k];
      if (saved.has(t.id)) {
        await db.del('trips', t.id);
        state.trips = state.trips.filter((x) => x.id !== t.id);
        saved.delete(t.id);
      }
      delete recs[k];
    }
    const base = S() || null;
    for (const k of want) {
      if (recs[k]) continue;
      const t = newTrip(base?.date || todayISO(), k);
      if (base) for (const key of SHARED_KEYS) t[key] = clone(base[key]);
      recs[k] = t;
    }
    // 組の印：両方なら同じ pairId、1つなら外す
    const pid = want.length > 1 ? (base?.pairId || uid()) : '';
    for (const t of list()) t.pairId = pid;
    relink();
    state.lastKinds = want;
    db.setKV('lastKinds', want);
    render();
    refreshInputs();
    if (saved.size || dirty || S().river) touch();
  };

  bindControls(root, form, (path) => {
    const t = S();
    if (path === 's.river') {
      const ps = placeSetting(t.river);
      if (ps) t.sea.side = ps.side;
      refreshInputs();
      refreshPlace();
      fillTide();
      if ((weatherEmpty() || t.sea.weatherAuto) && navigator.onLine) fillWeather(true);
    }
    if (path === 's.date') {
      const next = shiomawari(t.date);
      if (!t.sea.tide.shiomawari || t.sea.tide.shiomawari === autoShio) t.sea.tide.shiomawari = next;
      autoShio = next;
      refreshInputs();
    }
    if (path === 's.date' || path === 's.sea.side') fillTide();
    if (WEATHER_PATHS.includes(path)) t.sea.weatherAuto = false;
    // 時刻や日付を入れたら、自動入力のままの天気・風を取り直す
    if (['s.startTime', 's.endTime', 's.date'].includes(path) && t.sea.weatherAuto && navigator.onLine) fillWeather(true);
    if (path === 's.startTime' || path === 's.endTime') { if (t.sea.tide.auto) fillTide(); else syncTide(); refreshEndNote(); }
    if (['s.river', 's.date', 's.startTime', 's.sea.side', 's.sea.light', 's.sea.windDir', 's.sea.windSpeed', 's.sea.tide.shiomawari'].includes(path)) refreshBoard();
    // タチウオ：サイズごとの匹数から合計を出す
    if (path.startsWith('tachiuo.tachiuo.sizes.')) {
      recs.tachiuo.count = sizesTotal(recs.tachiuo.tachiuo.sizes);
      refreshSizes();
    }
    if (path === 'tachiuo.tachiuo.rigs') renderLures();
    if (path === 'tachiuo.tachiuo.firstHit' || path === 's.startTime') refreshFirstHit();
    touch();
  });

  // 満潮・干潮の入力
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-tide]');
    if (!el || el.dataset.tf === 'time') return; // 時刻は入力を終えたときに整える
    slots[el.dataset.tide][Number(el.dataset.i)].cm = el.value === '' ? null : Number(el.value);
    S().sea.tide.auto = false;
    syncTide(); touch(); tideNote();
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-tide][data-tf="time"]');
    if (!el) return;
    const v = normalizeTime(el.value);
    if (v === null) return; // 「4桁で入力してください」は共通の処理が出す
    el.value = v;
    if (slots[el.dataset.tide][Number(el.dataset.i)].time === v) return;
    slots[el.dataset.tide][Number(el.dataset.i)].time = v;
    S().sea.tide.auto = false;
    syncTide(); touch(); tideNote();
  });

  // 移動先の入力
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-mf]');
    if (!el) return;
    S().moves[Number(el.closest('.move-row').dataset.mi)][el.dataset.mf] = el.value;
    touch();
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-mf="time"]');
    if (!el) return;
    const v = normalizeTime(el.value);
    if (v === null) return;
    el.value = v;
    S().moves[Number(el.closest('.move-row').dataset.mi)].time = v;
    touch();
  });

  root.addEventListener('click', async (e) => {
    const kindBtn = e.target.closest('[data-kind-set]');
    if (kindBtn) { await setKinds(kindBtn.dataset.kindSet); return; }
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      await save();
      $$('.seg button', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      $$('.pane', root).forEach((p) => (p.hidden = p.dataset.pane !== tab));
      if (!isNew) history.replaceState(null, '', `#/edit/${S().id}?tab=${tab}`);
      $('#view').scrollTop = 0;
      return;
    }
    const el = e.target.closest('[data-act]');
    const act = el?.dataset.act;
    const k = el?.dataset.kind;
    if (act === 'weather') {
      fillWeather(false);
    } else if (act === 'tide-auto') {
      S().sea.tide.auto = true;
      fillTide();
      toast('満潮・干潮を自動のめやすに戻しました');
    } else if (act === 'use-trip') {
      // 仕掛けと、★だったもの（ジグヘッド・ワーム／仕掛け・テンヤ・餌）を「使った」として入れる
      const src = state.trips.find((t) => t.id === el.dataset.id);
      const dst = recs[src.kind];
      const sb = block(src), db2 = block(dst);
      for (const [key, v] of Object.entries(sb.tackle)) if (v) db2.tackle[key] = v;
      const types = src.kind === 'tachiuo' ? ['rigs', 'tenya', 'baits'] : ['jigheads', 'worms'];
      for (const type of types) {
        for (const it of sb[type].filter((x) => x.star)) {
          const key = starKey(type, it);
          if (!starState(db2[type], type, key)) db2[type] = cycleStar(db2[type], type, key);
        }
      }
      refreshInputs(); renderLures(); touch();
      toast(`${formatDate(src.date)}の仕掛けと★を入れました`);
    } else if (act === 'copy-last') {
      const last = latestOtherTrip(list().map((t) => t.id), k);
      if (!last) return toast('前回の仕掛けがありません');
      block(recs[k]).tackle = { ...block(recs[k]).tackle, ...clone(block(last).tackle) };
      refreshInputs(); touch();
      toast(`${formatDate(last.date)}の仕掛けを入れました`);
    } else if (act === 'save-preset') {
      const tk = block(recs[k]).tackle;
      if (!Object.values(tk).some(Boolean)) return toast('仕掛けを入力してから保存してください');
      const name = prompt('プリセットの名前', tk.rod || `いつもの${kindName(k)}`);
      if (!name) return;
      const p = { id: uid(), name, kind: k, tackle: clone(tk) };
      await db.put('presets', p);
      state.presets.push(p);
      $(`.preset-select[data-kind="${k}"]`, root).insertAdjacentHTML('beforeend', `<option value="${p.id}">${esc(p.name)}</option>`);
      toast('プリセットに保存しました');
    } else if (act === 'add-jig') {
      const inp = $('#add-jig', root);
      const g = Number(inp.value);
      if (!inp.value || !(g > 0)) return toast('重さを数字で入れてください（例: 0.5）');
      const a = recs.aji.aji;
      if (!starState(a.jigheads, 'jigheads', String(g))) a.jigheads = cycleStar(a.jigheads, 'jigheads', String(g));
      inp.value = '';
      renderLures(); touch();
    } else if (act === 'add-worm') {
      const name = $('#add-worm-name', root).value.trim(), color = $('#add-worm-color', root).value.trim();
      if (!name) return toast('ワームの名前を入れてください');
      const a = recs.aji.aji, key = starKey('worms', { name, color });
      if (!starState(a.worms, 'worms', key)) a.worms = cycleStar(a.worms, 'worms', key);
      $('#add-worm-name', root).value = ''; $('#add-worm-color', root).value = '';
      renderLures(); touch();
    } else if (act === 'add-hybrid') {
      const inp = $('#add-hybrid', root);
      // 「f15」「Ｆ－１５」なども「F-15」にそろえる
      let h = inp.value.trim().replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－ー―]/g, '-').toUpperCase();
      const m = h.match(/^([A-Z]+)-?(\d+)$/);
      if (m) h = `${m[1]}-${m[2]}`;
      if (!h) return toast('硬さを入れてください（例: F-15）');
      const b = recs.tachiuo.tachiuo, key = `${HYBRID} ${h}`;
      if (!starState(b.baits, 'baits', key)) b.baits = cycleStar(b.baits, 'baits', key);
      inp.value = '';
      renderLures(); touch();
    } else if (act === 'add-bycatch') {
      const inp = $('#add-bycatch', root);
      const name = inp.value.trim();
      if (!name) return;
      if (!recs.aji.aji.bycatch.includes(name)) recs.aji.aji.bycatch.push(name);
      inp.value = '';
      renderLures(); touch();
    } else if (act === 'add-move') {
      S().moves.push({ time: '', river: '', point: '' });
      renderMoves(); touch();
      $$('.move-row input[data-mf="time"]', root).pop()?.focus();
    } else if (act === 'del-move') {
      S().moves.splice(Number(el.closest('.move-row').dataset.mi), 1);
      renderMoves(); touch();
    } else if (act === 'voice') {
      const rec = new SpeechRec();
      rec.lang = 'ja-JP';
      rec.interimResults = false;
      el.disabled = true;
      el.textContent = '🎤 聞き取り中…話してください';
      rec.onresult = (ev) => {
        const text = ev.results[0][0].transcript;
        recs[k].memo = recs[k].memo ? `${recs[k].memo}\n${text}` : text;
        $(`textarea[data-path="${k}.memo"]`, root).value = recs[k].memo;
        touch();
      };
      rec.onerror = (ev) => toast(ev.error === 'network' ? '音声入力には電波が必要です' : '音声を聞き取れませんでした');
      rec.onend = () => { el.disabled = false; el.textContent = '🎤 音声で入力'; };
      rec.start();
    } else if (act === 'del-photo') {
      recs[k].photos = recs[k].photos.filter((p) => p.id !== el.dataset.id);
      renderPhotos(); touch();
    } else if (act === 'delete') {
      if (isNew && !dirty && !saved.size) { location.hash = '#/'; return; }
      const what = kinds().map(kindName).join('・');
      if (!confirm(`${formatDate(S().date)} ${S().river} の釣行（${what}）を削除しますか？`)) return;
      clearTimeout(timer);
      dirty = false;
      state.onLeave = null;
      const ids = list().map((t) => t.id).filter((x) => saved.has(x));
      location.hash = '#/';
      if (ids.length) await deleteTrips(ids, () => route());
    }
  });

  root.addEventListener('change', async (e) => {
    const sel = e.target.closest('.preset-select');
    if (sel) {
      const k = sel.dataset.kind;
      const p = state.presets.find((x) => x.id === sel.value);
      sel.value = '';
      if (!p) return;
      block(recs[k]).tackle = { ...block(recs[k]).tackle, ...clone(p.tackle) };
      refreshInputs(); touch();
      toast(`「${p.name}」を入れました`);
      return;
    }
    const ph = e.target.closest('.photo-input');
    if (ph) {
      const k = ph.dataset.kind;
      const files = [...ph.files];
      ph.value = '';
      if (!files.length) return;
      toast('写真を取り込み中…');
      for (const f of files) {
        try { recs[k].photos.push({ id: uid(), data: await resizeImage(f) }); } catch { toast('読み込めない写真がありました'); }
      }
      renderPhotos(); touch();
    }
  });

  $('#done').addEventListener('click', async () => {
    await save();
    state.onLeave = null;
    celebrateIfRecord();
    if (state.trips.some((t) => t.id === S().id)) state.currentId = S().id;
    location.hash = '#/';
  });

  render();
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
  const jigs = uniq([...JIG_WEIGHTS, ...TENYA_WEIGHTS, ...state.trips.flatMap((t) => [...(block(t).jigheads || []), ...(block(t).tenya || [])].map((j) => Number(j.g)))].map(String)).sort((a, b) => a - b);

  root.innerHTML = `
    <form class="form" autocomplete="off" onsubmit="return false">
      ${group('釣り物', chips(q, 'kind', KINDS.map((k) => [k, kindName(k)])))}
      ${field('言葉でさがす', input(q, 'text', 'type="search" placeholder="ワーム・餌・外道・メモなど（空白で区切ると両方を含むもの）"'))}
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
      ${group('ジグヘッド・テンヤの重さ', chips(q, 'jig', jigs.map((g) => [g, `${Number(g)}g`])))}
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
        <span class="r-main"><i class="r-kind" style="--kind:${KIND_COLOR[t.kind]}">${esc(kindName(t.kind))}</i>${esc(t.river)} ${esc(t.title)}</span>
        <span class="r-num">${has(t.count) ? esc(t.count) + '匹' : '-'}${tripMax(t) ? ` / ${esc(tripMax(t))}${t.kind === 'tachiuo' ? '' : 'cm'}` : ''}</span>
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
function viewSeason(season, kindArg) {
  setActiveTab('season');
  const kind = KINDS.includes(kindArg) ? kindArg : state.seasonKind;
  state.seasonKind = kind;
  const tachi = kind === 'tachiuo', cm = tachi ? '' : 'cm';
  const years = seasons(state.trips);
  const year = Number(season) || years[0] || new Date().getFullYear();
  // 釣り物ごとに別々に集計する。「両方」の日は、それぞれの釣り物で1回と数える
  const trips = state.trips.filter((t) => seasonOf(t) === year && t.kind === kind);
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

  const kindTabs = `<div class="kind-chips season-kinds">${KINDS.map((k) => `<a class="kind-chip k-${k}${k === kind ? ' on' : ''}" href="#/season/${year}/${k}">${kindName(k)}</a>`).join('')}</div>`;
  root.innerHTML = kindTabs + (trips.length ? `
    <div class="tiles">
      <div class="tile"><span>釣行回数</span><b>${s.tripCount}</b>回</div>
      <div class="tile"><span>総匹数</span><b>${s.totalCount}</b>匹</div>
      <div class="tile"><span>平均</span><b>${s.avgCount}</b>匹/回</div>
      <div class="tile"><span>最大サイズ</span><b>${s.maxSize ?? '-'}</b>${cm}</div>
      <div class="tile"><span>最多釣果</span><b>${s.bestTrip ? esc(s.bestTrip.count) : '-'}</b>匹</div>
      <div class="tile"><span>総バラシ</span><b>${s.totalBare}</b>回</div>
    </div>
    ${s.maxTrip ? `<p class="note">最大：${formatDate(s.maxTrip.date)} ${esc(s.maxTrip.river)}</p>` : ''}
    ${s.bestTrip ? `<p class="note">最多：${formatDate(s.bestTrip.date)} ${esc(s.bestTrip.river)}</p>` : ''}
    ${tachi ? `<h3>サイズ別</h3>${table(['サイズ', '匹数'], s.bySize.map((r) => [r.size, r.count]))}` : ''}

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
    ${tachi ? `${starTable('仕掛け', s.stars.rigs)}
    <div class="gap"></div>${starTable('テンヤの重さ', s.stars.tenya)}
    <div class="gap"></div>${starTable('餌', s.stars.baits)}` : `${starTable('ジグヘッド', s.stars.jigheads)}
    <div class="gap"></div>${starTable('ワーム', s.stars.worms)}`}
    <div class="gap"></div>${starTable('レンジ', s.stars.ranges)}
    <div class="gap"></div>${starTable('誘い方', s.stars.actions)}

    <button type="button" class="btn line wide" id="season-image">🖼 まとめ画像をLINEで送る</button>
    <button type="button" class="btn primary wide" id="export">📊 ${year}年の${kindName(kind)}をExcelで出力</button>
  ` : `<div class="empty"><p>${year}年の${kindName(kind)}の釣行はまだありません。</p></div>`);

  $('#season-select').addEventListener('change', (e) => { location.hash = `#/season/${e.target.value}/${kind}`; });
  $('#season-image', root)?.addEventListener('click', async () => {
    toast('画像を作成中…');
    const blob = await renderSeasonImage(year, s, placeColor, kind);
    const r = await shareBlob(blob, `お豆日記_${year}年_${kindName(kind)}まとめ.png`, `【お豆日記】${year}年 ${kindName(kind)} ${s.tripCount}回 ${s.totalCount}匹${s.maxSize ? ` 最大${s.maxSize}${cm}` : ''}`);
    if (r === 'downloaded') toast('画像を保存しました。LINEから送ってください');
  });
  $('#export', root)?.addEventListener('click', () => {
    const bytes = seasonXlsx(trips, year, kind);
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `お豆日記_${year}年_${kindName(kind)}.xlsx`);
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
        <li><div><b>${esc(p.name)}</b>（${esc(kindName(p.kind || 'aji'))}）<div class="muted">${esc(tackleSummary(p.tackle))}</div></div>
        <button type="button" class="btn small danger" data-act="del-preset" data-id="${p.id}">削除</button></li>`).join('')}</ul>`
        : '<p class="muted">入力画面の「仕掛け」欄にある「プリセットに保存」から登録できます。</p>'}

      <h3>記録を1件ずつ消す</h3>
      <details class="del-box" id="del-box">
        <summary>試しに入れた記録などを消すときに開きます（${state.trips.length}件）</summary>
        <p class="muted">「消す…」を押してから、もう一度「本当に消す」を押すと消えます。消した直後は、下に出る「元に戻す」で戻せます。「両方」の日のアジとタチウオは、別々に消せます。</p>
        <ul class="del-list" id="del-list"></ul>
      </details>

      <h3>バックアップ</h3>
      <p class="muted">記録はこのスマホの中だけに保存されています。機種変更やブラウザのデータ削除に備えて、ときどき書き出してください。（現在 <span id="trip-count">${state.trips.length}</span> 件）</p>
      <div class="tools">
        <button type="button" class="btn" data-act="backup">書き出す</button>
        <label class="btn"><input type="file" accept="application/json,.json" hidden id="restore">読み込む</label>
      </div>
      <p class="muted">読み込んでも、今ある記録は消えません（同じ記録は新しい方を残します）。</p>

      <h3>このアプリについて</h3>
      <p class="muted">お豆日記 v${APP_VERSION}${db.IS_TEST ? '（テスト版：本番とは別の保存場所です）' : ''}<br>Androidでは Chrome のメニューから「ホーム画面に追加」（または「アプリをインストール」）すると、アプリとして使えます。アジとタチウオの釣行を記録できます。電波のない堤防でも動きます（音声入力と天気・風の自動入力だけは電波が必要です）。天気は Open-Meteo の予報データを使っています。</p>
      <p class="muted">満潮・干潮のめやすは、気象庁「推算潮位の計算に用いた調和定数（60分潮）」（松山・宇和島、https://www.data.jma.go.jp/kaiyou/db/tide/suisan/）をもとにお豆日記が計算したもので、気象庁の発表値ではありません。実際の潮は天気や風で変わります。<br>出典：気象庁ホームページ</p>
    `;
    renderDelList();
  };

  const savePlaces = async () => { await db.setKV('places', state.places); };

  // 記録を1件ずつ消す一覧（新しい順）
  const renderDelList = () => {
    const ul = $('#del-list', root);
    if (!ul) return;
    const list = sortTrips(state.trips).reverse();
    ul.innerHTML = list.map((t) => `
      <li data-del-id="${t.id}">
        <span class="del-main"><span class="r-date">${formatDate(t.date)} ${esc(t.startTime)}</span>
          <span><i class="r-kind" style="--kind:${KIND_COLOR[t.kind]}">${esc(kindName(t.kind))}</i>${esc(t.river || '港未入力')} ${has(t.count) ? `${esc(t.count)}匹` : '（釣行後まだ）'}${t.title ? `「${esc(t.title)}」` : ''}</span></span>
        <span class="del-acts"><button type="button" class="btn small" data-act="del-ask">消す…</button></span>
      </li>`).join('') || '<li class="muted">記録はありません</li>';
    $('#del-box summary', root).textContent = `試しに入れた記録などを消すときに開きます（${state.trips.length}件）`;
    const c = $('#trip-count', root);
    if (c) c.textContent = state.trips.length;
  };

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
    const li = btn?.closest('[data-del-id]');
    if (act === 'del-ask') {
      // 1回目：確かめるボタンに変える（5秒で元に戻る）
      li.classList.add('asking');
      li.querySelector('.del-acts').innerHTML = '<button type="button" class="btn small danger-fill" data-act="del-yes">本当に消す</button><button type="button" class="btn small" data-act="del-no">やめる</button>';
      clearTimeout(li._t);
      li._t = setTimeout(() => { if (li.isConnected) renderDelList(); }, 5000);
      return;
    }
    if (act === 'del-no') { renderDelList(); return; }
    if (act === 'del-yes') {
      await deleteTrips([li.dataset.delId], () => { if (root.isConnected) { renderDelList(); $('#del-box', root).open = true; } });
      renderDelList();
      return;
    }
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
      downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `お豆日記_バックアップ_${todayISO()}.json`);
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
    if (data?.app === 'ayu-nikki') return toast('これは鮎日記のバックアップです。お豆日記には読み込めません');
    if (data?.app !== APP_ID || !Array.isArray(data.trips)) return toast('お豆日記のバックアップファイルではないようです');
    try {
      // 今ある記録は消さない。同じ記録は新しい方を残す
      const mine = new Map(state.trips.map((t) => [t.id, t]));
      const trips = data.trips.filter((t) => !t.kind || KINDS.includes(t.kind)).map(normalizeTrip)
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
    case 'season': return viewSeason(parts[1], parts[2]);
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
  const lk = await db.getKV('lastKinds', ['aji']);
  state.lastKinds = Array.isArray(lk) && lk.length && lk.every((k) => KINDS.includes(k)) ? lk : ['aji'];
}

async function start() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>データを読み込めませんでした。</p><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  applyMode();
  if (db.IS_TEST) {
    document.body.classList.add('is-test');
    document.body.insertAdjacentHTML('afterbegin', '<div class="test-band">テスト版（本番の記録とは別です）</div>');
    document.title = '【テスト版】' + document.title;
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
