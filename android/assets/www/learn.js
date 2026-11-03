// Learn: interactive lessons (basics, tactics, checkmate patterns, openings, endgames).
// The lessons live in learn-data.js. Each step explains an idea, then the learner makes the moves on the board:
// a wrong move is taken back with a gentle "try again", Hint highlights the piece (then the move), a correct move
// plays the opponent's scripted reply. "Play it out" steps run against Stockfish until the goal (mate, promote, catch).
// Progress: this phone (localStorage) plus the account's progress record (counters ln_<lesson>, synced by progress.js).
import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import { Engine, fallbackMove } from './engine.js';
import * as Progress from './progress.js';
import { CHAPTERS } from './learn-data.js';
import * as Crowns from './crowns.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'kingside-learn-v1';
const hi = () => !!(window.__i18n && window.__i18n.lang() === 'hi');
const tx = (pair) => (Array.isArray(pair) ? (hi() && pair[1] ? pair[1] : pair[0]) : String(pair || ''));
const ui = (s) => (window.__i18n ? window.__i18n.t(s) : s);   // UI strings: the i18n dictionary
export const LESSONS = CHAPTERS.flatMap((c) => c.lessons.map((l) => ({ ...l, chapter: c })));
const byId = (id) => LESSONS.find((l) => l.id === id);

let board = null, engine = null, opts = { sound: () => {}, toast: () => {}, confetti: null, onClose: () => {} };
let L = null, si = 0, S = null, view = 'home', gen = 0;

/* ---------------- progress ---------------- */
function store() { try { return { done: {}, last: null, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { done: {}, last: null }; } }
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
// lessons finished on another device come back through the account's progress counters
export function doneSet() {
  const s = store(); const c = Progress.load().c || {};
  const out = new Set(Object.keys(s.done));
  for (const l of LESSONS) if (c['ln_' + l.id]) out.add(l.id);
  return out;
}
function markDone(id) {
  const s = store(); const first = !s.done[id]; if (first) s.done[id] = Date.now(); save(s);
  if (first) Crowns.lessonDone(id); // v1.8: +10 Crowns the first time (the server pays each lesson once)
  Progress.setCounter('ln_' + id, 1);
  Progress.record('lesson', { id }); // v1.7: finishing a lesson keeps the daily streak
}
function setLast(id, step) { const s = store(); s.last = { id, step }; save(s); }
export function summary() {
  const d = doneSet(); const next = nextLesson();
  return { done: LESSONS.filter((l) => d.has(l.id)).length, total: LESSONS.length, next: next ? tx(next.title) : null };
}
function nextLesson() {
  const s = store(); const d = doneSet();
  if (s.last && byId(s.last.id) && !d.has(s.last.id)) return byId(s.last.id);
  return LESSONS.find((l) => !d.has(l.id)) || null;
}
function chapterPct(c, d) { return Math.round((c.lessons.filter((l) => d.has(l.id)).length / c.lessons.length) * 100); }

/* ---------------- screen ---------------- */
export function setup(o) {
  opts = { ...opts, ...o };
  board = new Board($('l-board'), {
    movable: (color) => !!S && !S.done && !S.busy && S.mode !== 'info' && color === S.me,
    dests: (sq) => (S ? dests(sq) : []),
    onMove: (from, to, d) => userMove(from, to, d),
  });
  $('l-back').onclick = () => { if (history.state && history.state.kview === 'learn') history.back(); else back(); };
  $('lscreen').addEventListener('click', (e) => { const b = e.target.closest('[data-lact]'); if (b) act(b.dataset.lact, b.dataset.id); });
  document.addEventListener('kingside-lang', () => { if (isOpen()) { if (view === 'home') renderHome(); else { renderText(); renderActions(); } } });
}
export const isOpen = () => !$('lscreen').hidden;
export function open(id) {
  $('lscreen').hidden = false; document.body.classList.add('l-open');
  try { history.pushState({ kview: 'learn' }, ''); } catch (e) {}
  if (id) startLesson(id); else go('home');
}
export function close() { stop(); $('lscreen').hidden = true; document.body.classList.remove('l-open'); L = null; S = null; opts.onClose && opts.onClose(); }
export function back() {
  if (!isOpen()) return false;
  if (view === 'lesson') { go('home'); return true; }
  close(); return true;
}
function stop() { gen++; if (engine) engine.cancel(); }
function go(v) {
  view = v; stop();
  $('lscreen').classList.toggle('solving', v === 'lesson');
  $('l-home').hidden = v !== 'home'; $('l-lesson').hidden = v !== 'lesson';
  if (v === 'home') { L = null; S = null; $('l-title').removeAttribute('data-i18n-skip'); $('l-title').textContent = 'Learn'; renderHome(); }
  $('lscreen').scrollTop = 0;
}
function act(a, id) {
  if (a === 'open') startLesson(id);
  else if (a === 'continue') { const n = nextLesson(); if (n) startLesson(n.id, store().last && store().last.id === n.id ? store().last.step : 0); }
  else if (a === 'hint') hint();
  else if (a === 'retry') startStep(si);
  else if (a === 'next') nextStep();
  else if (a === 'prev') { if (si > 0) startStep(si - 1); }
  else if (a === 'nextlesson') { const i = LESSONS.indexOf(L); const n = LESSONS[i + 1]; if (n) startLesson(n.id); else go('home'); }
  else if (a === 'home') go('home');
}

function renderHome() {
  const d = doneSet(); const n = nextLesson(); const total = LESSONS.length; const done = LESSONS.filter((l) => d.has(l.id)).length;
  $('l-chip').textContent = `${done}/${total}`;
  const cont = n ? `<button type="button" class="l-continue" data-lact="continue">
      <span class="lc-ic" aria-hidden="true">${esc(n.chapter.icon)}</span>
      <span class="lc-t"><small>${done ? 'Continue learning' : 'Start here'}</small><b data-i18n-skip>${esc(tx(n.title))}</b><span data-i18n-skip>${esc(tx(n.chapter.title))}</span></span>
      <span class="lc-go">${done ? 'Continue' : 'Start'}</span></button>`
    : `<div class="p-card l-alldone"><h2>🎓 All lessons done!</h2><p>You finished every lesson. Keep practising with puzzles and games.</p></div>`;
  $('l-home').innerHTML = `
    <div class="l-hero"><div><h2>Chess lessons</h2><p>Short lessons where you make the moves yourself.</p></div>
      <div class="l-ring" style="--p:${Math.round((done / total) * 100)}"><b>${Math.round((done / total) * 100)}%</b></div></div>
    ${cont}
    ${CHAPTERS.map((c) => { const pct = chapterPct(c, d); return `
    <section class="l-chap" aria-label="${esc(tx(c.title))}">
      <div class="l-chead"><span class="l-cic" aria-hidden="true">${esc(c.icon)}</span><div class="l-ctext"><h3 data-i18n-skip>${esc(tx(c.title))}</h3><p data-i18n-skip>${esc(tx(c.sub))}</p></div>
        <span class="l-pct">${pct}%</span></div>
      <div class="l-bar"><i style="width:${pct}%"></i></div>
      <div class="l-list">${c.lessons.map((l, i) => `<button type="button" class="l-row${d.has(l.id) ? ' done' : ''}" data-lact="open" data-id="${l.id}">
        <span class="l-num">${d.has(l.id) ? '✅' : i + 1}</span><span class="l-name" data-i18n-skip>${esc(tx(l.title))}</span><span class="l-steps-n">${l.steps.length} steps</span></button>`).join('')}</div>
    </section>`; }).join('')}
    <p class="p-credit">Every lesson move is checked with chess.js and Stockfish.</p>`;
}

/* ---------------- a lesson ---------------- */
function startLesson(id, step = 0) {
  L = byId(id); if (!L) return go('home');
  go('lesson');
  $('l-title').textContent = tx(L.title);
  $('l-title').setAttribute('data-i18n-skip', '');
  startStep(Math.min(step || 0, L.steps.length - 1));
}
// the position a step starts from (explicit, from moves, or where the previous step ended)
function stepStart(i) {
  const st = L.steps[i];
  if (st.fen) return new Chess(st.fen);
  if (st.from) { const c = new Chess(); for (const m of st.from.split(' ')) c.move(m); return c; }
  if (i === 0) return new Chess();
  const prev = stepStart(i - 1); const p = L.steps[i - 1];
  for (const m of p.pre || []) prev.move(m);
  const line = p.lines ? p.lines[0] : p.line;
  for (const m of line || []) prev.move(m);
  return new Chess(prev.fen());
}
function startStep(i) {
  stop(); const my = gen;
  si = i; const st = L.steps[i];
  setLast(L.id, i);
  board.setArrows([]); board.setBadge(null); board.clearUser();
  if (st.stars) {
    S = { mode: 'stars', st, sq: st.start, left: [...st.stars], me: 'w', moves: 0, done: false, busy: false };
    board.flip('w');
    paintStars();
  } else {
    const chess = stepStart(i);
    const lines = st.lines || (st.line && st.line.length ? [st.line] : null);
    const mode = st.goal ? 'goal' : lines || st.need ? 'line' : 'info';
    S = { mode, st, chess, lines, ply: 0, done: mode === 'info', busy: false, hints: 0, wrong: 0 };
    board.set(chess.fen(), { animate: false });
    board.setMarks(st.hl ? { cls: Object.fromEntries(st.hl.map((q) => [q, 'l-hl'])) } : {});
    if (st.arrows) board.setArrows(st.arrows.map(([from, to]) => ({ from, to })));
    const pre = st.pre || [];
    if (mode === 'goal') S.me = st.me || chess.turn();
    else if (mode === 'line' && pre.length) { const t = new Chess(chess.fen()); pre.forEach((m) => t.move(m)); S.me = t.turn(); }
    else S.me = chess.turn();
    board.flip(S.me);
    if (pre.length) {
      S.busy = true;
      let k = 0;
      const playPre = () => { if (my !== gen) return; if (k >= pre.length) { S.busy = false; feedback('turn', yourMove()); renderActions(); return; } play(pre[k++]); setTimeout(playPre, 650); };
      setTimeout(playPre, 700);
    }
    if (mode === 'goal') { ensureEngine(); if (chess.turn() !== S.me) { S.busy = true; setTimeout(() => engineReply(my), 500); } }
  }
  renderDots(); renderText();
  if (S.mode === 'info') feedback('info', 'Read, then tap Next');
  else if (S.mode === 'stars') feedback('turn', 'Collect all the stars', `${S.st.stars.length - S.left.length}/${S.st.stars.length} ⭐`);
  else if (S.mode === 'goal') feedback('turn', 'Goal: ' + tx(st.g), S.busy ? 'The computer moves first…' : yourMove());
  else if (!(st.pre || []).length) feedback('turn', yourMove());
  else feedback('wait', 'Watch the move…');
  renderActions();
}
const yourMove = () => (S && S.me === 'b' ? 'Your move (you are Black)' : 'Your move (you are White)');
function renderDots() {
  $('l-dots').innerHTML = L.steps.map((_, k) => `<i class="${k < si ? 'ok' : k === si ? 'on' : ''}"></i>`).join('') + `<span>Step ${si + 1} of ${L.steps.length}</span>`;
}
function renderText() {
  if (!L) return;
  const st = L.steps[si];
  $('l-text').innerHTML = `<p>${esc(tx(st.t))}</p>`;
  $('l-title').textContent = tx(L.title);
}
function feedback(kind, title, sub) {
  const t = esc(title);
  $('l-fb').className = 'p-feedback l-fb fb-' + kind;
  $('l-fb').innerHTML = `<div class="p-ftitle">${t}</div>${sub ? `<div class="p-fsub">${esc(sub)}</div>` : ''}`;
}
function renderActions() {
  if (!S) return;
  const last = si === L.steps.length - 1;
  let h = si > 0 ? `<button type="button" class="btn btn-ghost l-prev" data-lact="prev" aria-label="Previous step">‹</button>` : '';
  if (S.done) {
    if (last && S.mode !== 'info') h += `<button type="button" class="btn btn-review" data-lact="nextlesson">Next lesson</button>`;
    else if (last) h += `<button type="button" class="btn btn-review" data-lact="${S.lessonDone ? 'nextlesson' : 'next'}">${S.lessonDone ? 'Next lesson' : 'Finish'}</button>`;
    else h += `<button type="button" class="btn btn-review" data-lact="next">Next</button>`;
  } else {
    if (S.mode !== 'info') h += `<button type="button" class="btn btn-ghost" data-lact="hint">Hint</button><button type="button" class="btn btn-ghost" data-lact="retry">Restart</button>`;
  }
  $('l-actions').innerHTML = h;
}
function nextStep() {
  if (si < L.steps.length - 1) { startStep(si + 1); return; }
  finishLesson();
}
function finishLesson() {
  if (!S.lessonDone) { S.lessonDone = true; markDone(L.id); }
  S.done = true;
  const i = LESSONS.indexOf(L); const n = LESSONS[i + 1];
  feedback('win', 'Lesson complete! 🎉', n ? 'Next: ' + tx(n.title) : 'That was the last lesson. Well done!');
  $('l-dots').innerHTML = L.steps.map(() => '<i class="ok"></i>').join('') + `<span>✅</span>`;
  let h = `<button type="button" class="btn btn-ghost" data-lact="home">All lessons</button>`;
  h += n ? `<button type="button" class="btn btn-review" data-lact="nextlesson">Next lesson</button>` : '';
  $('l-actions').innerHTML = h;
  opts.confetti && opts.confetti();
}
function stepDone(msg) {
  S.done = true; S.busy = false;
  if (si === L.steps.length - 1) { finishLesson(); feedbackKeep(msg); return; }
  feedback('good', msg || pick(['Correct! ✓', 'Well done! ✓', 'Great move! ✓']), 'Tap Next to continue');
  renderActions();
}
function feedbackKeep(msg) { if (msg) $('l-fb').querySelector('.p-ftitle').textContent = ui(msg) + ' · ' + ui('Lesson complete! 🎉'); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------------- moves ---------------- */
function dests(sq) {
  if (S.mode === 'stars') return S.sq === sq ? starDests(S.st.piece, sq).map((to) => ({ to })) : [];
  return S.chess.moves({ square: sq, verbose: true });
}
function play(san) {
  const mv = S.chess.move(san);
  board.set(S.chess.fen());
  marks(mv);
  opts.sound(mv, S.chess);
  return mv;
}
function marks(mv) {
  let check = null;
  if (S.chess.inCheck()) for (const row of S.chess.board()) for (const pc of row) if (pc && pc.type === 'k' && pc.color === S.chess.turn()) check = pc.square;
  board.setMarks({ last: mv ? [mv.from, mv.to] : [], check });
}
// the expected learner moves at this ply, as chess.js move objects, each with the line it belongs to
function expected() {
  const out = [];
  for (const line of S.lines || []) {
    const san = line[S.ply]; if (!san) continue;
    const t = new Chess(S.chess.fen()); let mv = null; try { mv = t.move(san); } catch (e) {}
    if (mv) out.push({ mv, line });
  }
  return out;
}
function userMove(from, to, d) {
  if (!S || S.done || S.busy) return;
  const my = gen;
  if (S.mode === 'stars') return starMove(to);
  if (S.mode === 'goal') return goalMove(from, to, d);
  const exp = expected();
  const match = exp.find((e) => e.mv.from === from && e.mv.to === to);
  const promo = d.promotion ? (match && match.mv.promotion) || 'q' : undefined;
  const test = new Chess(S.chess.fen()); let tm = null; try { tm = test.move({ from, to, promotion: promo }); } catch (e) { return; }
  const mateOk = exp.some((e) => e.mv.san.endsWith('#')) && test.isCheckmate();
  const checkOk = S.st.need === 'check' && test.inCheck();
  if (match || mateOk || checkOk) {
    S.hints = 0; board.setArrows([]);
    const mv = play({ from, to, promotion: promo });
    board.setBadge({ sq: to, icon: '✓', color: '#7fb33f' });
    if (checkOk || mateOk) { stepDone(mateOk ? 'Checkmate! ✓' : 'Check! ✓'); return; }
    S.lines = S.lines.filter((l) => l[S.ply] && sameMove(l[S.ply], mv));
    S.ply++;
    const line = S.lines[0];
    if (!line || S.ply >= line.length) { stepDone(); return; }
    S.busy = true;
    feedback('good', pick(['Correct! ✓', 'Good move! ✓', 'That’s it! ✓']), 'Now the opponent replies…');
    setTimeout(() => {
      if (my !== gen) return;
      board.setBadge(null);
      play(line[S.ply]); S.ply++;
      S.busy = false;
      if (S.ply >= line.length) { stepDone('Well done! ✓'); return; }
      feedback('turn', 'Your move', 'Keep going: find the next move.');
      renderActions();
    }, 700);
  } else {
    S.wrong++;
    const mv = play({ from, to, promotion: promo });
    board.setBadge({ sq: mv.to, icon: '✕', color: '#f03e2f' });
    S.busy = true;
    const stale = S.chess.isStalemate();
    feedback('bad', stale ? 'That’s stalemate: a draw!' : pick(['Not quite. Try again', 'Not this one. Try again', 'Almost! Try again']), stale ? 'Find a move that wins instead.' : S.wrong >= 2 ? 'Tap Hint if you are stuck.' : 'Read the lesson text again for a clue.');
    setTimeout(() => {
      if (my !== gen) return;
      S.chess.undo(); board.set(S.chess.fen()); board.setBadge(null);
      const h = S.chess.history({ verbose: true }); marks(h[h.length - 1] || null);
      if (S.st.hl && !h.length) board.setMarks({ cls: Object.fromEntries(S.st.hl.map((q) => [q, 'l-hl'])) });
      S.busy = false;
    }, 900);
  }
}
function sameMove(san, mv) { const t = new Chess(mv.before); try { const m = t.move(san); return m.from === mv.from && m.to === mv.to; } catch (e) { return false; } }
async function hint() {
  if (!S || S.done || S.busy) return;
  S.hints = (S.hints || 0) + 1;
  let from = null, to = null;
  if (S.mode === 'stars') { const path = starPath(S.st.piece, S.sq, S.left); if (path) { from = S.sq; to = path; } }
  else if (S.mode === 'goal') {
    feedback('turn', 'Thinking of a hint…');
    const u = await bestFor(S.chess.fen()); if (!u || !S || S.done) return; from = u.slice(0, 2); to = u.slice(2, 4);
  } else {
    const e = expected()[0];
    if (e) { from = e.mv.from; to = e.mv.to; }
    else if (S.st.need === 'check') { const m = S.chess.moves({ verbose: true }).find((x) => x.san.includes('+')); if (m) { from = m.from; to = m.to; } }
  }
  if (!from) return;
  if (S.hints >= 2) { board.setArrows([{ from, to }]); feedback('turn', 'Hint', 'Play the move shown by the arrow.'); }
  else { board.setMarks({ ...board.marks, cls: { ...(board.marks.cls || {}), [from]: 'rc-great' } }); feedback('turn', 'Hint', 'Move the highlighted piece. Tap Hint again to see where.'); }
}

/* ---------------- stars ---------------- */
const F = 'abcdefgh';
function starDests(p, sq) {
  const f = F.indexOf(sq[0]), r = +sq[1] - 1, out = [];
  const add = (x, y) => { if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push(F[x] + (y + 1)); };
  const ray = (dx, dy) => { for (let k = 1; k < 8; k++) add(f + dx * k, r + dy * k); };
  if (p === 'R' || p === 'Q') [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([a, b]) => ray(a, b));
  if (p === 'B' || p === 'Q') [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => ray(a, b));
  if (p === 'N') [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([a, b]) => add(f + a, r + b));
  if (p === 'K') [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => add(f + a, r + b));
  return out;
}
// first step of a shortest path that collects the nearest star (used by Hint and the test)
export function starPath(p, from, left) {
  const seen = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const s = q.shift();
    if (left.includes(s) && s !== from) { let x = s; while (seen.get(x) !== from) x = seen.get(x); return x; }
    for (const n of starDests(p, s)) if (!seen.has(n)) { seen.set(n, s); q.push(n); }
  }
  return null;
}
function starFen() {
  const rows = [];
  for (let r = 7; r >= 0; r--) { let row = '', e = 0; for (let f = 0; f < 8; f++) { if (F[f] + (r + 1) === S.sq) { if (e) row += e; e = 0; row += S.st.piece; } else e++; } if (e) row += e; rows.push(row); }
  return rows.join('/') + ' w - - 0 1';
}
function paintStars() {
  board.set(starFen());
  board.setMarks({ cls: Object.fromEntries(S.left.map((q) => [q, 'l-star'])) });
}
function starMove(to) {
  S.sq = to; S.moves++; board.setArrows([]); S.hints = 0;
  const got = S.left.includes(to);
  S.left = S.left.filter((q) => q !== to);
  paintStars();
  opts.sound({ captured: got ? 'p' : null, san: '', flags: got ? 'c' : 'n' }, { inCheck: () => false });
  if (!S.left.length) { stepDone(`All stars collected in ${S.moves} moves! ⭐`); return; }
  feedback('turn', got ? 'Got it! ⭐' : 'Collect all the stars', `${S.st.stars.length - S.left.length}/${S.st.stars.length} ⭐`);
}

/* ---------------- play it out vs Stockfish ---------------- */
function ensureEngine() {
  if (!engine) { engine = new Engine(); engine.start(); }
}
async function bestFor(fen, depth = 14) {
  ensureEngine();
  let u = null;
  if (!engine.failed) {
    if (!engine.ready) await new Promise((r) => { const t0 = Date.now(); const w = () => (engine.ready || engine.failed || Date.now() - t0 > 20000 ? r() : setTimeout(w, 200)); w(); });
    if (engine.ready) u = await engine.bestMove(fen, { depth, skill: 20 });
  }
  if (!u) { const m = fallbackMove(Chess, fen, 2); u = m ? (typeof m === 'string' ? m : m.from + m.to + (m.promotion || '')) : null; }
  return u;
}
function goalMove(from, to, d) {
  const my = gen;
  let mv = null; try { mv = S.chess.move({ from, to, promotion: d.promotion ? 'q' : undefined }); } catch (e) { return; }
  board.set(S.chess.fen()); marks(mv); opts.sound(mv, S.chess); board.setArrows([]); S.hints = 0;
  if (checkGoal(mv)) return;
  S.busy = true; feedback('wait', 'Goal: ' + tx(S.st.g), 'The computer is thinking…');
  setTimeout(() => engineReply(my), 250);
}
async function engineReply(my) {
  const u = await bestFor(S.chess.fen(), 12);
  if (my !== gen || !S) return;
  if (!u) { S.busy = false; return; }
  const mv = S.chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
  board.set(S.chess.fen()); marks(mv); opts.sound(mv, S.chess);
  S.busy = false;
  if (checkGoal(mv)) return;
  feedback('turn', 'Goal: ' + tx(S.st.g), yourMove());
  renderActions();
}
// true when the goal step is over (won or failed)
function checkGoal(mv) {
  const g = S.st.goal, c = S.chess, me = S.me, opp = me === 'w' ? 'b' : 'w';
  const count = (color, type) => c.board().flat().filter((p) => p && p.color === color && p.type === type).length;
  let win = false;
  if (g === 'mate') win = c.isCheckmate() && c.turn() === opp;
  if (g === 'promote') win = !!(mv.promotion && mv.color === me);
  if (g === 'catch') win = count(opp, 'p') === 0 && count(opp, 'q') === 0;
  if (win) { stepDone(g === 'mate' ? 'Checkmate! You did it ✓' : g === 'promote' ? 'New queen! You did it ✓' : 'Pawn caught! ✓'); return true; }
  let lost = null;
  if (c.isStalemate()) lost = 'Stalemate: that’s a draw.';
  else if (c.isGameOver()) lost = c.isCheckmate() ? 'Checkmate against you.' : 'The game is a draw.';
  else if (g === 'catch' && count(opp, 'q') > 0) lost = 'The pawn became a queen.';
  else if (g === 'promote' && count(me, 'p') === 0) lost = 'Your pawn was captured.';
  if (lost) { S.done = false; S.busy = true; feedback('bad', lost, 'Tap Restart and try again. Hint shows a good move.'); $('l-actions').innerHTML = `<button type="button" class="btn btn-review" data-lact="retry">Restart</button>`; return true; }
  return false;
}

/* ---------------- test hooks (used by test/harness/learn.py) ---------------- */
window.__learn = {
  LESSONS, open, startLesson, back, close,
  state: () => S && { lesson: L && L.id, step: si, mode: S.mode, done: !!S.done, busy: !!S.busy, me: S.me, fen: S.chess ? S.chess.fen() : null, left: S.left, sq: S.sq, lessonDone: !!S.lessonDone },
  // the learner's correct move right now (from, to) — the same data Hint uses
  answer: () => {
    if (!S || S.done || S.busy) return null;
    if (S.mode === 'stars') { const to = starPath(S.st.piece, S.sq, S.left); return to && { from: S.sq, to }; }
    if (S.mode === 'line') { const e = expected()[0]; if (e) return { from: e.mv.from, to: e.mv.to, promotion: e.mv.promotion }; const m = S.chess.moves({ verbose: true }).find((x) => x.san.includes('+')); return m && { from: m.from, to: m.to }; }
    return null;
  },
  best: async () => { const u = await bestFor(S.chess.fen(), 16); return u && { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }; },
  move: (from, to, promotion) => userMove(from, to, { promotion }),
  next: () => act('next'), done: doneSet,
};
