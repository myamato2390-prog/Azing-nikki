// 潮の計算（電波不要・DOMに依存しない）
// いまは潮回り（大潮・中潮…）だけ。満潮・干潮の自動計算は手順6で足す

const rad = (d) => (d * Math.PI) / 180;
const norm = (d) => ((d % 360) + 360) % 360;

// 月と太陽の黄経の差（度）。date は 'YYYY-MM-DD'、日本時間の hour 時
export function moonElongation(date, hour = 12) {
  const [y, m, d] = date.split('-').map(Number);
  // 2000年1月1日12時（世界時）からの日数
  const days = (Date.UTC(y, m - 1, d, hour - 9) - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = rad(357.528 + 0.9856003 * days); // 太陽の平均近点角
  const sun = 280.460 + 0.9856474 * days + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
  const mp = rad(134.963 + 13.064993 * days); // 月の平均近点角
  const D = rad(297.850 + 12.190749 * days); // 月と太陽の平均の離れ
  const F = rad(93.272 + 13.229350 * days);
  const moon = 218.316 + 13.176396 * days
    + 6.289 * Math.sin(mp) - 1.274 * Math.sin(mp - 2 * D) + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * mp) - 0.186 * Math.sin(g) - 0.114 * Math.sin(2 * F);
  return norm(moon - sun);
}

// 月齢のめやす（0〜29.5）
export const moonAge = (date) => Math.round((moonElongation(date) / 360) * 29.53 * 10) / 10;

// 潮回り（気象庁と同じ、月と太陽の黄経差による区分）
export function shiomawari(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return '';
  const e = moonElongation(date);
  const half = e % 180; // 新月側と満月側で同じ並び
  // 348〜36 と 168〜216 が大潮
  if (half >= 168 || half < 36) return '大潮';
  if (half < 72) return '中潮';
  if (half < 108) return '小潮';
  if (half < 120) return '長潮';
  if (half < 132) return '若潮';
  return '中潮';
}
