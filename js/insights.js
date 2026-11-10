// 過去の記録から「次の一手」を出す分析（DOMに依存しない）
import { num, has, sortTrips } from './model.js';

const round1 = (n) => Math.round(n * 10) / 10;
const month = (t) => Number((t.date || '').slice(5, 7)) || null;
const done = (t) => has(t.count); // 釣行後まで入力済み
const minutes = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null);

// 同じ港の成績
export function placeStats(trips, river) {
  if (!river) return null;
  const list = trips.filter((t) => done(t) && t.river === river);
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
  const a = t.aji || {}, c = cond.aji || {};
  if (cond.river && t.river === cond.river) { score += 3; why.push('同じ港'); }
  if (c.tide?.shiomawari && a.tide?.shiomawari === c.tide.shiomawari) { score += 2; why.push(a.tide.shiomawari); }
  if (c.light && a.light === c.light) { score += 1; why.push(`常夜灯${a.light}`); }
  if (c.windDir && a.windDir === c.windDir) { score += 1; why.push(`${a.windDir}の風`); }
  if (has(c.windSpeed) && has(a.windSpeed) && Math.abs(Number(a.windSpeed) - Number(c.windSpeed)) <= 2) { score += 1; why.push('風速が近い'); }
  const s1 = minutes(t.startTime), s2 = minutes(cond.startTime);
  if (s1 !== null && s2 !== null) {
    const d = Math.abs(s1 - s2);
    if (Math.min(d, 1440 - d) <= 60) { score += 1; why.push('同じ時間帯'); }
  }
  if (cond.date && month(t) === month(cond)) { score += 1; why.push(`${month(t)}月`); }
  return { score, why };
}

// 作戦ボード：同じ港、または同じ側の港で条件が近い過去の釣行
export function similarTrips(trips, cond, excludeId, n = 3) {
  if (!cond.river) return [];
  const side = cond.aji?.side;
  return trips
    .filter((t) => t.id !== excludeId && done(t) && (t.river === cond.river || (side && t.aji?.side === side)))
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
