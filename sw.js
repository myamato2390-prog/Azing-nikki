// オフライン用キャッシュ。ファイルを変えたら VERSION を上げる
// テスト版（/preview/）は名前を分け、本番・テスト版・鮎日記のキャッシュを互いに消さない
const TEST = self.location.pathname.includes('/preview/');
const PREFIX = TEST ? 'aji-nikki-test-v' : 'aji-nikki-v';
const VERSION = `${PREFIX}0.4.1`;
// 共有されたファイルを、アプリが読むまで置いておく場所（版を上げても消さない）
const SHARE_CACHE = TEST ? 'aji-nikki-test-share' : 'aji-nikki-share';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/db.js', './js/model.js', './js/search.js', './js/stats.js',
  './js/xlsx.js', './js/export.js', './js/share.js', './js/insights.js', './js/weather.js', './js/tide.js', './js/cards.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// 自分の古い版のキャッシュだけを消す（同じ github.io の鮎日記などのキャッシュには触れない）
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Android の「共有」からお豆日記を選ぶと、ファイルが POST で届く（manifest の share_target）。
// ファイルを置いてから、アプリの「もらったカードを読み込む」画面（#/receive）を開く
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('cards').filter((f) => f && typeof f !== 'string');
    const cache = await caches.open(SHARE_CACHE);
    for (const k of await cache.keys()) await cache.delete(k);
    let i = 0;
    for (const f of files) {
      await cache.put(`./shared-file-${i++}`, new Response(f, { headers: { 'content-type': f.type || 'text/plain', 'x-file-name': encodeURIComponent(f.name || '') } }));
    }
    return Response.redirect(`./#/receive?n=${i}`, 303);
  } catch {
    return Response.redirect('./#/receive?n=0', 303);
  }
}

// 同じサイト内のファイルはキャッシュ優先、裏で更新
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
