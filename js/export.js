// シーズンまとめ Excel の中身を組み立てる
import { TACKLE_FIELDS, weekday, has, sortTrips, formatMoves, sideName, starText, formatHighs, formatLows, endsNextDay } from './model.js';
import { summarize } from './stats.js';
import { buildXlsx } from './xlsx.js';

const n = (v) => (has(v) ? Number(v) : null);

const LIST_COLUMNS = [
  ['日付', 11, (t) => t.date],
  ['曜日', 5, (t) => weekday(t.date)],
  ['港', 12, (t) => t.river],
  ['側', 9, (t) => sideName(t.aji.side)],
  ['移動先', 20, (t) => formatMoves(t).join(' → ')],
  ['ひとこと', 24, (t) => t.title],
  ['開始', 7, (t) => t.startTime],
  ['終了', 8, (t) => (t.endTime ? (endsNextDay(t) ? '翌' : '') + t.endTime : '')],
  ['天気', 7, (t) => t.weather],
  ['釣り始めの気温(℃)', 10, (t) => n(t.aji.tempStart)],
  ['朝の気温(℃)', 10, (t) => n(t.tempMorning)],
  ['最高気温(℃)', 10, (t) => n(t.tempMax)],
  ['水温(℃)', 8, (t) => n(t.waterTemp)],
  ['風向', 6, (t) => t.aji.windDir],
  ['風速(m/s)', 9, (t) => n(t.aji.windSpeed)],
  ['最大風速(m/s)', 9, (t) => n(t.aji.windMax)],
  ['潮回り', 7, (t) => t.aji.tide.shiomawari],
  ['満潮', 20, (t) => formatHighs(t)],
  ['干潮', 20, (t) => formatLows(t)],
  ['常夜灯', 10, (t) => t.aji.light],
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
  ['メモ', 40, (t) => t.memo],
];

export function seasonSheets(trips, season) {
  const list = sortTrips(trips);
  const s = summarize(list);
  const head = (labels) => labels.map((v) => ({ v, s: 'head' }));

  const listRows = [head(LIST_COLUMNS.map((c) => c[0])), ...list.map((t) => LIST_COLUMNS.map((c) => c[2](t) ?? null))];

  const sum = [];
  sum.push([{ v: `アジ日記 ${season}年まとめ`, s: 'title' }]);
  sum.push([]);
  const kv = [
    ['釣行回数', s.tripCount, '回'],
    ['総匹数', s.totalCount, '匹'],
    ['平均匹数', s.avgCount, '匹/回'],
    ['最大サイズ', s.maxSize, s.maxTrip ? `cm（${s.maxTrip.date} ${s.maxTrip.river}）` : 'cm'],
    ['最多釣果', s.bestTrip ? Number(s.bestTrip.count) : null, s.bestTrip ? `匹（${s.bestTrip.date} ${s.bestTrip.river}）` : '匹'],
    ['総バラシ数', s.totalBare, '回'],
  ];
  for (const [k, v, u] of kv) sum.push([{ v: k, s: 'bold' }, v, u]);

  const block = (title, firstCol, rows, labelOf) => {
    sum.push([]);
    sum.push([{ v: title, s: 'bold' }]);
    sum.push(head([firstCol, '釣行回数', '総匹数', '平均匹数', '最大(cm)']));
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
  stars('ジグヘッドの重さ', s.stars.jigheads);
  stars('ワーム', s.stars.worms);
  stars('レンジ', s.stars.ranges);
  stars('誘い方', s.stars.actions);

  return [
    { name: '釣行一覧', rows: listRows, widths: LIST_COLUMNS.map((c) => c[1]), freeze: true },
    { name: '集計', rows: sum, widths: [24, 12, 12, 12, 12] },
  ];
}

export const seasonXlsx = (trips, season) => buildXlsx(seasonSheets(trips, season));
