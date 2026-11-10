// 天気・風・気温の自動入力（Open-Meteo：無料・登録不要）
// 夜釣りに合わせ、天気と風は「開始時刻〜終了時刻」の時間帯で集計する。
// 釣り始めの気温＝開始時刻の気温、朝の気温＝当日6時、最高気温＝当日の最高（鮎日記と同じ）
import { addDays } from './model.js';

// WMO天気コード → アプリの天気
export function wmoToWeather(code) {
  if (code === null || code === undefined) return '';
  if (code <= 1) return '晴れ';
  if (code === 2) return '薄曇り';
  if (code === 3 || code === 45 || code === 48) return '曇り';
  if ([51, 53, 56, 61, 80, 85].includes(code)) return '小雨';
  return '雨';
}

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const degToDir = (deg) => (deg === null || deg === undefined || isNaN(deg) ? '' : DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

const ok = (n) => n !== null && n !== undefined && !isNaN(n);
const r1 = (n) => (ok(n) ? Math.round(n * 10) / 10 : null);
const r0 = (n) => (ok(n) ? Math.round(n) : null);

export function weatherUrl(lat, lon, date, archive = false) {
  const host = archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const q = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
    daily: 'temperature_2m_max',
    wind_speed_unit: 'ms',
    timezone: 'Asia/Tokyo',
    start_date: date, end_date: addDays(date, 1), // 日付をまたぐ釣行のため翌日まで
  });
  return `${host}?${q}`;
}

// 集計する時間帯（当日0時からの時間）。開始がなければ18〜24時、終了がなければ開始から3時間
export function hourWindow(startTime, endTime) {
  if (!startTime) return [18, 24];
  const s = Number(startTime.slice(0, 2));
  if (!endTime) return [s, s + 3];
  let e = Number(endTime.slice(0, 2)) + (Number(endTime.slice(3, 5)) > 0 ? 1 : 0);
  if (endTime < startTime) e += 24;
  return [s, Math.max(e, s + 1)];
}

const mode = (list) => {
  const tally = {};
  for (const v of list) if (v) tally[v] = (tally[v] || 0) + 1;
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

export function parseWeather(json, date, startTime = '', endTime = '') {
  const h = json?.hourly || {};
  const times = h.time || [];
  // 当日0時からの時間 → 配列の位置（24以上は翌日）
  const at = (hh) => times.indexOf(`${hh >= 24 ? addDays(date, 1) : date}T${String(hh % 24).padStart(2, '0')}:00`);
  const pick = (key, hh) => { const i = at(hh); return i >= 0 ? h[key]?.[i] : null; };

  const tempMorning = r1(pick('temperature_2m', 6));
  const di = (json?.daily?.time || []).indexOf(date);
  const tempMax = di >= 0 ? r0(json.daily.temperature_2m_max?.[di]) : null;

  const [s, e] = hourWindow(startTime, endTime);
  const hours = [];
  for (let hh = s; hh <= e; hh++) hours.push(hh);
  const weather = mode(hours.map((hh) => wmoToWeather(pick('weather_code', hh))));
  const speeds = hours.map((hh) => pick('wind_speed_10m', hh)).filter(ok);
  const windDir = mode(hours.map((hh) => degToDir(pick('wind_direction_10m', hh))));
  return {
    weather, tempMorning, tempMax,
    tempStart: r1(pick('temperature_2m', s)),
    windDir,
    windSpeed: speeds.length ? r1(speeds.reduce((a, b) => a + b, 0) / speeds.length) : null,
    windMax: speeds.length ? r1(Math.max(...speeds)) : null,
  };
}

const usable = (w) => w.tempMax !== null || w.tempMorning !== null || w.tempStart !== null || w.weather;

// 予報（過去3か月〜16日先）→ だめなら過去データ
export async function fetchWeather(lat, lon, date, startTime = '', endTime = '', fetchFn = fetch) {
  for (const archive of [false, true]) {
    try {
      const res = await fetchFn(weatherUrl(lat, lon, date, archive));
      if (!res.ok) continue;
      const w = parseWeather(await res.json(), date, startTime, endTime);
      if (usable(w)) return w;
    } catch { /* 次を試す */ }
  }
  throw new Error('天気を取得できませんでした');
}
