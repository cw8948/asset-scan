// 오프라인 동작용 — 앱 파일만 캐시한다(스캔 기록은 다루지 않음). 파일을 고치면 VERSION 을 올릴 것.
// 화면(HTML)·앱 코드(js)는 네트워크 우선: 인터넷이 되면 한 번만 열어도 새 판이 뜨고, 안 되면 캐시로 연다.
// 라이브러리·그림은 캐시 우선(크고 거의 안 바뀜).
var VERSION = 'asset-pwa-v9';
var FILES = ['./', 'index.html', 'app.js', 'export.js', 'scanner.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'vendor/zxing-library.min.js', 'vendor/xlsx.full.min.js',
  'help.html', 'help/step1.jpg', 'help/step2.jpg', 'help/step3.jpg', 'help/step4.jpg',
  'help/step5.jpg', 'help/step6.jpg', 'help/step7.jpg', 'help/step8.jpg', 'help/qr.png'];

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

function networkFirst(req) {
  return fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var fresh = req.mode === 'navigate' || /\.(html|js|webmanifest)$/.test(url.pathname) && url.pathname.indexOf('/vendor/') < 0;
  if (fresh) { e.respondWith(networkFirst(req)); return; }
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
