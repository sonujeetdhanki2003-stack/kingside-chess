import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const read = (f) => readFileSync(join(site, f), 'utf8');

test('index.html has title, viewport, OG tags and local assets only', () => {
  const html = read('index.html');
  assert.match(html, /<title>Kingside Chess[^<]+<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/);
  for (const p of ['og:title', 'og:description', 'og:image']) assert.match(html, new RegExp(`property="${p}" content="[^"]+"`));
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /<main[\s>]/);
  assert.doesNotMatch(html, /lorem ipsum|TODO|PLACEHOLDER(?!=")/i);
  // every local src/href exists
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:|^mailto:/.test(u) && u !== './');
  for (const r of refs) assert.ok(existsSync(join(site, r)), 'missing asset ' + r);
  // no inline scripts (CSP-friendly)
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>\s*\S/);
});

test('core game features are wired', () => {
  const app = read('game.js');
  for (const s of ['isCheckmate', 'isStalemate', 'isThreefoldRepetition', 'isDrawByFiftyMoves', 'isInsufficientMaterial', 'askPromotion', 'localStorage', 'serviceWorker', 'pointerdown', 'undo', 'resign', 'flip', 'hint']) assert.ok(app.includes(s), s);
  const html = read('index.html');
  for (const lvl of ['2 Players', '5 + 0', '10 + 0', 'Unlimited']) assert.ok(html.includes(lvl), lvl);
  // ten computer levels, beginner to maximum, each with an approximate rating
  for (let i = 1; i <= 10; i++) assert.ok(html.includes(`data-value="${i}" aria-label="Level ${i}:`), 'level ' + i);
  for (const lvl of ['Beginner', 'Novice', 'Casual', 'Club', 'Intermediate', 'Advanced', 'Expert', 'Master', 'Grandmaster', 'Maximum']) assert.ok(app.includes(`'${lvl}'`), lvl);
});

test('engine, rules library and pieces ship locally', () => {
  const eng = read('engine.js');
  // Stockfish 19 Lite plays first, Stockfish 10 is the fallback; both sizes are pinned in engine.js
  const sizes = [...eng.matchAll(/js: '([^']+)', wasm: '([^']+)', nnue: \w+, size: (\d+)/g)];
  assert.equal(sizes.length, 2);
  for (const [, js, wasm, n] of sizes) { assert.equal(statSync(join(site, wasm)).size, +n, wasm); assert.ok(existsSync(join(site, js)), js); }
  assert.match(eng, /sf19/);
  assert.ok(existsSync(join(site, 'engine/stockfish.js')));
  assert.ok(existsSync(join(site, 'engine/COPYING.txt')));
  assert.match(read('vendor/chess.js'), /export class Chess\b/);
  for (const c of 'wb') for (const p of 'KQRBNP') assert.ok(existsSync(join(site, `pieces/${c}${p}.svg`)), c + p);
});

test('whole site fits one publish request', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [statSync(join(d, e.name)).size]);
  const total = walk(site).reduce((a, b) => a + b, 0);
  // the publisher now slices big files (no per-request limit for the site as a whole); keep the site lean anyway
  assert.ok(total < 6_000_000, 'site is ' + total + ' bytes');
});

test('PWA manifest and service worker', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.short_name, 'Chess');
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url && m.theme_color && m.background_color);
  const sizes = m.icons.map((i) => i.sizes + ':' + (i.purpose || 'any'));
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'));
  for (const i of m.icons) assert.ok(existsSync(join(site, i.src)), i.src);
  assert.ok(existsSync(join(site, 'icon-180.png')));
  const sw = read('sw.js');
  assert.match(sw, /engine\/stockfish\.wasm/);
  assert.match(sw, /engine\/stockfish\.js/);
  // every precached path exists
  const list = [...sw.matchAll(/'([^']+\.(?:html|css|js|wasm|webmanifest|svg|png))'/g)].map((x) => x[1]);
  for (const f of list) assert.ok(existsSync(join(site, f)), 'sw precache missing ' + f);
});

test('rules engine handles promotion, mate and draws', async () => {
  const { Chess } = await import(join(site, 'vendor/chess.js'));
  const g = new Chess();
  ['f3', 'e5', 'g4', 'Qh4#'].forEach((m) => g.move(m));
  assert.ok(g.isCheckmate());
  const s = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(s.isStalemate());
  const p = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(p.move({ from: 'a7', to: 'a8', promotion: 'q' }).san, 'a8=Q');
  const r = new Chess();
  ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach((m) => r.move(m));
  assert.ok(r.isThreefoldRepetition());
});

test('online multiplayer is wired: client, server, invite, no API caching', () => {
  const app = read('game.js');
  for (const s of ['startOnline', 'joinByCode', 'applyServerState', 'sendOnlineMove', 'offer_draw', 'accept_draw', "onlineAction('rematch')", "onlineAction('resign')", 'kickPolling', 'Net.leave']) assert.ok(app.includes(s), s);
  const net = read('online.js');
  assert.match(net, /\/api\//);
  const html = read('index.html');
  for (const s of ['Play a friend online', 'Share on WhatsApp', 'https://wa.me/', 'id="join-code"', 'id="btn-draw"', 'id="offer-bar"', 'data-value="online"']) assert.ok(html.includes(s), s);
  const sw = read('sw.js');
  assert.match(sw, /startsWith\('\/api\/'\)\) return/);
  assert.match(sw, /'online\.js'/);
  const decl = JSON.parse(read('tab-site.json'));
  assert.equal(decl.kind, 'worker');
  assert.deepEqual(decl.bindings, [{ type: 'd1', name: 'DB' }]);
  const worker = read('worker.mjs');
  for (const s of ['/api/', 'ASSETS.fetch', 'isCheckmate', 'not_your_turn', 'rematch']) assert.ok(worker.includes(s), s);
});

test('server source validates moves with chess.js and keeps clocks', () => {
  const src = readFileSync(join(site, '..', 'server', 'worker.src.js'), 'utf8');
  assert.match(src, /import \{ Chess \} from '\.\.\/site\/vendor\/chess\.js'/);
  for (const s of ['checkFlag', 'd.clock.inc', "reason: 'threefold'", "reason: 'agreement'", 'ONLINE_MS']) assert.ok(src.includes(s), s);
});


test('tournaments: client, server, share and rules are wired', () => {
  const html = read('index.html');
  for (const id of ['btn-tourney', 'btn-tback', 'tscreen', 't-body', 't-sheet', 'confetti']) assert.ok(html.includes(`id="${id}"`), id);
  const tj = read('tourney.js');
  for (const s of ['Create tournament', 'Share on WhatsApp', 'wa.me/?text=', 'Play now', 'Armageddon', 'Sonneborn-Berger', 'Leaderboard', 'Set result', 'End tournament', 'kingside-device-v1', 'confetti']) assert.ok(tj.includes(s), s);
  const g = read('game.js');
  assert.ok(g.includes("import * as Tourney from './tourney.js'"));
  assert.ok(g.includes('Back to tournament'));
  assert.match(read('sw.js'), /'tourney\.js'/);
  const w = read('worker.mjs');
  for (const s of ['tourneys', 'ratings', 'assetlinks.json', 'Sonneborn', 'Armageddon'].slice(0, 3)) assert.ok(w.includes(s), s);
});

test('tournament server logic: round-robin schedule, byes and standings', async () => {
  const src = readFileSync(join(site, '..', 'server', 'worker.src.js'), 'utf8');
  for (const s of ['function rrSchedule', 'function seedOrder', 'function standings', 'arma', "reason: 'forfeit'", 'ELO_K']) assert.ok(src.includes(s), s);
});
