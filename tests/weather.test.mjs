// 天気の自動入力：Open-Meteo に断られたとき（v0.6.1）
// tests/data/jma_forecast_380000.json は気象庁の愛媛県の予報（2026-11-14 23時ごろに取得）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWeather, parseJma, jmaArea, jmaWeatherWord, JMA_URL } from '../js/weather.js';

const jma = JSON.parse(readFileSync(new URL('./data/jma_forecast_380000.json', import.meta.url), 'utf8'));
const res = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('JMA forecast: area, weather, wind direction, temperatures', () => {
  assert.deepEqual(jmaArea(33.39, 132.12), { area: '南予', temp: '宇和島' }); // 三崎港
  assert.deepEqual(jmaArea(33.65, 132.59), { area: '中予', temp: '松山' }); // 下灘港
  assert.equal(jmaWeatherWord('101'), '晴れ');
  assert.equal(jmaWeatherWord('201'), '曇り');
  assert.equal(jmaWeatherWord('313'), '雨');
  // 三崎港・11月15日：南予は「雨 昼過ぎ から くもり…」、「南の風 後 北西の風…」、宇和島の気温
  const w = parseJma(jma, '2026-11-15', 33.39, 132.12);
  assert.equal(w.weather, '雨');
  assert.equal(w.windDir, '南');
  assert.equal(w.tempMax, 20);
  assert.equal(w.windSpeed, null);
  assert.equal(w.tempStart, null);
  // 下灘港は中予（松山）
  const s = parseJma(jma, '2026-11-15', 33.65, 132.59);
  assert.equal(s.windDir, '北');
  assert.equal(s.tempMax, 19);
  // 11月16日：南予は「晴れ 時々 くもり」、「北の風 やや強く 後 東の風」
  const t = parseJma(jma, '2026-11-16', 33.39, 132.12);
  assert.equal(t.weather, '晴れ');
  assert.equal(t.windDir, '北');
  assert.equal(t.tempMorning, 14);
  // 予報にない日は空
  assert.equal(parseJma(jma, '2026-12-01', 33.39, 132.12).weather, '');
});

test('fetchWeather: Open-Meteo limit → JMA, and clear reasons', async () => {
  const calls = [];
  const limited = async (url) => { calls.push(url); return url === JMA_URL ? res(200, jma) : res(429, { reason: 'Daily API request limit exceeded' }); };
  const w = await fetchWeather(33.39, 132.12, '2026-11-15', '18:30', '', limited, 1);
  assert.equal(w.source, 'jma');
  assert.equal(w.weather, '雨');
  assert.equal(calls.at(-1), JMA_URL);
  // 同じ問い合わせは1時間使い回す（問い合わせない）
  const n = calls.length;
  await fetchWeather(33.39, 132.12, '2026-11-15', '18:30', '', limited, 2);
  assert.equal(calls.length, n);
  // 気象庁の予報にない日で、Open-Meteo が混み合っている → limit
  await assert.rejects(fetchWeather(33.39, 132.12, '2026-12-20', '', '', limited, 3), (e) => e.reason === 'limit');
  // 日付が範囲外（Open-Meteo が 400）→ range
  const range = async (url) => (url === JMA_URL ? res(200, jma) : res(400));
  await assert.rejects(fetchWeather(33.39, 132.12, '2027-03-01', '', '', range, 4), (e) => e.reason === 'range');
  // 電波なし → offline
  const off = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchWeather(33.39, 132.12, '2026-11-20', '', '', off, 5), (e) => e.reason === 'offline');
});
