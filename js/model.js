// データ定義と共通ヘルパー（DOMに依存しない）

export const MAIN_RIVERS = ['面河川', '土居川', '仁淀川', '久万川'];

// 河川ごとのテーマ色：面河川＝面河グリーン、土居川・仁淀川＝仁淀ブルー
export const THEME_COLOR = '#0f5f57';
export const DEFAULT_RIVER_SETTINGS = [
  // lat/lon は天気の自動入力に使うおおよその位置（設定画面で変更可）
  { name: '面河川', station: '仕出', url: 'https://www.fishing-labo.net/modules/waterlevel/view.php?id=308041288813010', color: '#1e8a4c', lat: 33.68, lon: 133.03 },
  { name: '土居川', station: '', url: '', color: '#0f74b5', lat: 33.57, lon: 133.15 },
  { name: '仁淀川', station: '', url: '', color: '#0f74b5', lat: 33.53, lon: 133.25 },
  { name: '久万川', station: '', url: '', color: THEME_COLOR, lat: 33.66, lon: 132.90 },
];
export function defaultRiverColor(name) {
  return DEFAULT_RIVER_SETTINGS.find((r) => r.name === name)?.color || THEME_COLOR;
}
export function defaultRiverPos(name) {
  const r = DEFAULT_RIVER_SETTINGS.find((x) => x.name === name);
  return r ? { lat: r.lat, lon: r.lon } : { lat: null, lon: null };
}

export const WEATHER = ['晴れ', '薄曇り', '曇り', '小雨', '雨'];
export const LEVEL_WORDS = ['渇水', '平水', 'やや高', '高水', '増水'];
export const CLARITY = ['澄み', '笹濁り', '濁り'];
export const AKA = ['新垢', '良い', '普通', '腐れ', '垢飛び'];
export const SIZE_FEEL = ['小型中心', '中型中心', '大型混じり'];
export const JIAI = ['〜9時', '9〜11時', '11〜13時', '13〜15時', '15時〜'];
export const SPOTS = ['荒瀬', '早瀬', '平瀬', 'チャラ瀬', '段々瀬', '瀬肩', '瀬尻', '瀬落ち', 'トロ', '深トロ', '淵', '岩盤', '石裏', 'ヘチ', '分流'];
export const METHODS = ['泳がせ', '管理泳がせ', 'ゼロテンション', '引き釣り', '背バリ使用', 'オモリ使用'];
export const TICKET_TYPES = ['日券', '年券'];

export const TACKLE_FIELDS = [
  ['rod', '竿', '例: 9.0m 早瀬'],
  ['mainLine', '水中糸', '例: メタル 0.07号'],
  ['upperLine', '上付け糸', '例: フロロ 0.6号'],
  ['lowerLine', '下付け糸', '例: フロロ 0.3号'],
  ['hanakan', '鼻カン', '例: 6.0mm'],
  ['sakabari', '逆バリ', '例: 1号'],
  ['hook', 'ハリ', '例: 7.0号 4本イカリ'],
  ['harisu', 'ハリス', '例: 1.5号'],
  ['sinker', 'オモリ・背バリ', '例: 背バリ'],
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyTackle() {
  return Object.fromEntries(TACKLE_FIELDS.map(([k]) => [k, '']));
}

export function newTrip(date = todayISO()) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    date,
    river: '', point: '', startTime: '', endTime: '',
    weather: '', tempMorning: null, tempMax: null, waterTemp: null,
    levelWord: '', levelCm: null, station: '',
    clarity: '', aka: '',
    tackle: emptyTackle(),
    otori: { shop: '', count: null, cost: null },
    ticket: { type: '', cost: null },
    moves: [],
    title: '',
    count: null, maxSize: null, bare: null,
    sizeFeel: '', jiai: [], spots: [], spotsNote: '', methods: [],
    otherCost: null, memo: '', photos: [],
    createdAt: now, updatedAt: now,
  };
}

// インポート時などに欠けた項目を補う
export function normalizeTrip(t) {
  const base = newTrip(t.date || todayISO());
  const out = {
    ...base, ...t,
    id: t.id || base.id,
    tackle: { ...base.tackle, ...(t.tackle || {}) },
    otori: { ...base.otori, ...(t.otori || {}) },
    ticket: { ...base.ticket, ...(t.ticket || {}) },
    jiai: Array.isArray(t.jiai) ? t.jiai : [],
    spots: Array.isArray(t.spots) ? t.spots : [],
    methods: Array.isArray(t.methods) ? t.methods : [],
    moves: Array.isArray(t.moves) ? t.moves : [],
    photos: Array.isArray(t.photos) ? t.photos : [],
  };
  // v1.0 の「気温」は最高気温として引き継ぐ
  if (!has(out.tempMax) && has(t.airTemp)) out.tempMax = t.airTemp;
  delete out.airTemp;
  return out;
}

export const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
export const has = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

export function tripCost(t) {
  return num(t.otori?.cost) + num(t.ticket?.cost) + num(t.otherCost);
}

// 日付の古い順（カードは古い→新しいの順に並べ、最新を開く）
export function sortTrips(trips) {
  return [...trips].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.startTime || '').localeCompare(b.startTime || '') ||
    (a.createdAt || '').localeCompare(b.createdAt || ''));
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function weekday(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return '';
  return WD[new Date(y, m - 1, d).getDay()];
}
export function formatDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return '日付未設定';
  return `${y}.${m}.${d}（${weekday(iso)}）`;
}
export const seasonOf = (t) => Number((t.date || '').slice(0, 4)) || null;

// 「晴れ 朝18℃／最高31℃」
export function formatWeather(t) {
  const temps = [has(t.tempMorning) ? `朝${t.tempMorning}℃` : '', has(t.tempMax) ? `最高${t.tempMax}℃` : ''].filter(Boolean).join('／');
  return [t.weather, temps].filter(Boolean).join(' ');
}

export function formatLevel(t) {
  const parts = [];
  if (t.levelWord) parts.push(t.levelWord);
  if (has(t.levelCm)) parts.push(`${Number(t.levelCm) > 0 ? '+' : ''}${Number(t.levelCm)}cm`);
  let s = parts.join(' ');
  if (s && t.station) s += `（${t.station}）`;
  return s;
}

export function tackleSummary(tk = {}) {
  return TACKLE_FIELDS.map(([k]) => tk[k]).filter(Boolean).join(' / ');
}

export const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;

// "0730" "730" "7:30" "７３０" "7" → "07:30"。読めないときは null
export function normalizeTime(input) {
  if (input === null || input === undefined) return '';
  const t = String(input).trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：．.]/g, ':');
  if (!t) return '';
  let m = t.match(/^(\d{1,2}):?(\d{2})$/);
  let h, mi;
  if (m) { h = Number(m[1]); mi = Number(m[2]); } else if (/^\d{1,2}$/.test(t)) { h = Number(t); mi = 0; } else return null;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// 移動先を「→ 10:30 久万川 〇〇」の形で
export function formatMoves(t) {
  return (t.moves || []).filter((m) => m.river || m.point)
    .map((m) => [m.time, m.river, m.point].filter(Boolean).join(' '));
}
