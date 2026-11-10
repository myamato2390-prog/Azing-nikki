import { seasonOf, num, has, starLabel, jigLabel, sideName, kindName, block, formatSizes } from './model.js';

const STAR_TYPES = ['jigheads', 'worms', 'ranges', 'actions', 'rigs', 'tenya', 'baits'];

export function emptyQuery() {
  return { text: '', kind: '', river: '', side: '', season: '', from: '', to: '', shiomawari: '', light: '', jig: '', minCount: '' };
}

export function isEmptyQuery(q) {
  return !q || Object.values(q).every((v) => v === '' || v === null || v === undefined);
}

function haystack(t) {
  const a = t.sea || {}, b = block(t);
  return [
    kindName(t.kind), t.river, t.memo, t.title, t.weather, t.sizeFeel, sideName(a.side), a.light, a.windDir, a.tide?.shiomawari,
    ...(t.moves || []).flatMap((m) => [m.river, m.point]),
    ...Object.values(b.tackle || {}),
    ...(t.jiai || []), ...(b.tideStages || []), ...(b.bycatch || []), formatSizes(b.sizes),
    ...STAR_TYPES.flatMap((k) => (b[k] || []).map((x) => starLabel(k, x))),
  ].filter(Boolean).join('\n').toLowerCase();
}

export function matchTrip(t, q) {
  if (isEmptyQuery(q)) return true;
  const a = t.sea || {}, b = block(t);
  if (q.kind && t.kind !== q.kind) return false;
  // 途中で移動した港も対象にする
  if (q.river && t.river !== q.river && !(t.moves || []).some((m) => m.river === q.river)) return false;
  if (q.side && a.side !== q.side) return false;
  if (q.season && String(seasonOf(t)) !== String(q.season)) return false;
  if (q.from && (t.date || '') < q.from) return false;
  if (q.to && (t.date || '') > q.to) return false;
  if (q.shiomawari && a.tide?.shiomawari !== q.shiomawari) return false;
  if (q.light && a.light !== q.light) return false;
  if (has(q.jig) && ![...(b.jigheads || []), ...(b.tenya || [])].some((j) => Number(j.g) === Number(q.jig))) return false;
  if (has(q.minCount) && num(t.count) < Number(q.minCount)) return false;
  if (q.text) {
    const h = haystack(t);
    // 空白区切りはAND検索
    const words = q.text.toLowerCase().split(/[\s　]+/).filter(Boolean);
    if (!words.every((w) => h.includes(w))) return false;
  }
  return true;
}

export const filterTrips = (trips, q) => trips.filter((t) => matchTrip(t, q));

export function describeQuery(q) {
  const p = [];
  if (q.kind) p.push(kindName(q.kind));
  if (q.season) p.push(`${q.season}年`);
  if (q.river) p.push(q.river);
  if (q.side) p.push(sideName(q.side));
  if (q.from || q.to) p.push(`${q.from || ''}〜${q.to || ''}`);
  if (q.shiomawari) p.push(q.shiomawari);
  if (q.light) p.push(`常夜灯:${q.light}`);
  if (has(q.jig)) p.push(jigLabel(q.jig));
  if (has(q.minCount)) p.push(`${q.minCount}匹以上`);
  if (q.text) p.push(`「${q.text}」`);
  return p.join(' × ');
}
