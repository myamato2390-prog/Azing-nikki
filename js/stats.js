import { num, has, seasonOf, sideName, starKey, starItem, starLabel, SHIOMAWARI } from './model.js';

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

// ★の多い順のランキング。type: 'jigheads' | 'worms' | 'ranges' | 'actions'
// → [{ label, stars: ★の回数, used: 使った回数（★を含む） }]
export function starRanking(trips, type) {
  const m = new Map();
  for (const t of trips) {
    for (const it of t.aji?.[type] || []) {
      const key = starKey(type, it);
      const r = m.get(key) || { label: starLabel(type, starItem(type, key)), stars: 0, used: 0 };
      r.used += 1;
      if (it.star) r.stars += 1;
      m.set(key, r);
    }
  }
  return [...m.values()].sort((a, b) => b.stars - a.stars || b.used - a.used || a.label.localeCompare(b.label, 'ja'));
}

export function summarize(trips) {
  const totalCount = trips.reduce((s, t) => s + num(t.count), 0);
  const totalBare = trips.reduce((s, t) => s + num(t.bare), 0);
  const withSize = trips.filter((t) => has(t.maxSize));
  const maxTrip = withSize.reduce((b, t) => (!b || Number(t.maxSize) > Number(b.maxSize) ? t : b), null);
  const bestTrip = trips.reduce((b, t) => (num(t.count) > num(b?.count) ? t : b), null);

  // 港別（鮎日記の河川別と同じ形。river＝港名）
  const byRiver = [...group(trips, (t) => t.river || '（港未入力）')]
    .map(([river, list]) => ({ river, ...rowOf(list) }))
    .sort((a, b) => b.trips - a.trips);

  const bySide = [...group(trips, (t) => t.aji?.side)]
    .map(([side, list]) => ({ side, label: sideName(side), ...rowOf(list) }))
    .sort((a, b) => b.trips - a.trips);

  const byMonth = [...group(trips, (t) => Number((t.date || '').slice(5, 7)) || null)]
    .map(([month, list]) => ({ month, ...rowOf(list) }))
    .sort((a, b) => a.month - b.month);

  const byShio = [...group(trips, (t) => t.aji?.tide?.shiomawari)]
    .map(([shio, list]) => ({ shio, ...rowOf(list) }))
    .sort((a, b) => SHIOMAWARI.indexOf(a.shio) - SHIOMAWARI.indexOf(b.shio));

  return {
    tripCount: trips.length,
    totalCount,
    avgCount: trips.length ? round1(totalCount / trips.length) : 0,
    maxSize: maxTrip ? Number(maxTrip.maxSize) : null,
    maxTrip,
    bestTrip: bestTrip && num(bestTrip.count) > 0 ? bestTrip : null,
    totalBare,
    byRiver, bySide, byMonth, byShio,
    stars: {
      jigheads: starRanking(trips, 'jigheads'),
      worms: starRanking(trips, 'worms'),
      ranges: starRanking(trips, 'ranges'),
      actions: starRanking(trips, 'actions'),
    },
  };
}
