// 仲間とのカードのやりとり（v0.4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip, normalizeTrip } from '../js/model.js';
import { makeCardPack, checkCardPack, importCardPack, friendsOf, analysisTrips, ownTrips, isShared } from '../js/cards.js';
import { filterTrips } from '../js/search.js';
import { summarize } from '../js/stats.js';
import { personalBests } from '../js/insights.js';

const mk = (o) => normalizeTrip({ ...newTrip(o.date, o.kind), ...o });
const taro = [
  mk({ id: 'a', date: '2026-10-01', river: '三崎港', count: 20, maxSize: 28, memo: '秘密の場所', photos: [{ id: 'p', data: 'data:...' }], updatedAt: '2026-10-02T00:00:00Z' }),
  mk({ id: 'b', date: '2026-10-05', kind: 'aji', pairId: 'X', river: '長浜港', count: 3, updatedAt: '2026-10-05T00:00:00Z' }),
  mk({ id: 'c', date: '2026-10-05', kind: 'tachiuo', pairId: 'X', river: '長浜港', count: 4, tachiuo: { sizes: { F4: 4 } }, updatedAt: '2026-10-05T00:00:00Z' }),
];
const me = [
  mk({ id: 'm1', date: '2026-10-03', river: '三崎港', count: 8, maxSize: 22, pairId: 'X' }), // 同じ pairId でも自分のものとは混ざらない
];

test('make & check a card pack', () => {
  const pack = makeCardPack(taro, ' たろう ', { memo: false, photos: false });
  assert.equal(pack.type, 'cards');
  assert.equal(pack.from, 'たろう');
  assert.equal(pack.trips.length, 3);
  assert.equal(pack.trips[0].memo, '');
  assert.deepEqual(pack.trips[0].photos, []);
  assert.equal(taro[0].memo, '秘密の場所'); // 元の記録は変えない
  assert.equal(makeCardPack(taro, 'たろう').trips[0].memo, '秘密の場所');
  assert.equal(checkCardPack(pack), '');
  assert.match(checkCardPack({ app: 'aji-nikki', trips: [] }), /バックアップ/);
  assert.match(checkCardPack({ app: 'ayu-nikki' }), /鮎日記/);
  assert.match(checkCardPack({ ...pack, from: '' }), /名前/);
  assert.match(checkCardPack(null), /読めません/);
});

test('import adds once, updates newer, keeps pairs apart', () => {
  const pack = makeCardPack(taro, 'たろう');
  const r1 = importCardPack(pack, me, '2026-11-11T00:00:00Z');
  assert.equal(r1.add.length, 3);
  assert.equal(r1.update.length, 0);
  assert.ok(r1.add.every((t) => isShared(t) && t.shared.from === 'たろう' && t.id.startsWith('sh-')));
  assert.deepEqual(r1.add.map((t) => t.shared.originId), ['a', 'b', 'c']);
  assert.equal(r1.add[1].pairId, 'たろう:X');
  assert.equal(r1.add[1].pairId, r1.add[2].pairId);
  assert.notEqual(r1.add[1].pairId, me[0].pairId);
  const all = [...me, ...r1.add];
  // 同じファイルをもう一度 → 増えない
  const r2 = importCardPack(pack, all);
  assert.equal(r2.add.length + r2.update.length, 0);
  assert.equal(r2.same, 3);
  // たろうさんがカードを直して送り直した → 置き換え（id はそのまま）
  const edited = makeCardPack([{ ...taro[0], count: 25, updatedAt: '2026-10-09T00:00:00Z' }], 'たろう');
  const r3 = importCardPack(edited, all);
  assert.equal(r3.update.length, 1);
  assert.equal(r3.update[0].id, r1.add[0].id);
  assert.equal(r3.update[0].count, 25);
  // 別の人の同じ id のカードは別のカード
  assert.equal(importCardPack(makeCardPack([taro[0]], 'はなこ'), all).add.length, 1);
  // もらったカードは送り直せない（自分のカードだけ送る）
  assert.equal(makeCardPack(all, 'わたし').trips.length, 1);
});

test('analysis can include or exclude friends', () => {
  const r = importCardPack(makeCardPack(taro, 'たろう'), me);
  const hana = importCardPack(makeCardPack([mk({ id: 'h', date: '2026-10-07', river: '三崎港', count: 1 })], 'はなこ'), me).add;
  const all = [...me, ...r.add, ...hana];
  assert.equal(analysisTrips(all, {}).length, 1);
  assert.equal(analysisTrips(all, { useShared: true }).length, 5);
  assert.equal(analysisTrips(all, { useShared: true, friends: { はなこ: { use: false } } }).length, 4);
  assert.deepEqual(friendsOf(all), [{ name: 'たろう', count: 3 }, { name: 'はなこ', count: 1 }]);
  assert.equal(ownTrips(all).length, 1);
  const s = summarize(analysisTrips(all, { useShared: true }).filter((t) => t.kind === 'aji'));
  assert.equal(s.tripCount, 4);
  assert.equal(s.maxSize, 28);
  // 自己ベストは自分のカードだけで決める
  assert.equal(personalBests(ownTrips(all), null, 'aji').maxSize, 22);
});

test('search: own cards by default, friends on request', () => {
  const all = [...me, ...importCardPack(makeCardPack(taro, 'たろう'), me).add];
  assert.equal(filterTrips(all, {}).length, 4); // 条件なしは全部（カード画面では別に自分だけにする）
  assert.equal(filterTrips(all, { who: 'me' }).length, 1);
  assert.equal(filterTrips(all, { who: 'friends' }).length, 3);
  assert.equal(filterTrips(all, { who: 'all', text: 'たろう' }).length, 3);
});

test('send as a link and read it back', async () => {
  const { packToLink, parseCardText } = await import('../js/cards.js');
  const many = Array.from({ length: 20 }, (_, i) => mk({ id: `t${i}`, date: '2026-10-01', river: '三崎港', count: i, memo: '常夜灯の明暗の境目で連発。風が強くなってからは1.0gで。' }));
  const pack = makeCardPack(many, 'たろう');
  const msg = await packToLink(pack, 'https://example.github.io/Azing-nikki/');
  assert.ok(msg.startsWith('🐟 お豆日記のカード（たろうさん・20枚）'));
  const link = msg.split('\n').pop();
  assert.ok(link.startsWith('https://example.github.io/Azing-nikki/?openExternalBrowser=1#c='));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(link.split('#c=')[1])); // リンクが途中で切れない文字だけ
  // そのままの JSON より、ずっと短い（LINE の1通に収まりやすい）
  assert.ok(msg.length < JSON.stringify(pack).length / 3, `${msg.length} vs ${JSON.stringify(pack).length}`);
  // リンクを押したとき（#c=…）
  const back = await parseCardText(new URL(link).hash);
  assert.equal(checkCardPack(back), '');
  assert.equal(back.trips.length, 20);
  assert.equal(back.from, 'たろう');
  // メッセージ全体を長押し→コピー→貼り付けでも読める
  assert.equal((await parseCardText(`転送: ${msg}\n既読`)).trips.length, 20);
  // v0.4.3 のテスト版の形（OMAME1:…）と、そのままの JSON も読める
  assert.equal((await parseCardText('OMAME1:' + link.split('#c=')[1])).trips.length, 20);
  assert.equal((await parseCardText(JSON.stringify(pack))).trips.length, 20);
  // 壊れた文字・関係ない文字は null
  assert.equal(await parseCardText('#c=abcdefghijklmnopqrstuvwxyz'), null);
  assert.equal(await parseCardText('#/settings'), null);
  assert.equal(await parseCardText('こんにちは'), null);
});

test('short link: store the cards, send only an id', async () => {
  const { uploadPack, downloadPack, shortLinkMessage, shareIdIn, newShareId, parseCardText } = await import('../js/cards.js');
  const cfg = { projectId: 'demo-proj', apiKey: 'KEY' };
  const pack = makeCardPack(taro, 'たろう');
  // 保管場所のまね
  const store = new Map();
  const calls = [];
  const fake = async (url, opt) => {
    calls.push([opt?.method || 'GET', url]);
    const u = new URL(url);
    if (opt?.method === 'POST') { store.set(u.searchParams.get('documentId'), JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    const doc = store.get(u.pathname.split('/').pop());
    return doc ? { ok: true, status: 200, json: async () => doc } : { ok: false, status: 404, json: async () => ({}) };
  };
  const now = Date.UTC(2026, 10, 12);
  const id = await uploadPack(pack, cfg, fake, now);
  assert.match(id, /^[A-Z2-9]{12}$/);
  assert.ok(calls[0][1].startsWith('https://firestore.googleapis.com/v1/projects/demo-proj/databases/(default)/documents/cards?documentId='));
  const doc = store.get(id);
  assert.deepEqual(Object.keys(doc.fields).sort(), ['d', 'exp']); // ルールで許す2つの項目だけ
  assert.equal(doc.fields.exp.timestampValue, '2026-12-12T00:00:00.000Z'); // 30日後
  // データベースに名前が付いているとき
  const named = [];
  await uploadPack(pack, { ...cfg, databaseId: 'omame-nikki' }, async (url) => { named.push(url); return { ok: true, status: 200, json: async () => ({}) }; });
  assert.ok(named[0].includes('/databases/omame-nikki/documents/cards?documentId='));
  // 短いリンク
  const msg = shortLinkMessage(pack, 'https://example.github.io/Azing-nikki/', id);
  const link = msg.split('\n').pop();
  assert.equal(link, `https://example.github.io/Azing-nikki/?openExternalBrowser=1#k=${id}`);
  assert.ok(link.length < 90);
  assert.equal(shareIdIn(new URL(link).hash), id);
  assert.equal(shareIdIn(`転送: ${msg}`), id);
  assert.equal(shareIdIn('#/settings'), '');
  assert.equal(shareIdIn('#c=H4sIAAAAAAAAA'), '');
  // 受け取る
  const back = await downloadPack(id, cfg, fake);
  assert.equal(checkCardPack(back), '');
  assert.equal(back.trips.length, 3);
  assert.equal(await downloadPack(newShareId(), cfg, fake), null); // 30日たって消えたリンク
  await assert.rejects(uploadPack(pack, cfg, async () => ({ ok: false, status: 403 })));
  await assert.rejects(downloadPack(id, cfg, async () => ({ ok: false, status: 500 })));
  // 短いリンクは parseCardText では読めない（保管場所から取る）
  assert.equal(await parseCardText(new URL(link).hash), null);
});
