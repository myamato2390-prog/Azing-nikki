import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  newTrip, normalizeTrip, sortTrips, formatDate, normalizeTime, formatMoves, addDays,
  endsNextDay, formatTimeRange, tripHours, isNextDayTime,
  cycleStar, starState, starText, starKey, starItem, jigLabel,
  formatWeather, formatWind, formatHighs, tackleSummary, DEFAULT_PLACES,
} from '../js/model.js';
import { filterTrips, matchTrip, describeQuery } from '../js/search.js';
import { summarize, seasons, starRanking } from '../js/stats.js';
import { crc32, colName } from '../js/xlsx.js';
import { seasonXlsx, seasonSheets } from '../js/export.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date), ...o });
const trips = [
  mk({ date: '2026-10-12', river: '三崎港', startTime: '18:30', endTime: '02:00', count: 18, maxSize: 24.5, bare: 3, memo: '常夜灯の明暗で連発',
    aji: { side: 'uwa', light: '明暗の境目', tide: { shiomawari: '大潮' }, tackle: { lineType: 'エステル', lineSize: '0.3号' },
      jigheads: [{ g: 1, star: true }, { g: 0.8, star: false }], worms: [{ name: 'アジアダー', color: 'クリア夜光', star: true }],
      ranges: [{ name: '表層', star: true }], bycatch: ['メバル'] } }),
  mk({ date: '2026-06-01', river: '長浜港', count: 5, maxSize: 19, moves: [{ time: '21:00', river: '拓海', point: '' }],
    aji: { side: 'seto', tide: { shiomawari: '小潮' }, jigheads: [{ g: 1, star: false }], actions: [{ name: 'ただ巻き', star: true }] } }),
  mk({ date: '2026-10-20', river: '三崎港', count: 9, aji: { side: 'uwa', tide: { shiomawari: '中潮' }, jigheads: [{ g: 0.8, star: true }] } }),
  mk({ date: '2025-11-03', river: '伊方港', count: 2, aji: { side: 'uwa' } }),
];

test('trip shape: common fields + kind + aji block', () => {
  const t = newTrip('2026-11-10');
  assert.equal(t.kind, 'aji');
  // 鮎日記と共通の項目名
  for (const k of ['id', 'date', 'river', 'point', 'startTime', 'endTime', 'weather', 'tempMorning', 'tempMax', 'waterTemp',
    'moves', 'title', 'count', 'maxSize', 'bare', 'sizeFeel', 'jiai', 'memo', 'photos', 'createdAt', 'updatedAt']) assert.ok(k in t, k);
  // 鮎専用・費用の項目は持たない
  for (const k of ['levelCm', 'aka', 'otori', 'ticket', 'otherCost', 'tackle']) assert.equal(k in t, false, k);
  const n = normalizeTrip({ date: '2026-01-01', sea: { tide: { shiomawari: '大潮' } } });
  assert.equal(n.kind, 'aji');
  assert.deepEqual(n.sea.tide.highs, []);
  assert.equal(n.sea.tide.shiomawari, '大潮');
  assert.equal(n.aji.tackle.rod, '');
  assert.deepEqual(n.aji.jigheads, []);
  assert.equal(DEFAULT_PLACES.length, 13);
  assert.equal(DEFAULT_PLACES.filter((p) => p.side === 'seto').length, 9);
});

test('model helpers', () => {
  assert.equal(formatDate('2026-07-12'), '2026.7.12（日）');
  assert.deepEqual(sortTrips(trips).map((t) => t.date), ['2025-11-03', '2026-06-01', '2026-10-12', '2026-10-20']);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(tackleSummary(trips[0].aji.tackle), 'エステル 0.3号');
  assert.equal(formatWeather({ weather: '晴れ', sea: { tempStart: 14.2 } }), '晴れ 14.2℃');
  assert.equal(formatWind({ sea: { windDir: '北西', windSpeed: 3.2, windMax: 6 } }), '北西 3.2m/s（最大6）');
  assert.equal(formatHighs({ sea: { tide: { highs: [{ time: '19:42', cm: 312 }, { time: '07:50', cm: null, nextDay: true }] } } }), '19:42(312cm)・翌07:50');
});

test('time, night trips & moves', () => {
  assert.equal(normalizeTime('0730'), '07:30');
  assert.equal(normalizeTime('730'), '07:30');
  assert.equal(normalizeTime('7:5'), null);
  assert.equal(normalizeTime('16'), '16:00');
  assert.equal(normalizeTime('１６３０'), '16:30');
  assert.equal(normalizeTime('2460'), null);
  assert.equal(normalizeTime(''), '');
  assert.deepEqual(formatMoves(trips[1]), ['21:00 拓海']);
  assert.equal(endsNextDay(trips[0]), true);
  assert.equal(formatTimeRange(trips[0]), '18:30〜翌02:00');
  assert.equal(tripHours(trips[0]), 7.5);
  assert.equal(tripHours({ startTime: '19:00', endTime: '22:30' }), 3.5);
  assert.equal(formatTimeRange({ startTime: '19:00', endTime: '22:30' }), '19:00〜22:30');
  assert.equal(isNextDayTime({ startTime: '18:30' }, '01:15'), true);
  assert.equal(isNextDayTime({ startTime: '18:30' }, '19:40'), false);
  assert.equal(isNextDayTime({ startTime: '05:00' }, '07:00'), false);
});

test('stars: none → used → star → none', () => {
  let l = cycleStar([], 'jigheads', '1');
  assert.deepEqual(l, [{ g: 1, star: false }]);
  assert.equal(starState(l, 'jigheads', '1'), 1);
  l = cycleStar(l, 'jigheads', '1');
  assert.equal(starState(l, 'jigheads', '1'), 2);
  l = cycleStar(l, 'jigheads', '0.6');
  assert.deepEqual(l.map((x) => x.g), [0.6, 1]);
  assert.equal(starText(l, 'jigheads'), '1.0g★・0.6g');
  l = cycleStar(l, 'jigheads', '1');
  assert.equal(starState(l, 'jigheads', '1'), 0);
  const w = { name: 'アジアダー', color: 'クリア夜光' };
  assert.deepEqual(starItem('worms', starKey('worms', w)), w);
  assert.equal(starText(cycleStar([], 'worms', starKey('worms', w)), 'worms'), 'アジアダー クリア夜光');
  assert.equal(jigLabel(0.8), '0.8g');
  assert.equal(jigLabel(2), '2.0g');
});

test('search', () => {
  assert.equal(filterTrips(trips, { river: '拓海' }).length, 1);
  assert.equal(filterTrips(trips, { river: '三崎港' }).length, 2);
  assert.equal(filterTrips(trips, { side: 'uwa' }).length, 3);
  assert.equal(filterTrips(trips, { season: '2026', minCount: '6' }).length, 2);
  assert.equal(filterTrips(trips, { shiomawari: '大潮' }).length, 1);
  assert.equal(filterTrips(trips, { light: '明暗の境目' }).length, 1);
  assert.equal(filterTrips(trips, { jig: '0.8' }).length, 2);
  assert.equal(filterTrips(trips, { text: 'メバル' }).length, 1);
  assert.equal(filterTrips(trips, { text: 'エステル 三崎' }).length, 1);
  assert.equal(filterTrips(trips, { text: 'クリア夜光' }).length, 1);
  assert.equal(filterTrips(trips, { text: '宇和海側' }).length, 3);
  assert.equal(filterTrips(trips, { from: '2026-10-01', to: '2026-10-15' }).length, 1);
  assert.ok(matchTrip(trips[0], {}));
  assert.equal(describeQuery({ side: 'seto', jig: '1', shiomawari: '大潮' }), '瀬戸内側 × 大潮 × 1.0g');
});

test('stats', () => {
  const y = trips.filter((t) => t.date.startsWith('2026'));
  const s = summarize(y);
  assert.equal(s.tripCount, 3);
  assert.equal(s.totalCount, 32);
  assert.equal(s.avgCount, 10.7);
  assert.equal(s.maxSize, 24.5);
  assert.equal(s.totalBare, 3);
  assert.deepEqual(s.byMonth.map((r) => [r.month, r.count]), [[6, 5], [10, 27]]);
  assert.equal(s.byRiver[0].river, '三崎港');
  assert.deepEqual(s.bySide.map((r) => [r.label, r.count]), [['宇和海側', 27], ['瀬戸内側', 5]]);
  assert.deepEqual(s.byShio.map((r) => r.shio), ['大潮', '中潮', '小潮']);
  assert.deepEqual(starRanking(y, 'jigheads'), [{ label: '0.8g', stars: 1, used: 2 }, { label: '1.0g', stars: 1, used: 2 }]);
  assert.equal(s.stars.worms[0].label, 'アジアダー クリア夜光');
  assert.deepEqual(seasons(trips), [2026, 2025]);
  assert.equal(summarize([]).avgCount, 0);
});

test('xlsx', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(colName(0), 'A');
  assert.equal(colName(26), 'AA');
  const y = trips.filter((t) => t.date.startsWith('2026'));
  const sheets = seasonSheets(y, 2026);
  const head = sheets[0].rows[0].map((c) => c.v);
  const row = sheets[0].rows.find((r) => r[0] === '2026-10-12');
  assert.equal(row[head.indexOf('ジグヘッド')], '1.0g★・0.8g');
  assert.equal(row[head.indexOf('終了')], '翌02:00');
  assert.equal(row[head.indexOf('側')], '宇和海側');
  const bytes = seasonXlsx(y, 2026);
  assert.equal(bytes[0], 0x50);
  if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, bytes);
});
