import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes } from '../js/sun.js';

// 基準の値：Python の astral 3.2 で計算（日本時間）
const cases = [
  ['面河川', 33.68, 133.03, '2026-07-12', '05:06:41', '19:20:04'],
  ['仁淀川', 33.53, 133.25, '2026-06-01', '04:58:23', '19:11:29'],
  ['東京（夏至）', 35.68, 139.77, '2026-06-21', '04:25:34', '18:59:44'],
  ['東京（冬至）', 35.68, 139.77, '2026-12-22', '06:47:18', '16:31:17'],
  ['久万川', 33.66, 132.90, '2026-09-15', '05:51:39', '18:15:20'],
];
const min = (hm) => { const [h, m, s = 0] = hm.split(':').map(Number); return h * 60 + m + s / 60; };

test('sunrise / sunset within 2 minutes of the reference', () => {
  for (const [name, lat, lon, date, rise, set] of cases) {
    const r = sunTimes(date, lat, lon);
    assert.match(r.sunrise, /^\d\d:\d\d$/);
    assert.ok(Math.abs(min(r.sunrise) - min(rise)) <= 2, `${name} 日の出 ${r.sunrise} vs ${rise}`);
    assert.ok(Math.abs(min(r.sunset) - min(set)) <= 2, `${name} 日の入り ${r.sunset} vs ${set}`);
  }
});

test('missing position or date gives empty', () => {
  assert.deepEqual(sunTimes('2026-07-12', null, 133), { sunrise: '', sunset: '' });
  assert.deepEqual(sunTimes('', 33, 133), { sunrise: '', sunset: '' });
  assert.deepEqual(sunTimes('2026-06-21', 80, 0, 0).sunrise, ''); // 白夜
});
