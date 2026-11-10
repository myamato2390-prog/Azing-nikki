// シーズンまとめ Excel の中身を組み立てる
import { TACKLE_FIELDS, TACHI_TACKLE_FIELDS, F_SIZES, formatClock, weekday, has, sortTrips, formatMoves, sideName, starText, formatHighs, formatLows, endsNextDay, kindName, maxF } from './model.js';
import { summarize } from './stats.js';
import { buildXlsx } from './xlsx.js';

const n = (v) => (has(v) ? Number(v) : null);

// 共通の列（アジ・タチウオどちらも）
const HEAD_COLUMNS = [
  ['日付', 11, (t) => t.date],
  ['曜日', 5, (t) => weekday(t.date)],
  ['港', 12, (t) => t.river],
  ['側', 9, (t) => sideName(t.sea.side)],
  ['移動先', 20, (t) => formatMoves(t).join(' → ')],
  ['ひとこと', 24, (t) => t.title],
  ['開始', 7, (t) => t.startTime],
  ['終了', 8, (t) => (t.endTime ? (endsNextDay(t) ? '翌' : '') + t.endTime : '')],
  ['天気', 7, (t) => t.weather],
  ['釣り始めの気温(℃)', 10, (t) => n(t.sea.tempStart)],
  ['朝の気温(℃)', 10, (t) => n(t.tempMorning)],
  ['最高気温(℃)', 10, (t) => n(t.tempMax)],
  ['水温(℃)', 8, (t) => n(t.waterTemp)],
  ['風向', 6, (t) => t.sea.windDir],
  ['風速(m/s)', 9, (t) => n(t.sea.windSpeed)],
  ['最大風速(m/s)', 9, (t) => n(t.sea.windMax)],
  ['潮回り', 7, (t) => t.sea.tide.shiomawari],
  ['満潮', 20, (t) => formatHighs(t)],
  ['干潮', 20, (t) => formatLows(t)],
  ['常夜灯', 10, (t) => t.sea.light],
  ['両方の日', 8, (t) => (t.pairId ? '○' : '')],
];
const AJI_COLUMNS = [
  ['匹数', 6, (t) => n(t.count)],
  ['最大(cm)', 9, (t) => n(t.maxSize)],
  ['バラシ', 7, (t) => n(t.bare)],
  ['サイズ感', 12, (t) => t.sizeFeel],
  ['時合', 16, (t) => (t.jiai || []).join('、')],
  ['潮の動き', 16, (t) => (t.aji.tideStages || []).join('、')],
  ['ジグヘッド', 16, (t) => starText(t.aji.jigheads, 'jigheads')],
  ['ワーム', 28, (t) => starText(t.aji.worms, 'worms')],
  ['レンジ', 12, (t) => starText(t.aji.ranges, 'ranges')],
  ['誘い方', 18, (t) => starText(t.aji.actions, 'actions')],
  ['外道', 16, (t) => (t.aji.bycatch || []).join('、')],
  ...TACKLE_FIELDS.map(([k, label]) => [label, 14, (t) => t.aji.tackle?.[k]]),
];
const TACHI_COLUMNS = [
  ['匹数', 6, (t) => n(t.count)],
  ...F_SIZES.map((f) => [f, 7, (t) => n(t.tachiuo.sizes?.[f]) || null]),
  ['最大', 7, (t) => maxF(t.tachiuo.sizes)],
  ['バラシ', 7, (t) => n(t.bare)],
  ['最初のアタリ', 9, (t) => formatClock(t, t.tachiuo.firstHit)],
  ['時合', 16, (t) => (t.jiai || []).join('、')],
  ['潮の動き', 16, (t) => (t.tachiuo.tideStages || []).join('、')],
  ['仕掛け', 14, (t) => starText(t.tachiuo.rigs, 'rigs')],
  ['テンヤの重さ', 14, (t) => starText(t.tachiuo.tenya, 'tenya')],
  ['餌', 28, (t) => starText(t.tachiuo.baits, 'baits')],
  ['レンジ', 12, (t) => starText(t.tachiuo.ranges, 'ranges')],
  ['誘い方', 18, (t) => starText(t.tachiuo.actions, 'actions')],
  ...TACHI_TACKLE_FIELDS.map(([k, label]) => [label, 14, (t) => t.tachiuo.tackle?.[k]]),
];
const columnsFor = (kind) => [...HEAD_COLUMNS, ...(kind === 'tachiuo' ? TACHI_COLUMNS : AJI_COLUMNS), ['メモ', 40, (t) => t.memo]];

export function seasonSheets(trips, season, kind = 'aji') {
  const LIST_COLUMNS = columnsFor(kind);
  const list = sortTrips(trips.filter((t) => t.kind === kind));
  const unit = kind === 'tachiuo' ? '' : 'cm';
  const s = summarize(list);
  const head = (labels) => labels.map((v) => ({ v, s: 'head' }));

  const listRows = [head(LIST_COLUMNS.map((c) => c[0])), ...list.map((t) => LIST_COLUMNS.map((c) => c[2](t) ?? null))];

  const sum = [];
  sum.push([{ v: `お豆日記 ${season}年まとめ（${kindName(kind)}）`, s: 'title' }]);
  sum.push([]);
  const kv = [
    ['釣行回数', s.tripCount, '回'],
    ['総匹数', s.totalCount, '匹'],
    ['平均匹数', s.avgCount, '匹/回'],
    ['最大サイズ', s.maxSize, s.maxTrip ? `${unit}（${s.maxTrip.date} ${s.maxTrip.river}）` : unit],
    ['最多釣果', s.bestTrip ? Number(s.bestTrip.count) : null, s.bestTrip ? `匹（${s.bestTrip.date} ${s.bestTrip.river}）` : '匹'],
    ['総バラシ数', s.totalBare, '回'],
  ];
  for (const [k, v, u] of kv) sum.push([{ v: k, s: 'bold' }, v, u]);

  const block = (title, firstCol, rows, labelOf) => {
    sum.push([]);
    sum.push([{ v: title, s: 'bold' }]);
    sum.push(head([firstCol, '釣行回数', '総匹数', '平均匹数', kind === 'tachiuo' ? '最大' : '最大(cm)']));
    for (const r of rows) sum.push([labelOf(r), r.trips, r.count, r.avg, r.max]);
  };
  block('港別', '港', s.byRiver, (r) => r.river);
  block('側別', '側', s.bySide, (r) => r.label);
  block('月別', '月', s.byMonth, (r) => `${r.month}月`);
  block('潮回り別', '潮回り', s.byShio, (r) => r.shio);

  const stars = (title, rows) => {
    sum.push([]);
    sum.push([{ v: `★ ${title}`, s: 'bold' }]);
    sum.push(head([title, '★良かった', '使った']));
    for (const r of rows) sum.push([r.label, r.stars, r.used]);
    if (!rows.length) sum.push(['（記録なし）']);
  };
  if (kind === 'tachiuo') {
    sum.push([]);
    sum.push([{ v: 'サイズ別', s: 'bold' }]);
    sum.push(head(['サイズ', '匹数']));
    for (const r of s.bySize) sum.push([r.size, r.count]);
    stars('仕掛け', s.stars.rigs);
    stars('テンヤの重さ', s.stars.tenya);
    stars('餌', s.stars.baits);
  } else {
    stars('ジグヘッドの重さ', s.stars.jigheads);
    stars('ワーム', s.stars.worms);
  }
  stars('レンジ', s.stars.ranges);
  stars('誘い方', s.stars.actions);

  return [
    { name: '釣行一覧', rows: listRows, widths: LIST_COLUMNS.map((c) => c[1]), freeze: true },
    { name: '集計', rows: sum, widths: [24, 12, 12, 12, 12] },
  ];
}

export const seasonXlsx = (trips, season, kind = 'aji') => buildXlsx(seasonSheets(trips, season, kind));
