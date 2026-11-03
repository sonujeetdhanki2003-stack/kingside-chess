// Kingside Chess service worker: app shell + Stockfish cached for offline play (online games need the network).
const VERSION = 'kingside-v20'; // v1.9.0
const SHELL = [
  './', 'game.css', 'ui.css', 'game.js', 'online.js', 'tourney.js', 'engine.js', 'sound.js', 'vendor/chess.js',
  'board.js', 'review.js', 'analysis.js', 'openings.js', 'puzzles.js', 'account.js', 'progress.js', 'i18n.js', 'learn.js', 'learn-data.js', 'bots.js', 'share.js', 'streak.js', 'vendor/gifenc.js', 'crowns.js', 'crowns-data.js', 'ranks.js',
  ...['chintu', 'meera', 'rocky', 'iyer', 'zara', 'vikram', 'natasha', 'titan'].map((b) => `bots/${b}.svg`), 'data/openings.json', 'data/puzzles/index.json',
  'engine/stockfish.js', 'engine/stockfish.wasm', 'engine/sf19/stockfish-19-lite-single.js', 'engine/sf19/stockfish-19-lite-single.wasm',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-maskable-512.png',
  ...['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map((p) => `pieces/${c}${p}.svg`)),
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // online play always talks to the live server
  if (url.pathname.startsWith('/g/')) return; // shared-game replay pages come from the server
  if (req.mode === 'navigate') {
    // network first so updates arrive; cached page when offline
    // ('./' not 'index.html': the host redirects /index.html to /, and a cached redirect can't answer a navigation)
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && !res.redirected && url.pathname === '/') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('./', copy)); }
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
// v1.7: tapping a streak reminder opens (or focuses) the game
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
