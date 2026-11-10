// シーズンまとめ Excel の中身を組み立てる
import { TACKLE_FIELDS, weekday, has, sortTrips, formatMoves } from './model.js';
import { summarize } from './stats.js';
import { buildXlsx } from './xlsx.js';

const n = (v) => (has(v) ? Number(v) : null);

const LIST_COLUMNS = [
  ['日付', 11, (t) => t.date],
  ['曜日', 5, (t) => weekday(t.date)],
  ['河川', 9, (t) => t.river],
  ['ポイント', 18, (t) => t.point],
  ['移動先', 24, (t) => formatMoves(t).join(' → ')],
  ['ひとこと', 24, (t) => t.title],
  ['開始', 7, (t) => t.startTime],
  ['終了', 7, (t) => t.endTime],
  ['天気', 7, (t) => t.weather],
  ['朝の気温(℃)', 10, (t) => n(t.tempMorning)],
  ['最高気温(℃)', 10, (t) => n(t.tempMax)],
  ['水温(℃)', 8, (t) => n(t.waterTemp)],
  ['水位', 8, (t) => t.levelWord],
  ['水位(cm)', 9, (t) => n(t.levelCm)],
  ['観測所', 9, (t) => t.station],
  ['濁り', 7, (t) => t.clarity],
  ['垢', 7, (t) => t.aka],
  ['匹数', 6, (t) => n(t.count)],
  ['最大(cm)', 9, (t) => n(t.maxSize)],
  ['バラシ', 7, (t) => n(t.bare)],
  ['サイズ感', 10, (t) => t.sizeFeel],
  ['時合', 16, (t) => (t.jiai || []).join('、')],
  ['釣れた場所', 16, (t) => (t.spots || []).join('、')],
  ['場所メモ', 16, (t) => t.spotsNote],
  ['釣り方', 18, (t) => (t.methods || []).join('、')],
  ...TACKLE_FIELDS.map(([k, label]) => [label, 14, (t) => t.tackle?.[k]]),
  ['メモ', 40, (t) => t.memo],
];

export function seasonSheets(trips, season) {
  const list = sortTrips(trips);
  const s = summarize(list);
  const head = (labels) => labels.map((v) => ({ v, s: 'head' }));

  const listRows = [head(LIST_COLUMNS.map((c) => c[0])), ...list.map((t) => LIST_COLUMNS.map((c) => c[2](t) ?? null))];

  const sum = [];
  sum.push([{ v: `鮎日記 ${season}シーズンまとめ`, s: 'title' }]);
  sum.push([]);
  const kv = [
    ['釣行回数', s.tripCount, '回'],
    ['総匹数', s.totalCount, '匹'],
    ['平均匹数', s.avgCount, '匹/回'],
    ['最大サイズ', s.maxSize, s.maxTrip ? `cm（${s.maxTrip.date} ${s.maxTrip.river}）` : 'cm'],
    ['最多釣果', s.bestTrip ? Number(s.bestTrip.count) : null, s.bestTrip ? `匹（${s.bestTrip.date} ${s.bestTrip.river}）` : '匹'],
    ['総バラシ数', s.totalBare, '匹'],
  ];
  for (const [k, v, u] of kv) sum.push([{ v: k, s: 'bold' }, v, u]);

  sum.push([]);
  sum.push([{ v: '河川別', s: 'bold' }]);
  sum.push(head(['河川', '釣行回数', '総匹数', '平均匹数', '最大(cm)']));
  for (const r of s.byRiver) sum.push([r.river, r.trips, r.count, r.avg, r.max]);

  sum.push([]);
  sum.push([{ v: '月別', s: 'bold' }]);
  sum.push(head(['月', '釣行回数', '総匹数', '平均匹数', '最大(cm)']));
  for (const r of s.byMonth) sum.push([`${r.month}月`, r.trips, r.count, r.avg, r.max]);

  sum.push([]);
  sum.push([{ v: '水位（数値）別', s: 'bold' }]);
  sum.push(head(['河川', '観測所', '水位', '釣行回数', '総匹数', '平均匹数', '最大(cm)']));
  for (const r of s.byLevel) sum.push([r.river, r.station, r.range, r.trips, r.count, r.avg, r.max]);
  if (!s.byLevel.length) sum.push(['（水位の数値が入力された釣行はありません）']);

  return [
    { name: '釣行一覧', rows: listRows, widths: LIST_COLUMNS.map((c) => c[1]), freeze: true },
    { name: '集計', rows: sum, widths: [16, 12, 12, 12, 12, 12, 12] },
  ];
}

export const seasonXlsx = (trips, season) => buildXlsx(seasonSheets(trips, season));
