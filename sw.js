// 오프라인 동작용 — 앱 파일만 캐시한다(스캔 기록은 다루지 않음). 파일을 고치면 VERSION 을 올릴 것.
var VERSION = 'asset-pwa-v2';
var FILES = ['./', 'index.html', 'app.js', 'export.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'vendor/html5-qrcode.min.js', 'vendor/xlsx.full.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request); }));
});
