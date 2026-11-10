// 過去の記録から「次の一手」を出す分析（DOMに依存しない）
import { num, has, sortTrips } from './model.js';
import { tripMax, sizeScore } from './stats.js';

const round1 = (n) => Math.round(n * 10) / 10;
const month = (t) => Number((t.date || '').slice(5, 7)) || null;
const done = (t) => has(t.count); // 釣行後まで入力済み
const minutes = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : null);

// 同じ港・同じ釣り物の成績。max はアジ＝cm、タチウオ＝'F5'
export function placeStats(trips, river, kind = 'aji') {
  if (!river) return null;
  const list = trips.filter((t) => done(t) && t.river === river && t.kind === kind);
  if (!list.length) return null;
  const counts = list.map((t) => num(t.count));
  const best = list.reduce((b, t) => (sizeScore(t) > (b ? sizeScore(b) : 0) ? t : b), null);
  return {
    trips: list.length,
    avg: round1(counts.reduce((a, b) => a + b, 0) / list.length),
    best: Math.max(...counts),
    max: best ? tripMax(best) : null,
  };
}

// 条件の近さを点数化する。理由も一緒に返す
export function similarity(t, cond) {
  let score = 0;
  const why = [];
  const a = t.sea || {}, c = cond.sea || {};
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

// 作戦ボード：同じ釣り物で、同じ港または同じ側の港の、条件が近い過去の釣行
export function similarTrips(trips, cond, excludeId, n = 3) {
  if (!cond.river) return [];
  const side = cond.sea?.side, kind = cond.kind || 'aji';
  return trips
    .filter((t) => t.id !== excludeId && t.pairId !== (cond.pairId || null) && done(t) && t.kind === kind && (t.river === cond.river || (side && t.sea?.side === side)))
    .map((t) => ({ trip: t, ...similarity(t, cond) }))
    .sort((a, b) => b.score - a.score || num(b.trip.count) - num(a.trip.count) || (b.trip.date || '').localeCompare(a.trip.date || ''))
    .slice(0, n);
}

// 自己ベスト（excludeId の釣行を除く）。釣り物ごと。同じ値なら先に出した方が記録保持
export function personalBests(trips, excludeId, kind = 'aji') {
  let size = null, count = null;
  for (const t of sortTrips(trips)) {
    if (t.id === excludeId || t.kind !== kind) continue;
    if (sizeScore(t) > 0 && (!size || sizeScore(t) > sizeScore(size))) size = t;
    if (has(t.count) && num(t.count) > 0 && (!count || num(t.count) > num(count.count))) count = t;
  }
  return {
    maxSize: size ? tripMax(size) : null, maxScore: size ? sizeScore(size) : null, maxSizeTrip: size,
    maxCount: count ? num(count.count) : null, maxCountTrip: count,
  };
}

// その釣行が持っている自己ベスト（カードの🏆用）
export function recordBadges(trips, t) {
  const b = personalBests(trips, null, t.kind);
  const out = [];
  if (b.maxSizeTrip && b.maxSizeTrip.id === t.id) out.push('自己最大');
  if (b.maxCountTrip && b.maxCountTrip.id === t.id) out.push('自己最多');
  return out;
}

// 編集前のベストと比べて更新したか
export function newRecords(before, trip) {
  const out = [];
  const unit = (v) => (trip.kind === 'tachiuo' ? v : `${v}cm`);
  if (sizeScore(trip) > 0 && before.maxScore !== null && sizeScore(trip) > before.maxScore) {
    out.push({ kind: '最大サイズ', value: unit(tripMax(trip)), prev: unit(before.maxSize) });
  }
  if (has(trip.count) && before.maxCount !== null && num(trip.count) > before.maxCount) {
    out.push({ kind: '最多匹数', value: `${trip.count}匹`, prev: `${before.maxCount}匹` });
  }
  return out;
}
