import { num, has, seasonOf, sideName, starKey, starItem, starLabel, SHIOMAWARI, block, maxF, fRank, F_SIZES } from './model.js';

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

// 最大サイズ：アジは cm（数）、タチウオは F表記（'F5'）。比べるときは sizeScore
export const tripMax = (t) => (t.kind === 'tachiuo' ? maxF(t.tachiuo?.sizes) || null : has(t.maxSize) ? Number(t.maxSize) : null);
export const sizeScore = (t) => (t.kind === 'tachiuo' ? fRank(maxF(t.tachiuo?.sizes)) : has(t.maxSize) ? Number(t.maxSize) : 0);

function rowOf(list) {
  const count = list.reduce((s, t) => s + num(t.count), 0);
  const best = list.reduce((b, t) => (sizeScore(t) > (b ? sizeScore(b) : 0) ? t : b), null);
  return {
    trips: list.length,
    count,
    avg: list.length ? round1(count / list.length) : 0,
    max: best ? tripMax(best) : null,
  };
}

// ★の多い順のランキング。type: 'jigheads' | 'worms' | 'ranges' | 'actions' | 'rigs' | 'tenya' | 'baits'
// → [{ label, stars: ★の回数, used: 使った回数（★を含む） }]
export function starRanking(trips, type) {
  const m = new Map();
  for (const t of trips) {
    for (const it of block(t)[type] || []) {
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
  const maxTrip = trips.reduce((b, t) => (sizeScore(t) > (b ? sizeScore(b) : 0) ? t : b), null);
  const bestTrip = trips.reduce((b, t) => (num(t.count) > num(b?.count) ? t : b), null);

  // 港別（鮎日記の河川別と同じ形。river＝港名）
  const byRiver = [...group(trips, (t) => t.river || '（港未入力）')]
    .map(([river, list]) => ({ river, ...rowOf(list) }))
    .sort((a, b) => b.trips - a.trips);

  const bySide = [...group(trips, (t) => t.sea?.side)]
    .map(([side, list]) => ({ side, label: sideName(side), ...rowOf(list) }))
    .sort((a, b) => b.trips - a.trips);

  const byMonth = [...group(trips, (t) => Number((t.date || '').slice(5, 7)) || null)]
    .map(([month, list]) => ({ month, ...rowOf(list) }))
    .sort((a, b) => a.month - b.month);

  const byShio = [...group(trips, (t) => t.sea?.tide?.shiomawari)]
    .map(([shio, list]) => ({ shio, ...rowOf(list) }))
    .sort((a, b) => SHIOMAWARI.indexOf(a.shio) - SHIOMAWARI.indexOf(b.shio));

  return {
    tripCount: trips.length,
    totalCount,
    avgCount: trips.length ? round1(totalCount / trips.length) : 0,
    maxSize: maxTrip ? tripMax(maxTrip) : null,
    maxTrip,
    bestTrip: bestTrip && num(bestTrip.count) > 0 ? bestTrip : null,
    totalBare,
    byRiver, bySide, byMonth, byShio,
    stars: Object.fromEntries(['jigheads', 'worms', 'rigs', 'tenya', 'baits', 'ranges', 'actions'].map((k) => [k, starRanking(trips, k)])),
    // タチウオ：サイズごとの合計匹数
    bySize: F_SIZES.map((f) => ({ size: f, count: trips.reduce((a, t) => a + (Number(t.tachiuo?.sizes?.[f]) || 0), 0) })).filter((r) => r.count),
  };
}
