// アイコンPNGを作る： node tools/make-icons.mjs （Playwright が必要）
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
const shot = async (size, file, pad) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  // maskable は周りを切られてもよいよう、絵を少し小さくして中央に置く
  await p.setContent(`<body style="margin:0;background:#0f2a44;display:grid;place-items:center;height:100vh"><div style="width:${pad ? 100 : 100}%;height:100%">${pad ? svg.replace('<svg ', '<svg style="transform:scale(.8)" ') : svg}</div></body>`);
  await p.screenshot({ path: file });
  await p.close();
};
await shot(192, 'icons/icon-192.png', false);
await shot(512, 'icons/icon-512.png', false);
await shot(512, 'icons/icon-maskable-512.png', true);
await b.close();
