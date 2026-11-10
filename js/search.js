import { TACKLE_FIELDS, seasonOf, num, has } from './model.js';

export function emptyQuery() {
  return { text: '', river: '', season: '', from: '', to: '', levelWord: '', clarity: '', aka: '', minCount: '' };
}

export function isEmptyQuery(q) {
  return !q || Object.values(q).every((v) => v === '' || v === null || v === undefined);
}

function haystack(t) {
  return [
    t.river, t.point, t.station, t.memo, t.title, t.spotsNote, t.otori?.shop, t.weather, t.sizeFeel,
    ...(t.moves || []).flatMap((m) => [m.river, m.point]), ...(t.methods || []),
    ...TACKLE_FIELDS.map(([k]) => t.tackle?.[k]),
    ...(t.spots || []), ...(t.jiai || []),
  ].filter(Boolean).join('\n').toLowerCase();
}

export function matchTrip(t, q) {
  if (isEmptyQuery(q)) return true;
  // 途中で移動した河川も対象にする
  if (q.river && t.river !== q.river && !(t.moves || []).some((m) => m.river === q.river)) return false;
  if (q.season && String(seasonOf(t)) !== String(q.season)) return false;
  if (q.from && (t.date || '') < q.from) return false;
  if (q.to && (t.date || '') > q.to) return false;
  if (q.levelWord && t.levelWord !== q.levelWord) return false;
  if (q.clarity && t.clarity !== q.clarity) return false;
  if (q.aka && t.aka !== q.aka) return false;
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
  if (q.season) p.push(`${q.season}シーズン`);
  if (q.river) p.push(q.river);
  if (q.from || q.to) p.push(`${q.from || ''}〜${q.to || ''}`);
  if (q.levelWord) p.push(q.levelWord);
  if (q.clarity) p.push(q.clarity);
  if (q.aka) p.push(`垢:${q.aka}`);
  if (has(q.minCount)) p.push(`${q.minCount}匹以上`);
  if (q.text) p.push(`「${q.text}」`);
  return p.join(' × ');
}
