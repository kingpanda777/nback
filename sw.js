/* sw.js — オフラインで使えるようにする。
   一式をキャッシュしておき、次からはネットワークが無くても起動できる。

   ファイルを更新したら VERSION を1つ上げること。
   ブラウザは sw.js の中身が変わったときだけ更新処理を始めるので、
   ここが同じままだと古いキャッシュが配られ続ける。 */
const VERSION = 'v9';
const CACHE = 'nback-' + VERSION;

// sw.js からの相対パス。GitHub Pages のサブディレクトリ配信でもそのまま効く。
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/core.js',
  'js/modalities.js',
  'js/runner.js',
  'js/paced.js',
  'js/storage.js',
  'js/history.js',
  'js/app.js',
  'manifest.webmanifest',
  // 第2段階の音声（audio-letter）。記号名がそのままファイル名。
  'audio/a.mp3',
  'audio/ka.mp3',
  'audio/shi.mp3',
  'audio/tsu.mp3',
  'audio/ne.mp3',
  'audio/ho.mp3',
  'audio/mu.mp3',
  'audio/ro.mp3',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache:'reload' で HTTP キャッシュを迂回する。
      // これをしないと、更新したはずのファイルが古いまま取り込まれることがある。
      return Promise.all(ASSETS.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error(url + ' が取れない');
          return cache.put(url, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // キャッシュがあれば即返し、裏で新しいものを取り込んでおく。
  // 更新は次に開いたときに反映される（課題の途中で差し替わらない）。
  e.respondWith(
    caches.match(req).then(function (cached) {
      const fromNetwork = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // オフライン。ページ遷移ならトップを返す。
        if (req.mode === 'navigate') return caches.match('./');
        return cached;
      });
      return cached || fromNetwork;
    })
  );
});
