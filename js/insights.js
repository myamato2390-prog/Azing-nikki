// 過去の記録から「次の一手」を出す分析（DOMに依存しない）
import { num, has, sortTrips } from './model.js';

const round1 = (n) => Math.round(n * 10) / 10;
const month = (t) => Number((t.date || '').slice(5, 7)) || null;
const done = (t) => has(t.count); // 釣行後まで入力済み

// 同じ河川・同じポイントの成績
export function pointStats(trips, river, point) {
  if (!river || !point) return null;
  const list = trips.filter((t) => done(t) && t.river === river && t.point === point);
  if (!list.length) return null;
  const counts = list.map((t) => num(t.count));
  const sizes = list.map((t) => t.maxSize).filter(has).map(Number);
  return {
    trips: list.length,
    avg: round1(counts.reduce((a, b) => a + b, 0) / list.length),
    best: Math.max(...counts),
    max: sizes.length ? Math.max(...sizes) : null,
  };
}

// 条件の近さを点数化する。理由も一緒に返す
export function similarity(t, cond) {
  let score = 0;
  const why = [];
  if (cond.point && t.point === cond.point) { score += 3; why.push('同じポイント'); }
  if (has(cond.levelCm) && has(t.levelCm) && (t.station || '') === (cond.station || '')) {
    const d = Math.abs(Number(t.levelCm) - Number(cond.levelCm));
    if (d <= 5) { score += 3; why.push('水位±5cm'); } else if (d <= 10) { score += 2; why.push('水位±10cm'); } else if (d <= 20) { score += 1; why.push('水位±20cm'); }
  } else if (cond.levelWord && t.levelWord === cond.levelWord) { score += 2; why.push(`水位${t.levelWord}`); }
  if (cond.clarity && t.clarity === cond.clarity) { score += 1; why.push(t.clarity); }
  if (cond.aka && t.aka === cond.aka) { score += 1; why.push(`垢${t.aka}`); }
  if (cond.date && month(t) === month(cond)) { score += 1; why.push(`${month(t)}月`); }
  return { score, why };
}

// 作戦ボード：同じ河川で条件が近い過去の釣行
export function similarTrips(trips, cond, excludeId, n = 3) {
  if (!cond.river) return [];
  return trips
    .filter((t) => t.id !== excludeId && done(t) && t.river === cond.river)
    .map((t) => ({ trip: t, ...similarity(t, cond) }))
    .sort((a, b) => b.score - a.score || num(b.trip.count) - num(a.trip.count) || (b.trip.date || '').localeCompare(a.trip.date || ''))
    .slice(0, n);
}

// 自己ベスト（excludeId の釣行を除く）。同じ値なら先に出した方が記録保持
export function personalBests(trips, excludeId) {
  let size = null, count = null;
  for (const t of sortTrips(trips)) {
    if (t.id === excludeId) continue;
    if (has(t.maxSize) && (!size || Number(t.maxSize) > Number(size.maxSize))) size = t;
    if (has(t.count) && num(t.count) > 0 && (!count || num(t.count) > num(count.count))) count = t;
  }
  return {
    maxSize: size ? Number(size.maxSize) : null, maxSizeTrip: size,
    maxCount: count ? num(count.count) : null, maxCountTrip: count,
  };
}

// その釣行が持っている自己ベスト（カードの🏆用）
export function recordBadges(trips, t) {
  const b = personalBests(trips, null);
  const out = [];
  if (b.maxSizeTrip && b.maxSizeTrip.id === t.id) out.push('自己最大');
  if (b.maxCountTrip && b.maxCountTrip.id === t.id) out.push('自己最多');
  return out;
}

// 編集前のベストと比べて更新したか
export function newRecords(before, trip) {
  const out = [];
  if (has(trip.maxSize) && before.maxSize !== null && Number(trip.maxSize) > before.maxSize) {
    out.push({ kind: '最大サイズ', value: `${trip.maxSize}cm`, prev: `${before.maxSize}cm` });
  }
  if (has(trip.count) && before.maxCount !== null && num(trip.count) > before.maxCount) {
    out.push({ kind: '最多匹数', value: `${trip.count}匹`, prev: `${before.maxCount}匹` });
  }
  return out;
}
