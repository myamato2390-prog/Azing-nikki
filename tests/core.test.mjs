import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { newTrip, normalizeTrip, tripCost, sortTrips, formatDate, formatLevel, normalizeTime, formatMoves } from '../js/model.js';
import { filterTrips, matchTrip } from '../js/search.js';
import { summarize, seasons, levelBucket } from '../js/stats.js';
import { crc32, colName } from '../js/xlsx.js';
import { seasonXlsx } from '../js/export.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date), ...o });
const trips = [
  mk({ date: '2026-07-12', river: '面河川', point: '仕七川小学校前', count: 18, maxSize: 24.5, bare: 3, levelWord: '平水', levelCm: -15, station: '仕出', clarity: '澄み', otori: { cost: 1500 }, ticket: { type: '日券', cost: 3000 }, tackle: { mainLine: 'メタル 0.07号' }, memo: '午後から垢飛び' }),
  mk({ date: '2026-06-01', river: '仁淀川', count: 5, maxSize: 19, levelCm: 10, moves: [{ time: '11:00', river: '土居川', point: '大渡' }], methods: ['泳がせ'] }),
  mk({ date: '2026-07-20', river: '面河川', count: 9, levelCm: -12, station: '仕出', otherCost: 500 }),
  mk({ date: '2025-08-03', river: '久万川', count: 2 }),
];

test('model helpers', () => {
  assert.equal(formatDate('2026-07-12'), '2026.7.12（日）');
  assert.equal(formatLevel(trips[0]), '平水 -15cm（仕出）');
  assert.equal(formatLevel(trips[1]), '+10cm');
  assert.equal(tripCost(trips[0]), 4500);
  assert.deepEqual(sortTrips(trips).map((t) => t.date), ['2025-08-03', '2026-06-01', '2026-07-12', '2026-07-20']);
});

test('time & moves', () => {
  assert.equal(normalizeTime('0730'), '07:30');
  assert.equal(normalizeTime('730'), '07:30');
  assert.equal(normalizeTime('7:5'), null);
  assert.equal(normalizeTime('16'), '16:00');
  assert.equal(normalizeTime('１６３０'), '16:30');
  assert.equal(normalizeTime('2460'), null);
  assert.equal(normalizeTime(''), '');
  assert.deepEqual(formatMoves(trips[1]), ['11:00 土居川 大渡']);
});

test('search', () => {
  assert.equal(filterTrips(trips, { river: '土居川' }).length, 1);
  assert.equal(filterTrips(trips, { text: '泳がせ' }).length, 1);
  assert.equal(filterTrips(trips, { river: '面河川' }).length, 2);
  assert.equal(filterTrips(trips, { season: '2026', minCount: '6' }).length, 2);
  assert.equal(filterTrips(trips, { text: 'メタル 面河' }).length, 1);
  assert.equal(filterTrips(trips, { text: '仕七川' }).length, 1);
  assert.equal(filterTrips(trips, { from: '2026-07-01', to: '2026-07-15' }).length, 1);
  assert.ok(matchTrip(trips[0], {}));
});

test('stats', () => {
  const s = summarize(trips.filter((t) => t.date.startsWith('2026')));
  assert.equal(s.tripCount, 3);
  assert.equal(s.totalCount, 32);
  assert.equal(s.avgCount, 10.7);
  assert.equal(s.maxSize, 24.5);
  assert.equal(s.totalCost, 5000);
  assert.equal(s.costPerFish, 156);
  assert.deepEqual(s.byMonth.map((r) => [r.month, r.count]), [[6, 5], [7, 27]]);
  assert.equal(s.byRiver[0].river, '面河川');
  const omogo = s.byLevel.filter((r) => r.river === '面河川');
  assert.deepEqual(omogo.map((r) => [r.range, r.count]), [['-20〜-11cm', 27]]);
  assert.deepEqual(seasons(trips), [2026, 2025]);
  assert.equal(levelBucket(0).label, '0〜+9cm');
  assert.equal(summarize([]).avgCount, 0);
});

test('xlsx', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(colName(0), 'A');
  assert.equal(colName(26), 'AA');
  const bytes = seasonXlsx(trips.filter((t) => t.date.startsWith('2026')), 2026);
  assert.equal(bytes[0], 0x50);
  if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, bytes);
});
