// 天気・気温の自動入力（Open-Meteo：無料・登録不要）
// 朝の気温＝当日6時の気温、最高気温＝当日の最高気温（予報）、天気＝7〜17時で一番多い天気

// WMO天気コード → アプリの天気
export function wmoToWeather(code) {
  if (code === null || code === undefined) return '';
  if (code <= 1) return '晴れ';
  if (code === 2) return '薄曇り';
  if (code === 3 || code === 45 || code === 48) return '曇り';
  if ([51, 53, 56, 61, 80, 85].includes(code)) return '小雨';
  return '雨';
}

const r1 = (n) => (n === null || n === undefined || isNaN(n) ? null : Math.round(n * 10) / 10);
const r0 = (n) => (n === null || n === undefined || isNaN(n) ? null : Math.round(n));

export function weatherUrl(lat, lon, date, archive = false) {
  const host = archive ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const q = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max',
    timezone: 'Asia/Tokyo',
    start_date: date, end_date: date,
  });
  return `${host}?${q}`;
}

export function parseWeather(json, date) {
  const h = json?.hourly || {};
  const times = h.time || [];
  const at = (hh) => times.indexOf(`${date}T${String(hh).padStart(2, '0')}:00`);
  const i6 = at(6);
  const tempMorning = i6 >= 0 ? r1(h.temperature_2m?.[i6]) : null;
  const di = (json?.daily?.time || []).indexOf(date);
  const tempMax = di >= 0 ? r0(json.daily.temperature_2m_max?.[di]) : null;

  const tally = {};
  for (let hh = 7; hh <= 17; hh++) {
    const i = at(hh);
    const w = i >= 0 ? wmoToWeather(h.weather_code?.[i]) : '';
    if (w) tally[w] = (tally[w] || 0) + 1;
  }
  const weather = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { weather, tempMorning, tempMax };
}

const usable = (w) => w.tempMax !== null || w.tempMorning !== null || w.weather;

// 予報（過去3か月〜16日先）→ だめなら過去データ
export async function fetchWeather(lat, lon, date, fetchFn = fetch) {
  for (const archive of [false, true]) {
    try {
      const res = await fetchFn(weatherUrl(lat, lon, date, archive));
      if (!res.ok) continue;
      const w = parseWeather(await res.json(), date);
      if (usable(w)) return w;
    } catch { /* 次を試す */ }
  }
  throw new Error('天気を取得できませんでした');
}
