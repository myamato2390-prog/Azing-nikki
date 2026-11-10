import { num, has, tripCost, seasonOf } from './model.js';

export function seasons(trips) {
  return [...new Set(trips.map(seasonOf).filter(Boolean))].sort((a, b) => b - a);
}

const round1 = (n) => Math.round(n * 10) / 10;

function group(trips, keyFn) {
  const m = new Map();
  for (const t of trips) {
    const k = keyFn(t);
    if (k === null || k === undefined || k === '') continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

function rowOf(list) {
  const count = list.reduce((s, t) => s + num(t.count), 0);
  const sizes = list.map((t) => t.maxSize).filter(has).map(Number);
  return {
    trips: list.length,
    count,
    avg: list.length ? round1(count / list.length) : 0,
    max: sizes.length ? Math.max(...sizes) : null,
  };
}

// 水位(cm)を10cm刻みに分ける。例: -15 → "-20〜-11cm"
export function levelBucket(cm) {
  const b = Math.floor(Number(cm) / 10) * 10;
  const f = (n) => (n > 0 ? `+${n}` : `${n}`);
  return { key: b, label: `${f(b)}〜${f(b + 9)}cm` };
}

export function summarize(trips) {
  const totalCount = trips.reduce((s, t) => s + num(t.count), 0);
  const totalBare = trips.reduce((s, t) => s + num(t.bare), 0);
  const totalCost = trips.reduce((s, t) => s + tripCost(t), 0);
  const withSize = trips.filter((t) => has(t.maxSize));
  const maxTrip = withSize.reduce((b, t) => (!b || Number(t.maxSize) > Number(b.maxSize) ? t : b), null);
  const bestTrip = trips.reduce((b, t) => (num(t.count) > num(b?.count) ? t : b), null);

  const byRiver = [...group(trips, (t) => t.river || '（河川未入力）')]
    .map(([river, list]) => ({ river, ...rowOf(list) }))
    .sort((a, b) => b.trips - a.trips);

  const byMonth = [...group(trips, (t) => Number((t.date || '').slice(5, 7)) || null)]
    .map(([month, list]) => ({ month, ...rowOf(list) }))
    .sort((a, b) => a.month - b.month);

  // 水位は観測所ごとに比較しないと意味がないので、河川＋観測所で分ける
  const byLevel = [];
  const byStation = group(trips.filter((t) => has(t.levelCm)), (t) => `${t.river || '?'}\u0000${t.station || ''}`);
  for (const [k, list] of byStation) {
    const [river, station] = k.split('\u0000');
    const buckets = group(list, (t) => levelBucket(t.levelCm).key);
    for (const [key, bl] of [...buckets].sort((a, b) => a[0] - b[0])) {
      byLevel.push({ river, station, range: levelBucket(key).label, ...rowOf(bl) });
    }
  }

  return {
    tripCount: trips.length,
    totalCount,
    avgCount: trips.length ? round1(totalCount / trips.length) : 0,
    maxSize: maxTrip ? Number(maxTrip.maxSize) : null,
    maxTrip,
    bestTrip: bestTrip && num(bestTrip.count) > 0 ? bestTrip : null,
    totalBare,
    totalCost,
    costPerFish: totalCount ? Math.round(totalCost / totalCount) : null,
    byRiver, byMonth, byLevel,
  };
}
