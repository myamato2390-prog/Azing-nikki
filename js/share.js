// カードを画像（PNG）にしてLINEなどへ共有する
import {
  formatDate, formatWeather, formatDayTemps, formatWind, formatHighs, formatLows, formatTimeRange,
  has, formatMoves, THEME_COLOR, sideName, starText, tackleSummary, kindName, KIND_COLOR, formatSizes, maxF, block,
} from './model.js';

const W = 1080, PAD = 56;
const C = { bg: '#eef3f7', card: '#ffffff', main: '#1f6f9f', sub: '#5a6b7b', text: '#16263a', accent: '#f2c14e', line: '#dde6ee' };
const FONT = '"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans",sans-serif';

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function loadImage(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

// 描画を2回行う：1回目で高さを測り、2回目で実際に描く
function draw(ctx, t, photo, measureOnly, color) {
  let y = 0;
  const text = (s, x, size, color = C.text, weight = 400, align = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align;
    if (!measureOnly) ctx.fillText(s, x, y);
  };
  const section = (title) => {
    y += 34;
    if (!measureOnly) { ctx.fillStyle = C.line; ctx.fillRect(PAD, y, W - PAD * 2, 2); }
    y += 52; text(title, PAD, 30, color, 700); y += 14;
  };
  const row = (label, value) => {
    if (!value) return;
    ctx.font = `400 32px ${FONT}`;
    const lines = wrap(ctx, value, W - PAD * 2 - 230);
    y += 46; text(label, PAD, 30, C.sub);
    lines.forEach((l, i) => { if (i) y += 44; text(l, PAD + 230, 32); });
  };

  // ヘッダー帯（釣り物の色：アジ＝金、タチウオ＝銀）。左のふちに港の色
  const a = t.sea, b = block(t), tachi = t.kind === 'tachiuo';
  const ink = '#0f2a44';
  const moves = formatMoves(t);
  const headH = 250 + moves.length * 46 + (t.title ? 60 : 0);
  if (!measureOnly) {
    ctx.fillStyle = KIND_COLOR[t.kind] || KIND_COLOR.aji; ctx.fillRect(0, 0, W, headH);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 18, headH);
  }
  y = 86; text(`${formatDate(t.date)}　${kindName(t.kind)}`, PAD, 44, ink, 700);
  y += 74; text(t.river || '港未入力', PAD, 58, ink, 800);
  y += 56; text([sideName(a.side), formatTimeRange(t)].filter(Boolean).join('　'), PAD, 34, ink);
  for (const mv of moves) { y += 46; text(`→ ${mv}`, PAD, 30, ink); }
  if (t.title) { y += 60; text(`「${t.title}」`, PAD, 36, ink, 700); }
  y = headH;

  // 釣果
  y += 110;
  text(has(t.count) ? `${t.count}` : '-', PAD, 110, color, 800);
  ctx.font = `800 110px ${FONT}`;
  const cw = ctx.measureText(has(t.count) ? `${t.count}` : '-').width;
  text('匹', PAD + cw + 10, 44, color, 700);
  text(tachi ? (maxF(b.sizes) ? `最大 ${maxF(b.sizes)}` : '') : has(t.maxSize) ? `最大 ${t.maxSize}cm` : '', W - PAD, 48, C.text, 700, 'right');
  y += 54;
  const sub = [has(t.bare) ? `バラシ ${t.bare}` : '', tachi ? '' : t.sizeFeel].filter(Boolean).join('　');
  text(sub, W - PAD, 32, C.sub, 400, 'right');
  if (!measureOnly) { ctx.fillStyle = C.accent; ctx.fillRect(PAD, y + 10, 120, 8); }
  y += 10;
  if (tachi) row('サイズ', formatSizes(b.sizes));
  row('時合', [...(t.jiai || []), ...b.tideStages].join('・'));
  if (tachi) {
    row('仕掛け', [starText(b.rigs, 'rigs'), starText(b.tenya, 'tenya')].filter(Boolean).join('　'));
    row('餌', starText(b.baits, 'baits'));
  } else {
    row('ジグヘッド', starText(b.jigheads, 'jigheads'));
    row('ワーム', starText(b.worms, 'worms'));
  }
  row('レンジ・誘い', [starText(b.ranges, 'ranges'), starText(b.actions, 'actions')].filter(Boolean).join('　'));
  if (!tachi) row('外道', b.bycatch.join('・'));

  const tide = [a.tide.shiomawari, formatHighs(t) ? `満潮 ${formatHighs(t)}` : '', formatLows(t) ? `干潮 ${formatLows(t)}` : ''].filter(Boolean).join('　');
  const weather = [formatWeather(t), formatWind(t)].filter(Boolean).join('　');
  const temps = [formatDayTemps(t), has(t.waterTemp) ? `水温${t.waterTemp}℃` : ''].filter(Boolean).join('　');
  if (tide || weather || temps || a.light) {
    section('状況');
    row('潮', tide);
    row('天気・風', weather);
    row('気温', temps);
    row('常夜灯', a.light);
  }

  if (tackleSummary(b.tackle)) { section('タックル'); row('タックル', tackleSummary(b.tackle)); }

  if (t.memo) {
    section('メモ');
    ctx.font = `400 32px ${FONT}`;
    for (const l of wrap(ctx, t.memo, W - PAD * 2)) { y += 46; text(l, PAD, 32); }
  }

  if (photo) {
    y += 40;
    const pw = W - PAD * 2, ph = Math.round(pw * Math.min(photo.height / photo.width, 1.2));
    if (!measureOnly) {
      const scale = Math.max(pw / photo.width, ph / photo.height);
      const sw = pw / scale, sh = ph / scale;
      ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, PAD, y, pw, ph);
    }
    y += ph;
  }
  return y + PAD;
}

export async function renderCardImage(t, color = THEME_COLOR) {
  const photo = t.photos?.[0] ? await loadImage(t.photos[0].data) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  const h = draw(ctx, t, photo, true, color);
  canvas.height = h;
  ctx.fillStyle = C.card; ctx.fillRect(0, 0, W, h);
  draw(ctx, t, photo, false, color);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

// ---------- シーズンまとめ画像 ----------
// s: stats.summarize() の結果、colorOf: 河川名 → 色
export async function renderSeasonImage(year, s, colorOf, kind = 'aji') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  const h = drawSeason(ctx, year, s, colorOf, true, kind);
  canvas.height = h;
  drawSeason(ctx, year, s, colorOf, false, kind);
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

function drawSeason(ctx, year, s, colorOf, measureOnly, kind = 'aji') {
  const main = colorOf(s.byRiver[0]?.river);
  let y = 0;
  const text = (str, x, size, color = C.text, weight = 400, align = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align;
    if (!measureOnly) ctx.fillText(str, x, y);
  };
  if (!measureOnly) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, ctx.canvas.height);
    ctx.fillStyle = main; ctx.fillRect(0, 0, W, 210);
  }
  y = 92; text(`${year}年のまとめ`, PAD, 64, '#fff', 800);
  y = 160; text(`お豆日記 ${kindName(kind)}の記録`, PAD, 32, '#eaf3fa', 500);

  // 数字のマス（3列×2段）
  const tiles = [
    ['釣行', s.tripCount, '回'], ['総匹数', s.totalCount, '匹'], ['平均', s.avgCount, '匹/回'],
    ['最大', s.maxSize ?? '-', kind === 'tachiuo' ? '' : 'cm'], ['最多', s.bestTrip ? s.bestTrip.count : '-', '匹'], ['バラシ', s.totalBare, '回'],
  ];
  const tw = (W - PAD * 2 - 24 * 2) / 3, th = 170;
  tiles.forEach(([label, v, unit], i) => {
    const x = PAD + (i % 3) * (tw + 24), top = 250 + Math.floor(i / 3) * (th + 24);
    if (!measureOnly) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(x, top, tw, th, 22); ctx.fill(); }
    y = top + 48; text(label, x + tw / 2, 28, C.sub, 500, 'center');
    y = top + 118; text(String(v), x + tw / 2, 64, main, 800, 'center');
    y = top + 154; text(unit, x + tw / 2, 24, C.sub, 400, 'center');
  });
  y = 250 + th * 2 + 24 + 30;

  const bests = [];
  if (s.maxTrip) bests.push(`🏆 最大 ${s.maxSize}${kind === 'tachiuo' ? '' : 'cm'}　${formatDate(s.maxTrip.date)} ${s.maxTrip.river}`);
  if (s.bestTrip) bests.push(`🏆 最多 ${s.bestTrip.count}匹　${formatDate(s.bestTrip.date)} ${s.bestTrip.river}`);
  for (const b of bests) { y += 56; text(b, PAD, 32, C.text, 600); }

  // 横棒グラフ
  const bars = (title, rows, colorFn) => {
    if (!rows.length) return;
    y += 80; text(title, PAD, 34, C.text, 800);
    const maxV = Math.max(1, ...rows.map((r) => r.count));
    const labelW = 190, barMax = W - PAD * 2 - labelW - 120;
    for (const r of rows) {
      y += 62;
      text(r.label, PAD, 30, C.text, 600);
      const bw = Math.max(6, Math.round((r.count / maxV) * barMax));
      if (!measureOnly) { ctx.fillStyle = colorFn(r); ctx.beginPath(); ctx.roundRect(PAD + labelW, y - 30, bw, 38, 10); ctx.fill(); }
      text(`${r.count}匹`, PAD + labelW + bw + 14, 28, C.sub, 600);
    }
  };
  bars('港別の釣果', s.byRiver.map((r) => ({ label: r.river, count: r.count, river: r.river })), (r) => colorOf(r.river));
  bars('月別の釣果', s.byMonth.map((r) => ({ label: `${r.month}月`, count: r.count })), () => main);
  return y + PAD + 20;
}

export async function shareBlob(blob, name, text) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'downloaded';
}

export function shareText(t) {
  const L = [`【お豆日記】${formatDate(t.date)} ${kindName(t.kind)}`, t.river];
  if (t.title) L.push(`「${t.title}」`);
  const mx = t.kind === 'tachiuo' ? maxF(t.tachiuo.sizes) : has(t.maxSize) ? `${t.maxSize}cm` : '';
  L.push(`釣果 ${has(t.count) ? t.count : '-'}匹${mx ? ` / 最大${mx}` : ''}${has(t.bare) ? ` / バラシ${t.bare}` : ''}`);
  if (t.kind === 'tachiuo' && formatSizes(t.tachiuo.sizes)) L.push(formatSizes(t.tachiuo.sizes));
  if (t.sea.tide.shiomawari) L.push(t.sea.tide.shiomawari);
  return L.filter(Boolean).join('\n');
}

export async function shareTrip(t, color) {
  const blob = await renderCardImage(t, color);
  const file = new File([blob], `お豆日記_${t.date}_${kindName(t.kind)}_${t.river || ''}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: shareText(t) });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, file.name);
  return 'downloaded';
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
