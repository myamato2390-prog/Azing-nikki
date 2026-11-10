import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip, normalizeTrip, formatWeather } from '../js/model.js';
import { pointStats, similarTrips, personalBests, recordBadges, newRecords } from '../js/insights.js';
import { parseWeather, wmoToWeather, fetchWeather, weatherUrl } from '../js/weather.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date), ...o });
const trips = [
  mk({ id: 'a', date: '2025-07-10', river: '面河川', point: '仕七川小学校前', count: 10, maxSize: 23, levelCm: -14, station: '仕出', clarity: '澄み' }),
  mk({ id: 'b', date: '2026-07-12', river: '面河川', point: '仕七川小学校前', count: 18, maxSize: 24.5, levelCm: -15, station: '仕出', clarity: '澄み', aka: '良い' }),
  mk({ id: 'c', date: '2026-08-02', river: '面河川', point: '別の瀬', count: 4, maxSize: 26, levelCm: 20, station: '仕出' }),
  mk({ id: 'd', date: '2026-06-01', river: '仁淀川', point: '越知', count: 25, maxSize: 19 }),
  mk({ id: 'e', date: '2026-08-10', river: '面河川', point: '仕七川小学校前' }), // 釣行後が未入力
];

test('legacy airTemp migrates to tempMax', () => {
  const t = normalizeTrip({ date: '2025-07-01', airTemp: 30, weather: '晴れ' });
  assert.equal(t.tempMax, 30);
  assert.equal('airTemp' in t, false);
  assert.equal(formatWeather({ ...t, tempMorning: 18.5 }), '晴れ 朝18.5℃／最高30℃');
});

test('pointStats', () => {
  assert.deepEqual(pointStats(trips, '面河川', '仕七川小学校前'), { trips: 2, avg: 14, best: 18, max: 24.5 });
  assert.equal(pointStats(trips, '面河川', '未知'), null);
});

test('similarTrips', () => {
  const r = similarTrips(trips, { river: '面河川', point: '仕七川小学校前', levelCm: -13, station: '仕出', clarity: '澄み', date: '2026-07-20' }, 'e');
  assert.deepEqual(r.map((x) => x.trip.id), ['b', 'a', 'c']);
  assert.ok(r[0].why.includes('同じポイント') && r[0].why.includes('水位±5cm') && r[0].why.includes('7月'));
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

const sample = (date) => {
  const time = [], temp = [], code = [];
  for (let h = 0; h < 24; h++) { time.push(`${date}T${String(h).padStart(2, '0')}:00`); temp.push(15 + h * 0.6); code.push(h < 12 ? 1 : h < 15 ? 3 : 61); }
  return { hourly: { time, temperature_2m: temp, weather_code: code }, daily: { time: [date], temperature_2m_max: [30.6] } };
};

test('weather parsing', () => {
  assert.equal(wmoToWeather(0), '晴れ');
  assert.equal(wmoToWeather(3), '曇り');
  assert.equal(wmoToWeather(61), '小雨');
  assert.equal(wmoToWeather(95), '雨');
  assert.deepEqual(parseWeather(sample('2026-07-12'), '2026-07-12'), { weather: '晴れ', tempMorning: 18.6, tempMax: 31 });
  assert.ok(weatherUrl(33.68, 133.03, '2026-07-12').includes('start_date=2026-07-12'));
});

test('fetchWeather falls back to archive', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('archive')) return { ok: true, json: async () => sample('2024-07-12') };
    return { ok: false, json: async () => ({}) };
  };
  const w = await fetchWeather(33.68, 133.03, '2024-07-12', fake);
  assert.equal(w.tempMax, 31);
  assert.equal(calls.length, 2);
  await assert.rejects(fetchWeather(1, 1, '2024-07-12', async () => ({ ok: false })));
});
