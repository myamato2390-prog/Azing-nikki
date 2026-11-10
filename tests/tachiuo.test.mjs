// タチウオと「両方」の日（v0.3）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newTrip, normalizeTrip, sortTrips, sizesTotal, maxF, fRank, formatSizes, cycleStar, starText, SHARED_KEYS, tackleSummary,
} from '../js/model.js';
import { filterTrips } from '../js/search.js';
import { summarize, tripMax } from '../js/stats.js';
import { placeStats, similarTrips, personalBests, recordBadges, newRecords } from '../js/insights.js';
import { seasonSheets, seasonXlsx } from '../js/export.js';

test('v0.2 records move their conditions to trip.sea', () => {
  // v0.2 までは状況も trip.aji の中にあった
  const old = { id: 'o', date: '2026-10-01', river: '三崎港', count: 5,
    aji: { side: 'uwa', light: 'あり', windDir: '北', windSpeed: 3, tempStart: 15, weatherAuto: true,
      tide: { shiomawari: '大潮', highs: [{ time: '19:00', cm: 180 }], lows: [], station: '宇和島', auto: true },
      tideStages: ['下げ'], jigheads: [{ g: 1, star: true }], tackle: { rod: '6.4ft' } } };
  const t = normalizeTrip(old);
  assert.equal(t.kind, 'aji');
  assert.equal(t.sea.side, 'uwa');
  assert.equal(t.sea.light, 'あり');
  assert.equal(t.sea.windDir, '北');
  assert.equal(t.sea.tempStart, 15);
  assert.equal(t.sea.tide.shiomawari, '大潮');
  assert.equal(t.sea.tide.highs[0].time, '19:00');
  // 釣り物の項目は trip.aji に残り、状況の項目は trip.aji から消える
  assert.deepEqual(t.aji.tideStages, ['下げ']);
  assert.equal(t.aji.jigheads[0].star, true);
  assert.equal(t.aji.tackle.rod, '6.4ft');
  assert.equal('side' in t.aji, false);
  assert.equal('tide' in t.aji, false);
  // 2回通しても変わらない
  assert.deepEqual(normalizeTrip(t), t);
});

test('tachiuo record shape', () => {
  const t = newTrip('2026-11-10', 'tachiuo');
  assert.equal(t.kind, 'tachiuo');
  assert.equal('aji' in t, false);
  assert.deepEqual(Object.keys(t.tachiuo.tackle), ['rod', 'reel', 'pe', 'leader']);
  assert.deepEqual(t.tachiuo.sizes, { 'F6以上': 0, F5: 0, F4: 0, F3: 0, 'F3未満': 0 });
  const n = normalizeTrip({ kind: 'tachiuo', date: '2026-11-10', tachiuo: { sizes: { F5: 2 } }, aji: { jigheads: [] } });
  assert.equal(n.tachiuo.sizes.F3, 0);
  assert.equal('aji' in n, false); // 1つの記録に釣り物は1つ
  assert.equal(normalizeTrip({ kind: 'ayu', date: '2026-01-01' }).kind, 'aji'); // 知らない種類はアジとして扱う
  assert.equal(tackleSummary({ rod: '8.6ft', pe: '0.8号', leader: 'フロロ 5号' }), '8.6ft / PE 0.8号 / フロロ 5号');
});

test('F sizes', () => {
  const sz = { 'F6以上': 0, F5: 2, F4: 0, F3: 5, 'F3未満': 1 };
  assert.equal(sizesTotal(sz), 8);
  assert.equal(maxF(sz), 'F5');
  assert.equal(formatSizes(sz), 'F5×2・F3×5・F3未満×1');
  assert.ok(fRank('F6以上') > fRank('F5') && fRank('F3') > fRank('F3未満') && fRank('') === 0);
  assert.equal(maxF({}), '');
  // テンヤの重さも ★
  let l = cycleStar([], 'tenya', '7');
  l = cycleStar(cycleStar(l, 'tenya', '3'), 'tenya', '3');
  assert.equal(starText(l, 'tenya'), '3g★・7g');
  assert.equal(starText(cycleStar([], 'baits', 'ハイブリッドクロス F-15'), 'baits'), 'ハイブリッドクロス F-15');
});

const mk = (o) => normalizeTrip({ ...newTrip(o.date, o.kind), ...o });
const sea = (side, shio) => ({ side, tide: { shiomawari: shio } });
const trips = [
  mk({ id: 'a1', date: '2026-10-10', kind: 'aji', river: '三崎港', count: 10, maxSize: 22, sea: sea('uwa', '大潮') }),
  // 「両方」の日：同じ pairId
  mk({ id: 'p1', date: '2026-10-20', kind: 'aji', pairId: 'P', river: '三崎港', startTime: '18:00', count: 6, maxSize: 26, sea: sea('uwa', '中潮') }),
  mk({ id: 'p2', date: '2026-10-20', kind: 'tachiuo', pairId: 'P', river: '三崎港', startTime: '18:00', count: 7, sea: sea('uwa', '中潮'),
    tachiuo: { sizes: { F5: 2, F3: 5 }, rigs: [{ name: 'テンヤ', star: true }], tenya: [{ g: 7, star: true }], baits: [{ name: 'ドジョウ（中）', star: true }] } }),
  mk({ id: 't1', date: '2026-11-02', kind: 'tachiuo', river: '三崎港', count: 3, sea: sea('uwa', '大潮'), tachiuo: { sizes: { F4: 3 }, rigs: [{ name: 'フリーフォール', star: false }], baits: [{ name: 'キビナゴ', star: true }] } }),
  mk({ id: 't2', date: '2026-11-05', kind: 'tachiuo', river: '長浜港', count: 4, sea: sea('seto', '小潮'), tachiuo: { sizes: { 'F6以上': 1, F3: 3 } } }),
];

test('pair sorts aji first, search by kind', () => {
  assert.deepEqual(sortTrips([trips[2], trips[1]]).map((t) => t.id), ['p1', 'p2']);
  assert.equal(filterTrips(trips, { kind: 'tachiuo' }).length, 3);
  assert.equal(filterTrips(trips, { kind: 'aji' }).length, 2);
  assert.equal(filterTrips(trips, { text: 'ドジョウ' }).length, 1);
  assert.equal(filterTrips(trips, { text: 'タチウオ F5' }).length, 1);
  assert.equal(filterTrips(trips, { jig: '7' }).length, 1); // テンヤの重さでも探せる
  assert.ok(SHARED_KEYS.includes('sea') && SHARED_KEYS.includes('pairId') && !SHARED_KEYS.includes('count'));
});

test('stats are separate per kind; a both-day counts once for each', () => {
  const aji = summarize(trips.filter((t) => t.kind === 'aji'));
  const tachi = summarize(trips.filter((t) => t.kind === 'tachiuo'));
  assert.equal(aji.tripCount, 2);
  assert.equal(aji.totalCount, 16);
  assert.equal(aji.maxSize, 26);
  assert.equal(tachi.tripCount, 3);
  assert.equal(tachi.totalCount, 14);
  assert.equal(tachi.maxSize, 'F6以上');
  assert.equal(tachi.maxTrip.id, 't2');
  assert.deepEqual(tachi.bySize, [{ size: 'F6以上', count: 1 }, { size: 'F5', count: 2 }, { size: 'F4', count: 3 }, { size: 'F3', count: 8 }]);
  assert.equal(tachi.byRiver.find((r) => r.river === '三崎港').max, 'F5');
  assert.equal(tachi.stars.baits[0].stars, 1);
  assert.equal(tripMax(trips[2]), 'F5');
  assert.equal(tripMax(trips[0]), 22);
});

test('place stats, board and personal bests per kind', () => {
  assert.deepEqual(placeStats(trips, '三崎港', 'tachiuo'), { trips: 2, avg: 5, best: 7, max: 'F5' });
  assert.deepEqual(placeStats(trips, '三崎港', 'aji'), { trips: 2, avg: 8, best: 10, max: 26 });
  const cond = mk({ date: '2026-11-08', kind: 'tachiuo', river: '三崎港', sea: sea('uwa', '大潮') });
  const r = similarTrips(trips, cond, null);
  assert.deepEqual(r.map((x) => x.trip.id), ['t1', 'p2']); // アジや瀬戸内側は出ない
  const b = personalBests(trips, null, 'tachiuo');
  assert.equal(b.maxSize, 'F6以上');
  assert.equal(b.maxCount, 7);
  assert.deepEqual(recordBadges(trips, trips[4]), ['自己最大']);
  assert.deepEqual(recordBadges(trips, trips[2]), ['自己最多']);
  assert.deepEqual(recordBadges(trips, trips[1]), ['自己最大']); // アジの最大はアジの中で
  const before = personalBests(trips, 'new', 'tachiuo');
  const rec = newRecords(before, mk({ kind: 'tachiuo', date: '2026-11-09', count: 9, tachiuo: { sizes: { 'F6以上': 2, F3: 7 } } }));
  assert.deepEqual(rec.map((x) => x.kind), ['最多匹数']); // F6以上は同じなので更新ではない
});

test('excel per kind', () => {
  const sh = seasonSheets(trips, 2026, 'tachiuo');
  const head = sh[0].rows[0].map((c) => c.v);
  assert.equal(sh[0].rows.length, 4); // 見出し＋タチウオ3件
  assert.ok(head.includes('F5') && head.includes('餌') && head.includes('テンヤの重さ') && !head.includes('ワーム'));
  const row = sh[0].rows.find((r) => r[0] === '2026-10-20');
  assert.equal(row[head.indexOf('F5')], 2);
  assert.equal(row[head.indexOf('最大')], 'F5');
  assert.equal(row[head.indexOf('両方の日')], '○');
  assert.equal(row[head.indexOf('餌')], 'ドジョウ（中）★');
  assert.equal(sh[1].rows[0][0].v, 'お豆日記 2026年まとめ（タチウオ）');
  const aji = seasonSheets(trips, 2026, 'aji');
  assert.equal(aji[0].rows.length, 3);
  assert.equal(seasonXlsx(trips, 2026, 'tachiuo')[0], 0x50);
});
