// オフライン用キャッシュ。ファイルを変えたら VERSION を上げる
// テスト版（/preview/）は名前を分け、本番・テスト版・鮎日記のキャッシュを互いに消さない
const TEST = self.location.pathname.includes('/preview/');
const PREFIX = TEST ? 'aji-nikki-test-v' : 'aji-nikki-v';
const VERSION = `${PREFIX}0.3.3`;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/db.js', './js/model.js', './js/search.js', './js/stats.js',
  './js/xlsx.js', './js/export.js', './js/share.js', './js/insights.js', './js/weather.js', './js/tide.js',
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

// 同じサイト内のファイルはキャッシュ優先、裏で更新
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
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
