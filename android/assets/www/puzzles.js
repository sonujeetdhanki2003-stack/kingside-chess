// Puzzles: a Daily Puzzle (the same for everyone each day, by India's date) and rated puzzle training.
// Puzzles come from the Lichess puzzle database (CC0): a curated few thousand, loaded in rating bands on demand.
import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import * as Progress from './progress.js';
import * as Crowns from './crowns.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'kingside-puzzles-v1';
const THEMES = { mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
  discoveredAttack: 'Discovered attack', sacrifice: 'Sacrifice', hangingPiece: 'Hanging piece', trappedPiece: 'Trapped piece',
  backRankMate: 'Back-rank mate', deflection: 'Deflection', attraction: 'Attraction', promotion: 'Promotion', quietMove: 'Quiet move',
  defensiveMove: 'Defensive move', doubleCheck: 'Double check', xRayAttack: 'X-ray', zugzwang: 'Zugzwang', smotheredMate: 'Smothered mate',
  enPassant: 'En passant', endgame: 'Endgame', opening: 'Opening', middlegame: 'Middlegame' };

let index = null; const chunks = {};
let board = null, opts = { toast: () => {}, sound: () => {}, onChange: () => {} };
let view = 'home';      // home | solve
let P = null;           // { id, fen, moves, rating, themes, daily, step, chess, failed, done, rated }
let busy = false;

/* ---------------- stats (Glicko-style rating) ---------------- */
const blank = () => ({ r: 1200, rd: 300, n: 0, won: 0, solved: [], hist: [], daily: {}, streak: 0, best: 1200 });
export function stats() { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return blank(); } }
function saveStats(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} opts.onChange(s); }
export function replaceStats(s) { if (s && typeof s.r === 'number') saveStats({ ...blank(), ...s }); }
// Glicko-1 update against a puzzle rated pr (puzzle deviation 80)
function glicko(r, rd, pr, score) {
  const q = Math.log(10) / 400, prd = 80;
  const g = 1 / Math.sqrt(1 + (3 * q * q * prd * prd) / (Math.PI * Math.PI));
  const E = 1 / (1 + 10 ** ((-g * (r - pr)) / 400));
  const d2 = 1 / (q * q * g * g * E * (1 - E));
  const nrd = Math.sqrt(1 / (1 / (rd * rd) + 1 / d2));
  const nr = r + q * nrd * nrd * g * (score - E);
  return { r: nr, rd: Math.max(60, nrd) };
}
const istDate = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);

/* ---------------- data ---------------- */
async function loadIndex() { if (!index) index = await fetch('data/puzzles/index.json').then((r) => r.json()); return index; }
async function loadChunk(i) {
  if (!chunks[i]) chunks[i] = await fetch('data/puzzles/' + index.chunks[i].f).then((r) => r.json());
  return chunks[i];
}
const toP = (x, daily) => ({ id: x[0], fen: x[1], moves: x[2].split(' '), rating: x[3], themes: x[4] ? x[4].split(' ') : [], daily });
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export async function dailyPuzzle(date = istDate()) {
  await loadIndex();
  const bands = [2, 3, 4]; // 1250–2000: a fair daily challenge
  const total = bands.reduce((a, b) => a + index.chunks[b].n, 0);
  let k = hash('kingside-daily-' + date) % total;
  for (const b of bands) { if (k < index.chunks[b].n) { const c = await loadChunk(b); return toP(c[k], date); } k -= index.chunks[b].n; }
}
async function nextRated() {
  await loadIndex();
  const s = stats();
  const target = s.r + (Math.random() * 160 - 60);
  let bi = index.chunks.findIndex((c) => target >= c.lo && target < c.hi); if (bi < 0) bi = target < 1000 ? 0 : index.chunks.length - 1;
  const seen = new Set(s.solved);
  for (const b of [bi, bi - 1, bi + 1, bi - 2, bi + 2]) {
    if (b < 0 || b >= index.chunks.length) continue;
    const c = await loadChunk(b);
    const pool = c.filter((x) => !seen.has(x[0])).sort((a, z) => Math.abs(a[3] - target) - Math.abs(z[3] - target)).slice(0, 25);
    if (pool.length) return toP(pool[Math.floor(Math.random() * pool.length)], null);
  }
  const c = await loadChunk(bi); return toP(c[Math.floor(Math.random() * c.length)], null);
}

/* ---------------- screen ---------------- */
export function setup(o) {
  opts = { ...opts, ...o };
  board = new Board($('p-board'), {
    movable: (color) => !!P && !P.done && !busy && color === P.color,
    dests: (sq) => P ? P.chess.moves({ square: sq, verbose: true }) : [],
    onMove: (from, to, mv) => userMove(from, to, mv),
  });
  $('p-back').onclick = () => { if (history.state && history.state.kview === 'puzzles') history.back(); else back(); };
  $('p-body').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); };
  $('p-actions').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); };
}
export const isOpen = () => !$('pscreen').hidden;
export function open(what) {
  $('pscreen').hidden = false; document.body.classList.add('p-open');
  try { history.pushState({ kview: 'puzzles' }, ''); } catch (e) {}
  if (what === 'daily') startDaily(); else if (what === 'rated') startRated(); else if (what === 'rush') rushIntro(); else go('home');
}
export function close() { stopRush(); $('pscreen').hidden = true; document.body.classList.remove('p-open'); P = null; opts.onClose && opts.onClose(); }
export function back() {
  if (!isOpen()) return false;
  if (view === 'solve' && R && R.running) { endRush('quit'); return true; }
  if (view === 'solve' || view === 'rush') { go('home'); return true; }
  close(); return true;
}
function go(v) {
  view = v;
  $('pscreen').classList.toggle('solving', v === 'solve');
  $('pscreen').classList.toggle('rushing', v === 'solve' && !!R && R.running);
  if (v !== 'solve') $('rush-bar').hidden = true;
  if (v === 'home') { stopRush(); P = null; renderHome(); }
  $('pscreen').scrollTop = 0;
}
async function act(a) {
  if (a === 'daily') startDaily();
  else if (a === 'rated' || a === 'next') startRated();
  else if (a === 'retry') retry();
  else if (a === 'hint') hint();
  else if (a === 'solution') showSolution();
  else if (a === 'home') go('home');
  else if (a === 'share') shareDaily();
  else if (a === 'rush') rushIntro();
  else if (a === 'rushgo') startRush();
  else if (a === 'rushend') endRush('quit');
  else if (a === 'lb-today' || a === 'lb-all') { lbTab = a.slice(3); renderLb(); }
}

function renderHome() {
  const s = stats();
  const today = istDate();
  const done = s.daily[today];
  const recent = s.hist.slice(-20).map((h) => `<i class="${h.ok ? 'ok' : 'bad'}" title="${h.ok ? 'Solved' : 'Missed'} · ${h.pr}"></i>`).join('');
  const pretty = new Date(today + 'T12:00:00Z').toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  $('p-title').textContent = 'Puzzles';
  $('p-rating').textContent = Math.round(s.r);
  $('p-solve').hidden = true; $('p-body').hidden = false;
  $('p-body').innerHTML = `
    <div class="p-card p-daily">
      <div class="p-dhead"><span class="p-cal"><b>${today.slice(8)}</b><small>${new Date(today + 'T12:00:00Z').toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short' })}</small></span>
      <div><h2>Daily Puzzle</h2><p>${esc(pretty)} · same puzzle for everyone today</p></div></div>
      ${done ? `<p class="p-done">${done === 'ok' ? '✅ Solved today' : '❌ Missed today'}${s.streak > 1 ? ` · 🔥 ${s.streak}-day streak` : ''}</p>` : (s.streak ? `<p class="p-done">🔥 ${s.streak}-day streak: keep it going</p>` : '')}
      <button type="button" class="btn btn-gold p-big" data-act="daily">${done ? 'See today’s puzzle' : 'Solve today’s puzzle'}</button>
    </div>
    <div class="p-card p-rushcard">
      <div class="p-rhead"><div><h2>⚡ Puzzle Rush</h2><p>Solve as many as you can in 3 minutes. They get harder as you go. 3 mistakes and you’re out.</p></div>
      <div class="p-rbig"><b>${rushBest() || '–'}</b><small>best</small></div></div>
      <button type="button" class="btn btn-gold p-big" data-act="rush">Play Puzzle Rush</button>
    </div>
    <div class="p-card">
      <div class="p-rhead"><div><h2>Rated puzzles</h2><p>Puzzles picked for your level. Solve them to raise your puzzle rating.</p></div>
      <div class="p-rbig"><b>${Math.round(s.r)}</b><small>rating</small></div></div>
      <button type="button" class="btn btn-review p-big" data-act="rated">Solve puzzles</button>
      <div class="p-stats"><span><b>${s.n}</b> tried</span><span><b>${s.n ? Math.round((s.won / s.n) * 100) : 0}%</b> solved</span><span><b>${Math.round(s.best)}</b> best</span></div>
      ${recent ? `<div class="p-recent" aria-label="Recent puzzles">${recent}</div>` : ''}
    </div>
    <p class="p-credit">Puzzles from the <a href="https://database.lichess.org/#puzzles" rel="noopener">Lichess puzzle database</a> (CC0).</p>`;
}

async function startDaily() {
  const p = await dailyPuzzle();
  begin(p, false);
}
async function startRated() { begin(await nextRated(), true); }
function begin(p, rated) {
  const s = stats();
  P = { ...p, step: 0, failed: false, done: false, rated, hinted: false };
  P.chess = new Chess(p.fen);
  P.color = P.chess.turn() === 'w' ? 'b' : 'w'; // the solver plays the side that answers the first move
  P.already = p.daily ? s.daily[p.daily] : null;
  go('solve');
  $('p-body').hidden = true; $('p-solve').hidden = false;
  $('p-title').textContent = R && R.running ? 'Puzzle Rush' : p.daily ? 'Daily Puzzle' : 'Rated puzzle';
  P.rush = !!(R && R.running);
  $('p-rating').textContent = Math.round(s.r);
  board.flip(P.color);
  board.clearUser();
  board.set(p.fen, { animate: false });
  board.setMarks({}); board.setBadge(null); board.setArrows([]);
  feedback('wait', `${P.color === 'w' ? 'White' : 'Black'} to move`, 'Watch the opponent’s move…');
  renderActions();
  busy = true;
  setTimeout(() => { if (P && P.id === p.id) { opponentMove(); busy = false; feedback('turn', `${P.color === 'w' ? 'White' : 'Black'} to move`, 'Find the best move!'); renderActions(); } }, P.rush ? 380 : 650);
}
function playUci(u) {
  const mv = P.chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
  board.set(P.chess.fen());
  let check = null;
  if (P.chess.inCheck()) for (const row of P.chess.board()) for (const pc of row) if (pc && pc.type === 'k' && pc.color === P.chess.turn()) check = pc.square;
  board.setMarks({ last: [mv.from, mv.to], check });
  opts.sound(mv, P.chess);
  return mv;
}
function opponentMove() { playUci(P.moves[P.step]); P.step++; }
function userMove(from, to, d) {
  if (!P || P.done || busy) return;
  const expected = P.moves[P.step];
  const uci = from + to + (d.promotion ? (expected && expected.slice(0, 4) === from + to ? expected[4] || 'q' : 'q') : '');
  const test = new Chess(P.chess.fen()); test.move({ from, to, promotion: uci[4] || undefined });
  const isLast = P.step === P.moves.length - 1;
  if (uci === expected || (isLast && test.isCheckmate())) {
    (P.mine = P.mine || []).push(uci); // v1.8: the moves you played, for the server's Daily Puzzle check
    playUci(uci); P.step++;
    board.setBadge({ sq: to, icon: '✓', color: '#7fb33f' });
    if (P.step >= P.moves.length) return solved();
    feedback('good', 'Best move!', 'Keep going…');
    busy = true;
    const mine = P;
    setTimeout(() => { if (P !== mine) return; opponentMove(); busy = false; board.setBadge(null); feedback('turn', 'Your move', 'Find the next best move.'); renderActions(); }, P.rush ? 300 : 520);
  } else {
    // wrong: show it, then take it back
    const mv = playUci(uci);
    board.setBadge({ sq: mv.to, icon: '✕', color: '#f03e2f' });
    busy = true;
    if (P.rush) { rushResult(false); return; }
    if (!P.failed) { P.failed = true; record(false); }
    feedback('bad', 'Incorrect', P.rated ? 'That costs rating points. Try again, or see the solution.' : 'Try again, or see the solution.');
    setTimeout(() => { if (!P) return; P.chess.undo(); board.set(P.chess.fen()); board.setBadge(null);
      const h = P.chess.history({ verbose: true }); const last = h[h.length - 1]; board.setMarks(last ? { last: [last.from, last.to] } : {}); busy = false; renderActions(); }, 800);
  }
}
function solved() {
  P.done = true;
  if (P.rush) { rushResult(true); return; }
  if (!P.failed) record(true);
  const s = stats();
  const delta = P.delta != null ? P.delta : 0;
  feedback('win', P.failed ? 'Solved' : 'Correct! 🎉', P.rated && !P.failed ? `Puzzle rating ${Math.round(s.r)} (${delta >= 0 ? '+' : ''}${delta})` : (P.daily && !P.failed ? 'Daily puzzle solved. See you tomorrow!' : 'Nice. Ready for the next one?'));
  opts.toast && P.daily && !P.failed && opts.confetti && opts.confetti();
  renderActions();
}
function record(ok) {
  if (P.recorded) return; P.recorded = true;
  const s = stats();
  if (P.daily) {
    if (!s.daily[P.daily]) {
      s.daily[P.daily] = ok ? 'ok' : 'miss';
      const y = istDate(Date.now() - 864e5);
      s.streak = ok ? ((s.daily[y] === 'ok' ? s.streak : 0) + 1) : 0;
      if (ok && P.daily === istDate()) { Progress.record('daily', { ok: true }); Crowns.dailySolved(P.daily, (P.mine || []).join(' ')); }
    }
  }
  if (P.rated && !P.hinted) {
    const before = s.r;
    const g = glicko(s.r, s.rd, P.rating, ok ? 1 : 0);
    s.r = g.r; s.rd = g.rd; s.n++; if (ok) s.won++;
    s.best = Math.max(s.best, s.r);
    P.delta = Math.round(s.r - before);
    s.hist.push({ id: P.id, pr: P.rating, ok, r: Math.round(s.r), t: Date.now() }); s.hist = s.hist.slice(-200);
    if (ok) setTimeout(() => Progress.record('puzzles', { won: s.won }), 0);
  }
  if (!s.solved.includes(P.id)) { s.solved.push(P.id); s.solved = s.solved.slice(-1500); }
  saveStats(s);
  $('p-rating').textContent = Math.round(s.r);
}
function hint() {
  if (!P || P.done) return;
  const u = P.moves[P.step];
  P.hinted = true;
  board.setMarks({ ...board.marks, cls: { [u.slice(0, 2)]: 'rc-great' } });
  feedback('turn', 'Hint', 'Move the highlighted piece.' + (P.rated && !P.failed ? ' (A hinted puzzle is not rated.)' : ''));
}
function showSolution() {
  if (!P || P.done) return;
  if (!P.failed) { P.failed = true; record(false); }
  busy = true;
  const stepOne = () => {
    if (!P) return;
    if (P.step >= P.moves.length) { busy = false; P.done = true; feedback('bad', 'Solution shown', 'Study it, then try another.'); renderActions(); return; }
    const u = P.moves[P.step]; playUci(u);
    if (P.step % 2 === 1) board.setArrows([{ from: u.slice(0, 2), to: u.slice(2, 4) }]);
    P.step++; setTimeout(stepOne, 700);
  };
  stepOne();
}
function retry() { if (P) begin({ id: P.id, fen: P.fen, moves: P.moves, rating: P.rating, themes: P.themes, daily: P.daily }, false); }
function feedback(kind, title, sub) {
  const themes = P && (P.done || P.failed) && P.themes.length ? `<div class="p-themes">${P.themes.filter((t) => THEMES[t]).slice(0, 4).map((t) => `<span>${THEMES[t]}</span>`).join('')}</div>` : '';
  const meta = P ? `<span class="p-meta">${P.daily ? '📅 ' + esc(P.daily) + ' · ' : ''}Puzzle rated ${P.rating}</span>` : '';
  $('p-feedback').className = 'p-feedback fb-' + kind;
  $('p-feedback').innerHTML = `<div class="p-ftitle"><span class="p-dot" style="background-image:url(pieces/${P ? P.color : 'w'}K.svg)"></span>${esc(title)}</div><div class="p-fsub">${esc(sub)}</div>${meta}${themes}`;
}
function renderActions() {
  if (!P) return;
  if (P.rush) { $('p-actions').innerHTML = '<button type="button" class="btn btn-ghost" data-act="rushend">End run</button>'; return; }
  let html = '';
  if (!P.done) html = `<button type="button" class="btn btn-ghost" data-act="hint">Hint</button><button type="button" class="btn btn-ghost" data-act="solution">Solution</button>`;
  else if (P.daily) html = `<button type="button" class="btn btn-ghost" data-act="retry">Retry</button><button type="button" class="btn btn-ghost" data-act="share">Share</button><button type="button" class="btn btn-review" data-act="rated">More puzzles</button>`;
  else html = `<button type="button" class="btn btn-ghost" data-act="retry">Retry</button><button type="button" class="btn btn-review" data-act="next">Next puzzle</button>`;
  $('p-actions').innerHTML = html;
}
function shareDaily() {
  const s = stats(); const d = istDate();
  const text = `${s.daily[d] === 'ok' ? 'I solved' : 'Try'} today’s Kingside Chess Daily Puzzle ♟️${s.streak > 1 ? ` (🔥 ${s.streak}-day streak)` : ''}: ${location.origin}/?puzzle=daily`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

/* ---------------- Puzzle Rush ---------------- */
// 3 minutes, puzzles rising in difficulty, 3 strikes ends it. Best score kept on this phone; scores go to a
// daily + all-time leaderboard (accounts by name, guests by this phone's id).
const RKEY = 'kingside-rush-v1', RUSH_MS = 180000;
let R = null, lbTab = 'today', lbData = null;
const rushStore = () => { try { return { best: 0, runs: 0, ...JSON.parse(localStorage.getItem(RKEY) || '{}') }; } catch (e) { return { best: 0, runs: 0 }; } };
export function rushBest() { return rushStore().best || 0; }
const session = () => { try { return JSON.parse(localStorage.getItem('kingside-session-v1') || 'null'); } catch (e) { return null; } };
const myName = () => { try { return (JSON.parse(localStorage.getItem('kingside-chess-prefs-v1') || '{}').name || '').slice(0, 20); } catch (e) { return ''; } };
async function rApi(path, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch('/api/r/' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'application/json' } : undefined, cache: 'no-store', signal: ctl.signal });
    const d = await res.json(); if (!res.ok || !d.ok) throw new Error(d.error || 'Server answered ' + res.status); return d;
  } finally { clearTimeout(t); }
}
function rushIntro() {
  stopRush(); P = null;
  view = 'rush'; $('pscreen').classList.remove('solving', 'rushing');
  $('p-title').textContent = 'Puzzle Rush';
  $('p-solve').hidden = true; $('p-body').hidden = false; $('rush-bar').hidden = true;
  const st = rushStore();
  $('p-body').innerHTML = `
    <div class="p-card rush-intro">
      <div class="rush-hero"><span class="rush-bolt">⚡</span><div><h2>Puzzle Rush</h2><p>Solve as many puzzles as you can in 3 minutes. They start easy and get harder. 3 mistakes and the run ends.</p></div></div>
      <div class="p-stats"><span><b>${st.best || 0}</b> your best</span><span><b>${st.runs || 0}</b> runs</span><span><b>3:00</b> clock</span></div>
      <button type="button" class="btn btn-gold p-big" data-act="rushgo">Start</button>
    </div>
    <div class="p-card"><div class="lb-tabs"><button type="button" data-act="lb-today" class="${lbTab === 'today' ? 'on' : ''}">Today</button><button type="button" data-act="lb-all" class="${lbTab === 'all' ? 'on' : ''}">All time</button></div><ol class="lb-list" id="rush-lb"><li class="a-muted">Loading…</li></ol></div>`;
  $('pscreen').scrollTop = 0;
  rApi('top?' + new URLSearchParams({ dev: Progress.deviceTok(), s: session() || '' })).then((d) => { lbData = d; renderLb(); }).catch(() => { const el = $('rush-lb'); if (el) el.innerHTML = '<li class="a-muted">The leaderboard needs an internet connection.</li>'; });
}
function renderLb() {
  document.querySelectorAll('.lb-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.act === 'lb-' + lbTab));
  const el = $('rush-lb'); if (!el || !lbData) return;
  const rows = lbData[lbTab] || [];
  el.innerHTML = rows.map((r) => `<li class="${r.you ? 'me' : ''}"><span class="lb-rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</span><span class="lb-name">${esc(r.name)}${r.you ? ' <small>(you)</small>' : ''}</span><b>${r.score}</b></li>`).join('')
    || `<li class="a-muted">${lbTab === 'today' ? 'No scores yet today. Be the first!' : 'No scores yet. Be the first!'}</li>`;
}
async function nextRush() {
  await loadIndex();
  const target = Math.min(2900, 450 + R.score * 55 + Math.random() * 60);
  let bi = index.chunks.findIndex((c) => target >= c.lo && target < c.hi); if (bi < 0) bi = index.chunks.length - 1;
  for (const b of [bi, bi + 1, bi - 1, bi + 2]) {
    if (b < 0 || b >= index.chunks.length) continue;
    const c = await loadChunk(b);
    // close to the target rating, short ones preferred while it is still easy, never the same puzzle twice in a run
    const pool = c.filter((x) => !R.used.has(x[0])).map((x) => [Math.abs(x[3] - target) + (x[2].split(' ').length > 4 && target < 1600 ? 120 : 0), x]).sort((a, z) => a[0] - z[0]).slice(0, 12);
    if (pool.length) { const x = pool[Math.floor(Math.random() * pool.length)][1]; R.used.add(x[0]); return toP(x, null); }
  }
  return null;
}
async function startRush() {
  stopRush();
  R = { running: true, score: 0, strikes: 0, end: Date.now() + RUSH_MS, used: new Set(), log: [] };
  $('rush-bar').hidden = false; renderRushBar();
  R.timer = setInterval(() => { if (!R || !R.running) return; renderRushBar(); if (Date.now() >= R.end) endRush('time'); }, 200);
  // warm the first bands so the next puzzles appear instantly
  loadIndex().then(() => { loadChunk(0); loadChunk(1); }).catch(() => {});
  await rushNext();
}
async function rushNext() {
  if (!R || !R.running) return;
  let p = null; try { p = await nextRush(); } catch (e) { p = null; }
  if (!R || !R.running) return;
  if (!p) { endRush('error'); return; }
  begin(p, false);
  $('rush-bar').hidden = false; $('pscreen').classList.add('rushing');
  // prefetch the band ahead
  const ahead = index.chunks.findIndex((c) => 450 + (R.score + 3) * 55 >= c.lo && 450 + (R.score + 3) * 55 < c.hi); if (ahead >= 0) loadChunk(ahead).catch(() => {});
}
function rushResult(ok) {
  if (!R || !R.running || !P) return;
  const p = P; P.done = true; busy = true;
  R.log.push({ id: p.id, r: p.rating, ok });
  if (ok) { R.score++; feedback('win', 'Correct!', `${R.score} solved`); }
  else { R.strikes++; feedback('bad', 'Strike ' + R.strikes, R.strikes >= 3 ? 'Three strikes.' : 'Next puzzle…'); try { navigator.vibrate && navigator.vibrate(60); } catch (e) {} }
  renderRushBar();
  setTimeout(() => { if (!R || !R.running || P !== p) return; if (R.strikes >= 3) endRush('strikes'); else rushNext(); }, ok ? 350 : 650);
}
function renderRushBar() {
  if (!R) return;
  const left = Math.max(0, R.end - Date.now());
  const sec = Math.ceil(left / 1000);
  $('rb-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('rb-time').classList.toggle('low', sec <= 20);
  $('rb-score').textContent = R.score;
  $('rb-strikes').innerHTML = [0, 1, 2].map((i) => `<i class="${i < R.strikes ? 'x' : ''}">${i < R.strikes ? '✕' : ''}</i>`).join('');
}
function stopRush() { if (R) { clearInterval(R.timer); R.running = false; } }
async function endRush(why) {
  if (!R || !R.running) return;
  stopRush();
  const score = R.score, st = rushStore(), best = score > (st.best || 0);
  st.runs = (st.runs || 0) + 1; if (best) st.best = score; st.last = { score, t: Date.now(), day: istDate() };
  try { localStorage.setItem(RKEY, JSON.stringify(st)); } catch (e) {}
  if (why !== 'quit' || score > 0) Progress.record('rush', { score });
  P = null; view = 'rush'; busy = false;
  $('pscreen').classList.remove('solving', 'rushing');
  $('rush-bar').hidden = true; $('p-solve').hidden = true; $('p-body').hidden = false;
  $('p-title').textContent = 'Puzzle Rush';
  const reason = { time: '⏱ Time’s up!', strikes: '✕✕✕ Three strikes', quit: 'Run ended', error: 'Run ended (no connection for more puzzles)' }[why] || 'Run over';
  $('p-body').innerHTML = `
    <div class="p-card rush-over">
      <p class="ro-why">${reason}</p>
      <div class="ro-score"><b>${score}</b><small>puzzle${score === 1 ? '' : 's'} solved</small></div>
      ${best && score ? '<p class="ro-best">🎉 New personal best!</p>' : `<p class="ro-sub">Your best: <b>${st.best || 0}</b></p>`}
      <div class="ro-log">${R.log.map((x) => `<i class="${x.ok ? 'ok' : 'bad'}" title="${x.r}">${x.ok ? '✓' : '✕'}</i>`).join('')}</div>
      <div class="p-actions"><button type="button" class="btn btn-ghost" data-act="home">Puzzles</button><button type="button" class="btn btn-gold" data-act="rushgo">Play again</button></div>
    </div>
    <div class="p-card"><div class="lb-tabs"><button type="button" data-act="lb-today" class="${lbTab === 'today' ? 'on' : ''}">Today</button><button type="button" data-act="lb-all" class="${lbTab === 'all' ? 'on' : ''}">All time</button></div><ol class="lb-list" id="rush-lb"><li class="a-muted">Loading…</li></ol></div>`;
  $('pscreen').scrollTop = 0;
  opts.onChange(stats());
  if (best && score >= 5 && opts.confetti) opts.confetti();
  const body = { dev: Progress.deviceTok(), s: session() || undefined, name: myName(), score };
  rApi(score > 0 ? 'submit' : 'top?' + new URLSearchParams({ dev: body.dev, s: body.s || '' }), score > 0 ? body : undefined)
    .then((d) => { lbData = d; renderLb(); }).catch(() => { const el = $('rush-lb'); if (el) el.innerHTML = '<li class="a-muted">Saved on this phone. The leaderboard needs an internet connection.</li>'; });
}

window.__kingsidePuzzles = { get P() { return P; }, get R() { return R; }, stats, dailyPuzzle, istDate, endRush, rushBest };
