// 潮の計算を気象庁の潮位表と見比べる
// tests/data/*.txt は気象庁「潮位表」2026年1月分（https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/2026/MT.txt など）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tideEvents, tideHeight, tideForTrip, jstToMs, doodsonSpeed, STATIONS } from '../js/tide.js';

// 気象庁の潮位表（1日1行）：1〜72桁目＝毎時の潮位、73〜78＝年月日、81〜108＝満潮、109〜136＝干潮（時刻4桁＋潮位3桁）
function readJma(st) {
  return readFileSync(new URL(`./data/${st}_2026_01.txt`, import.meta.url), 'utf8').split('\n').filter((l) => l.length > 70).map((l) => {
    const date = `20${l.slice(72, 74)}-${l.slice(74, 76).trim().padStart(2, '0')}-${l.slice(76, 78).trim().padStart(2, '0')}`;
    const hourly = [...Array(24).keys()].map((h) => Number(l.slice(h * 3, h * 3 + 3)));
    const ev = [];
    for (const [type, base] of [['high', 80], ['low', 108]]) for (let k = 0; k < 4; k++) {
      const s = l.slice(base + k * 7, base + k * 7 + 7);
      if (!s.startsWith('9999')) ev.push({ type, h: Number(s.slice(0, 2)) + Number(s.slice(2, 4)) / 60, cm: Number(s.slice(4, 7)) });
    }
    return { date, hourly, ev };
  });
}

test('constituent speeds match the table', () => {
  // 気象庁の表の速度（度/時）と、天文引数から出した速度が合う
  assert.ok(Math.abs(doodsonSpeed('M2') - 28.9841042) < 1e-5);
  assert.ok(Math.abs(doodsonSpeed('K1') - 15.0410686) < 1e-5);
  assert.ok(Math.abs(doodsonSpeed('MSN2') - 30.5443747) < 1e-5);
  assert.equal(STATIONS.MT.consts.length, 60);
  assert.equal(STATIONS.UW.consts.length, 60);
});

for (const st of ['MT', 'UW']) {
  test(`${STATIONS[st].name}: hourly heights and high/low times match JMA`, () => {
    const days = readJma(st);
    let se = 0, n = 0;
    const dt = [];
    for (const d of days) {
      d.hourly.forEach((obs, h) => { se += (tideHeight(st, jstToMs(d.date, h)) - obs) ** 2; n++; });
      const mine = tideEvents(st, d.date, -2, 26);
      for (const e of d.ev) {
        const c = mine.filter((x) => x.type === e.type).sort((a, b) => Math.abs(a.h - e.h) - Math.abs(b.h - e.h))[0];
        assert.ok(c, `${d.date} ${e.type}`);
        dt.push(Math.abs(c.h - e.h) * 60);
        assert.ok(Math.abs(c.cm - e.cm) <= 8, `${d.date} ${e.type} ${c.cm} vs ${e.cm}`);
      }
    }
    const rms = Math.sqrt(se / n);
    dt.sort((a, b) => a - b);
    assert.ok(rms < 4, `rms ${rms}`);
    assert.ok(dt[Math.floor(dt.length * 0.9)] <= 10, `90% ${dt[Math.floor(dt.length * 0.9)]}min`);
    assert.ok(dt.at(-1) <= 45, `max ${dt.at(-1)}min`); // 潮止まりが長い日は山が平らで時刻がぶれやすい（めやすとして十分）
  });
}

test('tideForTrip: side picks the station, night window, offset', () => {
  // 2026-01-01 松山：満潮 07:39(313) 18:58(268)、干潮 00:37(20) 13:37(132)／翌日 満潮 08:34、干潮 01:24 ごろ
  const seto = tideForTrip('seto', '2026-01-01', '18:30');
  assert.equal(seto.station, '松山');
  assert.equal(seto.highs[0].nextDay, false);
  const near = (a, b, min) => Math.abs((+a.slice(0, 2) * 60 + +a.slice(3)) - (+b.slice(0, 2) * 60 + +b.slice(3))) <= min;
  assert.ok(near(seto.highs[0].time, '18:58', 10), seto.highs[0].time);
  assert.ok(seto.highs.some((h) => h.nextDay && near(h.time, '08:34', 10)), JSON.stringify(seto.highs));
  assert.ok(seto.lows.some((l) => l.nextDay), JSON.stringify(seto.lows));
  // 宇和海側は宇和島。同じ日でも時刻がちがう
  const uwa = tideForTrip('uwa', '2026-01-01', '18:30');
  assert.equal(uwa.station, '宇和島');
  assert.notEqual(uwa.highs[0].time, seto.highs[0].time);
  // 朝からの釣行は当日0〜24時
  const day = tideForTrip('seto', '2026-01-01', '05:00');
  assert.ok(day.highs.every((h) => !h.nextDay));
  assert.ok(near(day.highs[0].time, '07:39', 10), day.highs[0].time);
  // 港ごとの補正（+30分）
  const off = tideForTrip('seto', '2026-01-01', '18:30', 30);
  const m = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
  assert.equal(m(off.highs[0].time) - m(seto.highs[0].time), 30);
  assert.equal(tideForTrip('', '2026-01-01'), null);
  assert.equal(tideForTrip('seto', ''), null);
});
