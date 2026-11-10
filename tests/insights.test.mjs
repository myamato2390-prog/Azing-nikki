import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip, normalizeTrip } from '../js/model.js';
import { placeStats, similarTrips, personalBests, recordBadges, newRecords } from '../js/insights.js';
import { parseWeather, wmoToWeather, fetchWeather, weatherUrl, hourWindow, degToDir } from '../js/weather.js';
import { shiomawari, moonAge } from '../js/tide.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date), ...o });
const trips = [
  mk({ id: 'a', date: '2025-10-10', river: '三崎港', startTime: '19:00', count: 10, maxSize: 23, aji: { side: 'uwa', light: 'あり', tide: { shiomawari: '大潮' } } }),
  mk({ id: 'b', date: '2026-10-12', river: '三崎港', startTime: '18:30', count: 18, maxSize: 24.5, aji: { side: 'uwa', light: 'あり', windDir: '北', windSpeed: 3, tide: { shiomawari: '大潮' } } }),
  mk({ id: 'c', date: '2026-08-02', river: '名取港', count: 4, maxSize: 26, aji: { side: 'uwa', tide: { shiomawari: '小潮' } } }),
  mk({ id: 'd', date: '2026-06-01', river: '長浜港', count: 25, maxSize: 19, aji: { side: 'seto', tide: { shiomawari: '大潮' } } }),
  mk({ id: 'e', date: '2026-10-25', river: '三崎港', aji: { side: 'uwa' } }), // 釣行後が未入力
];

test('placeStats', () => {
  assert.deepEqual(placeStats(trips, '三崎港'), { trips: 2, avg: 14, best: 18, max: 24.5 });
  assert.equal(placeStats(trips, '未知'), null);
});

test('similarTrips: same side only, closest first', () => {
  const cond = mk({ date: '2026-10-20', river: '三崎港', startTime: '18:00', aji: { side: 'uwa', light: 'あり', windDir: '北', windSpeed: 4, tide: { shiomawari: '大潮' } } });
  const r = similarTrips(trips, cond, 'e');
  assert.deepEqual(r.map((x) => x.trip.id), ['b', 'a', 'c']); // 瀬戸内側の d は出ない
  for (const w of ['同じ港', '大潮', '常夜灯あり', '北の風', '風速が近い', '同じ時間帯', '10月']) assert.ok(r[0].why.includes(w), w);
  assert.deepEqual(similarTrips(trips, { river: '' }, null), []);
});

test('personal bests & badges', () => {
  const b = personalBests(trips, null);
  assert.equal(b.maxSize, 26);
  assert.equal(b.maxCount, 25);
  assert.deepEqual(recordBadges(trips, trips[2]), ['自己最大']);
  assert.deepEqual(recordBadges(trips, trips[3]), ['自己最多']);
  const before = personalBests(trips, 'e');
  assert.deepEqual(newRecords(before, { maxSize: 27.5, count: 3 }).map((x) => x.kind), ['最大サイズ']);
  assert.deepEqual(newRecords(personalBests([], null), { maxSize: 20, count: 5 }), []);
});

// 2日分の1時間ごとのデータ。気温は 10+時×0.5、風は当日 夜だけ強い北西
const sample = (date, next) => {
  const time = [], temp = [], code = [], ws = [], wd = [];
  for (const [di, d] of [date, next].entries()) {
    for (let h = 0; h < 24; h++) {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      temp.push(10 + h * 0.5 - di * 5);
      code.push(di === 0 && h >= 18 ? 3 : 0);
      ws.push(di === 0 && h >= 18 ? 4 : 2);
      wd.push(di === 0 && h >= 18 ? 315 : 0);
    }
  }
  return { hourly: { time, temperature_2m: temp, weather_code: code, wind_speed_10m: ws, wind_direction_10m: wd }, daily: { time: [date, next], temperature_2m_max: [21.6, 16] } };
};

test('weather & wind over the fishing hours', () => {
  assert.equal(wmoToWeather(0), '晴れ');
  assert.equal(wmoToWeather(3), '曇り');
  assert.equal(wmoToWeather(61), '小雨');
  assert.equal(wmoToWeather(95), '雨');
  assert.equal(degToDir(315), '北西');
  assert.equal(degToDir(350), '北');
  assert.deepEqual(hourWindow('', ''), [18, 24]);
  assert.deepEqual(hourWindow('18:30', ''), [18, 21]);
  assert.deepEqual(hourWindow('18:30', '02:00'), [18, 26]);
  assert.deepEqual(hourWindow('19:00', '22:30'), [19, 23]);
  const j = sample('2026-11-10', '2026-11-11');
  // 時刻なし → 18〜24時
  assert.deepEqual(parseWeather(j, '2026-11-10'), { weather: '曇り', tempMorning: 13, tempMax: 22, tempStart: 19, windDir: '北西', windSpeed: 3.7, windMax: 4 });
  // 翌日にまたぐ → 18時〜翌2時
  const w = parseWeather(j, '2026-11-10', '18:30', '02:00');
  assert.equal(w.tempStart, 19);
  assert.equal(w.windDir, '北西');
  assert.equal(w.windSpeed, 3.3);
  const u = weatherUrl(33.39, 132.12, '2026-11-10');
  assert.ok(u.includes('start_date=2026-11-10') && u.includes('end_date=2026-11-11') && u.includes('wind_speed_unit=ms'));
});

test('fetchWeather falls back to archive', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('archive')) return { ok: true, json: async () => sample('2024-07-12', '2024-07-13') };
    return { ok: false, json: async () => ({}) };
  };
  const w = await fetchWeather(33.39, 132.12, '2024-07-12', '', '', fake);
  assert.equal(w.tempMax, 22);
  assert.equal(calls.length, 2);
  await assert.rejects(fetchWeather(1, 1, '2024-07-12', '', '', async () => ({ ok: false })));
});

test('shiomawari from the moon', () => {
  assert.equal(shiomawari('2026-01-03'), '大潮'); // 満月
  assert.equal(shiomawari('2026-01-19'), '大潮'); // 新月
  assert.equal(shiomawari('2026-01-26'), '小潮'); // 上弦
  assert.equal(shiomawari('2026-01-11'), '小潮'); // 下弦
  assert.equal(shiomawari(''), '');
  assert.ok(moonAge('2026-01-03') > 13.5 && moonAge('2026-01-03') < 16);
  // 30日間に全部の潮回りが出る
  const set = new Set();
  for (let d = 1; d <= 30; d++) set.add(shiomawari(`2026-04-${String(d).padStart(2, '0')}`));
  assert.deepEqual([...set].sort(), ['中潮', '大潮', '小潮', '若潮', '長潮']);
});
