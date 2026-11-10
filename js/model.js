// データ定義と共通ヘルパー（DOMに依存しない）
// 共通項目は鮎日記（Ayu-Nikki js/model.js の newTrip）と同じ名前・同じ形。
// アジング独自の項目は trip.aji にまとめる（SPEC.md 5章）

export const KIND = 'aji';
export const APP_ID = 'aji-nikki';

// 佐田岬テーマ：夜の海の藍・海の青・灯台の黄色・岬の緑
export const THEME_COLOR = '#1f6f9f';
export const SIDES = { seto: '瀬戸内側', uwa: '宇和海側' };
export const SIDE_COLOR = { seto: '#1f6f9f', uwa: '#1f8a8f' };
export const sideName = (side) => SIDES[side] || '';

// よく行く港。lat/lon は天気・風の自動入力に使うおおよその位置（設定画面で変更可）
const P = (name, side, lat, lon) => ({ name, side, color: SIDE_COLOR[side], lat, lon, tideOffsetMin: 0 });
export const DEFAULT_PLACES = [
  P('下灘港', 'seto', 33.65, 132.59),
  P('拓海', 'seto', 33.61, 132.47),
  P('長浜港', 'seto', 33.62, 132.48),
  P('櫛生港', 'seto', 33.58, 132.42),
  P('喜木津港', 'seto', 33.53, 132.37),
  P('塩成港', 'seto', 33.44, 132.23),
  P('三机港', 'seto', 33.45, 132.26),
  P('二名津', 'seto', 33.40, 132.10),
  P('松', 'seto', 33.40, 132.11),
  P('三崎港', 'uwa', 33.39, 132.12),
  P('名取港', 'uwa', 33.41, 132.17),
  P('伊方港', 'uwa', 33.49, 132.35),
  P('向灘の堤防', 'uwa', 33.47, 132.42),
];
export function defaultPlace(name) {
  return DEFAULT_PLACES.find((p) => p.name === name) || null;
}

export const WEATHER = ['晴れ', '薄曇り', '曇り', '小雨', '雨'];
export const WIND_DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const LIGHTS = ['あり', 'なし', '明暗の境目'];
export const SHIOMAWARI = ['大潮', '中潮', '小潮', '長潮', '若潮'];
export const SIZE_FEEL = ['豆アジ中心', '小アジ中心', '中アジ混じり', '尺アジ混じり'];
export const JIAI = ['夕まずめ', '〜20時', '20〜22時', '22〜24時', '0〜3時', '朝まずめ', '日中'];
export const TIDE_STAGES = ['上げ始め', '上げ', '満潮前後', '下げ始め', '下げ', '干潮前後'];
export const JIG_WEIGHTS = [0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0];
export const RANGES = ['表層', '中層', 'ボトム'];
export const ACTIONS = ['ただ巻き', 'リフト＆フォール', 'ドリフト', '放置'];
export const BYCATCH = ['メバル', 'カサゴ', 'カマス', 'セイゴ', 'サバ', 'イワシ', 'タチウオ', 'ベラ'];
export const LINE_TYPES = ['エステル', 'PE', 'フロロ', 'ナイロン'];

export const TACKLE_FIELDS = [
  ['rod', 'ロッド', '例: 6.4ft UL'],
  ['reel', 'リール', '例: 2000番'],
  ['lineType', 'ライン', '例: エステル'],
  ['lineSize', '号数', '例: 0.3号'],
  ['leader', 'リーダー', '例: フロロ 0.8号'],
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 日付を n 日ずらす（'2026-11-10', 1 → '2026-11-11'）
export function addDays(iso, n) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return iso;
  return todayISO(new Date(y, m - 1, d + n));
}

export function emptyTackle() {
  return Object.fromEntries(TACKLE_FIELDS.map(([k]) => [k, '']));
}

export function emptyAji() {
  return {
    side: '',
    light: '',
    windDir: '', windSpeed: null, windMax: null,
    tempStart: null,
    weatherAuto: false, // 天気・風が自動入力のまま（時刻を入れたら取り直す）
    tide: { shiomawari: '', highs: [], lows: [], station: '', auto: true },
    tideStages: [],
    tackle: emptyTackle(),
    jigheads: [], worms: [], ranges: [], actions: [],
    bycatch: [],
  };
}

export function newTrip(date = todayISO()) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    date,
    kind: KIND,
    river: '', point: '', startTime: '', endTime: '',
    weather: '', tempMorning: null, tempMax: null, waterTemp: null,
    moves: [],
    title: '',
    count: null, maxSize: null, bare: null,
    sizeFeel: '', jiai: [],
    memo: '', photos: [],
    aji: emptyAji(),
    createdAt: now, updatedAt: now,
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

// インポート時などに欠けた項目を補う
export function normalizeTrip(t) {
  const base = newTrip(t.date || todayISO());
  const a = t.aji || {};
  return {
    ...base, ...t,
    id: t.id || base.id,
    kind: t.kind || KIND,
    jiai: arr(t.jiai),
    moves: arr(t.moves),
    photos: arr(t.photos),
    aji: {
      ...base.aji, ...a,
      tide: { ...base.aji.tide, ...(a.tide || {}), highs: arr(a.tide?.highs), lows: arr(a.tide?.lows) },
      tideStages: arr(a.tideStages),
      tackle: { ...base.aji.tackle, ...(a.tackle || {}) },
      jigheads: arr(a.jigheads), worms: arr(a.worms), ranges: arr(a.ranges), actions: arr(a.actions),
      bycatch: arr(a.bycatch),
    },
  };
}

export const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v));
export const has = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));

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

// ---------- 夜釣り：日付をまたぐ時刻 ----------
// 終了時刻が開始時刻より前なら翌日
export const endsNextDay = (t) => !!(t.startTime && t.endTime && t.endTime < t.startTime);

// 「18:30〜翌02:00」
export function formatTimeRange(t) {
  if (!t.startTime && !t.endTime) return '';
  return `${t.startTime || '?'}〜${endsNextDay(t) ? '翌' : ''}${t.endTime || '?'}`;
}

// 釣りをした時間（時間、小数1桁）。どちらかが空なら null
export function tripHours(t) {
  if (!t.startTime || !t.endTime) return null;
  const min = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  let d = min(t.endTime) - min(t.startTime);
  if (d < 0) d += 24 * 60;
  return Math.round(d / 6) / 10;
}

// 夕方から始めた釣行では、午前の時刻は翌日とみなす（満潮・干潮の手入力用）
export function isNextDayTime(t, time) {
  return !!(time && t.startTime && t.startTime >= '12:00' && time < '12:00');
}

// ---------- ★（使った／良かった） ----------
// type: 'jigheads' {g} / 'worms' {name,color} / 'ranges'・'actions' {name}
export function starKey(type, item) {
  if (type === 'jigheads') return String(Number(item.g));
  if (type === 'worms') return `${item.name || ''}／${item.color || ''}`;
  return item.name || '';
}
export function starItem(type, key) {
  if (type === 'jigheads') return { g: Number(key) };
  if (type === 'worms') {
    const i = key.indexOf('／');
    return i < 0 ? { name: key, color: '' } : { name: key.slice(0, i), color: key.slice(i + 1) };
  }
  return { name: key };
}
export const jigLabel = (g) => `${Number.isInteger(Number(g)) ? Number(g).toFixed(1) : Number(g)}g`;
export function starLabel(type, item) {
  if (type === 'jigheads') return jigLabel(item.g);
  if (type === 'worms') return [item.name, item.color].filter(Boolean).join(' ');
  return item.name || '';
}
// 0=なし 1=使った 2=★良かった
export function starState(list, type, key) {
  const it = (list || []).find((x) => starKey(type, x) === key);
  return !it ? 0 : it.star ? 2 : 1;
}
// 押すたびに なし → 使った → ★良かった → なし
export function cycleStar(list, type, key) {
  const out = [...(list || [])];
  const i = out.findIndex((x) => starKey(type, x) === key);
  if (i < 0) out.push({ ...starItem(type, key), star: false });
  else if (!out[i].star) out[i] = { ...out[i], star: true };
  else out.splice(i, 1);
  if (type === 'jigheads') out.sort((a, b) => a.g - b.g);
  return out;
}
// ★を先に並べた表示用の一覧 [{ label, star }]
export function starredFirst(list, type) {
  return [...(list || [])]
    .sort((a, b) => Number(!!b.star) - Number(!!a.star))
    .map((x) => ({ label: starLabel(type, x), star: !!x.star }));
}
export const starText = (list, type) => starredFirst(list, type).map((x) => x.label + (x.star ? '★' : '')).join('・');

// ---------- 表示用 ----------
// 「晴れ 釣り始め14℃」
export function formatWeather(t) {
  return [t.weather, has(t.aji?.tempStart) ? `${t.aji.tempStart}℃` : ''].filter(Boolean).join(' ');
}
// 「朝8℃／最高17℃」（鮎日記と共通の項目）
export function formatDayTemps(t) {
  return [has(t.tempMorning) ? `朝${t.tempMorning}℃` : '', has(t.tempMax) ? `最高${t.tempMax}℃` : ''].filter(Boolean).join('／');
}
// 「北西 3m/s（最大6）」
export function formatWind(t) {
  const a = t.aji || {};
  const sp = has(a.windSpeed) ? `${a.windSpeed}m/s` : '';
  const mx = has(a.windMax) ? `（最大${a.windMax}）` : '';
  return [a.windDir, sp + (sp ? mx : '')].filter(Boolean).join(' ');
}
const tideList = (list) => (list || []).filter((x) => x.time)
  .map((x) => `${x.nextDay ? '翌' : ''}${x.time}${has(x.cm) ? `(${x.cm}cm)` : ''}`).join('・');
export const formatHighs = (t) => tideList(t.aji?.tide?.highs);
export const formatLows = (t) => tideList(t.aji?.tide?.lows);

export function tackleSummary(tk = {}) {
  const line = [tk.lineType, tk.lineSize].filter(Boolean).join(' ');
  return [tk.rod, tk.reel, line, tk.leader].filter(Boolean).join(' / ');
}

// 移動先を「21:30 三崎港」の形で
export function formatMoves(t) {
  return (t.moves || []).filter((m) => m.river || m.point)
    .map((m) => [m.time, m.river, m.point].filter(Boolean).join(' '));
}
