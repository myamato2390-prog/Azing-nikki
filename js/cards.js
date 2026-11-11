// 仲間とカードのデータをやりとりする（DOMに依存しない）
// あげる：自分のカードを「カードのファイル」（JSON）にして LINE などで送る
// もらう：仲間のファイルを読み込み、trip.shared = { from, originId, receivedAt } を付けて自分の端末に入れる
import { APP_ID, normalizeTrip, uid } from './model.js';

export const CARD_PACK_TYPE = 'cards';

export const isShared = (t) => !!t?.shared?.from;
export const sharedFrom = (t) => t?.shared?.from || '';

// 送るファイルの中身。memo / photos は送る人が選ぶ
export function makeCardPack(trips, from, { memo = true, photos = false } = {}) {
  return {
    app: APP_ID,
    type: CARD_PACK_TYPE,
    version: 1,
    from: String(from || '').trim(),
    exportedAt: new Date().toISOString(),
    trips: trips.filter((t) => !isShared(t)).map((t) => {
      const c = JSON.parse(JSON.stringify(t));
      if (!memo) c.memo = '';
      if (!photos) c.photos = [];
      delete c.shared;
      return c;
    }),
  };
}

// 読み込んだファイルを調べる。だめなら理由（やさしい言葉）を返す
export function checkCardPack(data) {
  if (!data || typeof data !== 'object') return 'ファイルを読めませんでした';
  if (data.app === 'ayu-nikki') return 'これは鮎日記のファイルです';
  if (data.app !== APP_ID) return 'お豆日記のファイルではないようです';
  if (data.type !== CARD_PACK_TYPE) return 'これはバックアップのファイルです。カードのファイルを選んでください';
  if (!String(data.from || '').trim()) return '送った人の名前が入っていないファイルです';
  if (!Array.isArray(data.trips)) return 'カードが入っていないファイルです';
  return '';
}

// もらったカードを、自分の端末に入れる形にする。
// 同じ人の同じカードをもう一度もらったら、新しい方で置き換える（増えない）。
// 「両方」の日の組の印（pairId）は、自分の組と混ざらないよう送った人の名前を付けて分ける
// → { from, add: [新しく入れる], update: [置き換える], same: 変わらない件数 }
export function importCardPack(data, existing, now = new Date().toISOString()) {
  const from = String(data.from).trim();
  const mine = new Map(existing.filter((t) => sharedFrom(t) === from).map((t) => [t.shared.originId, t]));
  const add = [], update = [];
  let same = 0;
  for (const raw of data.trips) {
    if (!raw || !raw.id) continue;
    const old = mine.get(raw.id);
    if (old && (raw.updatedAt || '') <= (old.updatedAt || '')) { same++; continue; }
    const t = normalizeTrip({
      ...raw,
      id: old ? old.id : `sh-${uid()}`,
      pairId: raw.pairId ? `${from}:${raw.pairId}` : '',
    });
    t.shared = { from, originId: raw.id, receivedAt: now, use: old ? old.shared.use !== false : true };
    (old ? update : add).push(t);
  }
  return { from, add, update, same };
}

// 仲間ごとの件数 → [{ name, count }]（多い順）
export function friendsOf(trips) {
  const m = new Map();
  for (const t of trips) if (isShared(t)) m.set(sharedFrom(t), (m.get(sharedFrom(t)) || 0) + 1);
  return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

// 分析（まとめ・作戦ボード・港の過去成績）に使うカード。
// opts.useShared：仲間のカードを入れるか、opts.friends：{ 名前: { use: false } } で人ごとに外せる
export function analysisTrips(trips, opts = {}) {
  return trips.filter((t) => {
    if (!isShared(t)) return true;
    if (!opts.useShared) return false;
    if (opts.friends?.[sharedFrom(t)]?.use === false) return false;
    return t.shared.use !== false;
  });
}

// 自分のカードだけ（自己ベスト・🏆・入力の候補など）
export const ownTrips = (trips) => trips.filter((t) => !isShared(t));
