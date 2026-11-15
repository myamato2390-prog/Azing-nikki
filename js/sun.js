// 日の出・日の入りの時刻を計算する（電波なしで使える。DOMに依存しない）
// 太陽の位置のふつうの計算式（日の出の式）で、誤差は1〜2分ほど。
// 平らな場所での時刻なので、山に囲まれた谷では、実際に日が当たるのはもっと遅く・早く暗くなる

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// dateISO: 'YYYY-MM-DD'、lat/lon: 緯度・経度（東経が正）、tz: 時差（日本は 9）
// → { sunrise: 'HH:MM', sunset: 'HH:MM' }。白夜・極夜などで出ないときは ''
export function sunTimes(dateISO, lat, lon, tz = 9) {
  const [y, m, d] = String(dateISO || '').split('-').map(Number);
  const ok = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (!y || !m || !d || !ok(lat) || !ok(lon)) return { sunrise: '', sunset: '' };
  // その日の正午（その場所の太陽の南中）に近い日数
  const jdNoon = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
  const n = Math.round(jdNoon - 2451545.0 + 0.0008);
  const jStar = n - Number(lon) / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const L = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * L));
  const sinDec = Math.sin(rad(L)) * Math.sin(rad(23.4397));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * sinDec) / (Math.cos(rad(lat)) * cosDec);
  if (cosW < -1 || cosW > 1) return { sunrise: '', sunset: '' };
  const w = deg(Math.acos(cosW));
  const toHM = (jd) => {
    const local = new Date((jd - 2440587.5) * 86400000 + tz * 3600000 + 30000); // 30秒足して四捨五入
    return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  };
  return { sunrise: toHM(jTransit - w / 360), sunset: toHM(jTransit + w / 360) };
}
