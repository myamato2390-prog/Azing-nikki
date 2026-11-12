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

// ---------- リンクで送る・受け取る（LINE のメッセージ用） ----------
// カードの JSON を gzip で縮めて base64url にし、アプリのURLの「#c=」の後ろに付ける。
// 受け取った人はリンクを押すだけ。「#」より後ろはサーバーに送られないので、カードはどこにも保存されない
const toB64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// カード → 短い文字（gzip → base64url）
export async function packToCode(pack) {
  return toB64url(await pipe(new TextEncoder().encode(JSON.stringify(pack)), new CompressionStream('gzip')));
}
async function codeToPack(code) {
  const bytes = await pipe(fromB64url(code), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const head = (pack) => `🐟 お豆日記のカード（${pack.from}さん・${pack.trips.length}枚）\nリンクを押すと、お豆日記に読み込めます。\n`;

// カード → 送るメッセージ（カードを全部リンクに入れる長いリンク。保管場所がないとき用）。appUrl はアプリのURL（末尾は /）
// openExternalBrowser=1 は、LINE の中のブラウザではなく、いつものブラウザ（お豆日記）で開かせるための LINE の決まり
export async function packToLink(pack, appUrl) {
  return `${head(pack)}${appUrl}?openExternalBrowser=1#c=${await packToCode(pack)}`;
}

// ---------- 短いリンク：カードを保管場所（Firestore）に置き、リンクには番号だけを入れる ----------
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // まぎらわしい 0・O・1・I は使わない
export function newShareId(n = 12) {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((x) => ID_CHARS[x % ID_CHARS.length]).join('');
}
const docUrl = (cfg, id = '') => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.databaseId || '(default)'}/documents/cards${id ? `/${id}` : ''}`;
export const KEEP_DAYS = 30;

// カードを保管場所に置く → 番号。置けなければエラー
export async function uploadPack(pack, cfg, fetchFn = fetch, now = Date.now()) {
  const id = newShareId();
  const body = { fields: {
    d: { stringValue: await packToCode(pack) },
    exp: { timestampValue: new Date(now + KEEP_DAYS * 86400000).toISOString() }, // この日を過ぎたら消してよい
  } };
  const res = await fetchFn(`${docUrl(cfg)}?documentId=${id}&key=${cfg.apiKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return id;
}
// 番号 → カード。もう消えていたら null
export async function downloadPack(id, cfg, fetchFn = fetch) {
  const res = await fetchFn(`${docUrl(cfg, id)}?key=${cfg.apiKey}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`download ${res.status}`);
  const code = (await res.json())?.fields?.d?.stringValue;
  return code ? codeToPack(code) : null;
}
export const shortLinkMessage = (pack, appUrl, id) => `${head(pack)}${appUrl}?openExternalBrowser=1#k=${id}`;
// 文の中の短いリンクの番号（なければ ''）
export const shareIdIn = (text) => (String(text || '').match(/[#&]k=([A-Z2-9]{8,20})(?![A-Za-z0-9_-])/) || [])[1] || '';

// リンク・貼り付けた文字 → カードのデータ（読めなければ null）
// 「#c=…」のリンクでも、そのままの JSON でも読む。前後に余計な文があってもよい
export async function parseCardText(text) {
  const s = String(text || '');
  const m = s.match(/[#&]c=([A-Za-z0-9_-]{16,})/) || s.match(/OMAME1:([A-Za-z0-9_-]{16,})/);
  if (m) {
    try { return await codeToPack(m[1]); } catch { return null; }
  }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
