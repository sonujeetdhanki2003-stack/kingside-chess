// Game Review: every move classified (brilliant … blunder), eval bar, accuracy per player, best-move arrow,
// eval graph and step-through. Runs fully on the phone with Stockfish (see analysis.js).
import * as Progress from './progress.js';
import { Chess } from './vendor/chess.js';
import { Board, pieceUrl } from './board.js';
import { Analyzer } from './analysis.js';
import { loadOpenings, openingFor, isBook } from './openings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const CLS = {
  brilliant: { label: 'Brilliant', icon: '!!', color: '#1baaa6' },
  great: { label: 'Great', icon: '!', color: '#5b8baf' },
  best: { label: 'Best', icon: '★', color: '#7fb33f' },
  excellent: { label: 'Excellent', icon: '👍', color: '#7fb33f' },
  good: { label: 'Good', icon: '✓', color: '#7d9a62' },
  book: { label: 'Book', icon: '📖', color: '#a88865' },
  forced: { label: 'Forced', icon: '→', color: '#8a8f98' },
  inaccuracy: { label: 'Inaccuracy', icon: '?!', color: '#f2be3a' },
  mistake: { label: 'Mistake', icon: '?', color: '#ff9b47' },
  miss: { label: 'Miss', icon: '✕', color: '#ee6b5f' },
  blunder: { label: 'Blunder', icon: '??', color: '#f03e2f' },
};
const SUMMARY_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const CACHE = 'kingside-review-v3';

export const analyzer = new Analyzer();
let board = null, G = null, ply = 0, run = 0, opts = { toast: () => {} };
let engineInfo = null;

/* ---------------- maths ---------------- */
// Win% from centipawns: Lichess's published curve (lila WinPercent). Accuracy caps evals at ±1000 like Lichess.
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
// evaluation of a position from White's side: { cp } or { mate } (mate > 0: White mates)
function whiteWin(e, cap = 10000) {
  if (!e) return 50;
  if (e.mate !== undefined) return e.mate > 0 ? 100 : e.mate < 0 ? 0 : (e.matedSide === 'w' ? 0 : 100);
  return winPct(Math.max(-cap, Math.min(cap, e.cp)));
}
const moverWin = (e, color) => (color === 'w' ? whiteWin(e) : 100 - whiteWin(e));
function evalText(e) {
  if (!e) return '';
  if (e.mate !== undefined) return e.mate === 0 ? '#' : (e.mate > 0 ? '' : '-') + 'M' + Math.abs(e.mate);
  const v = e.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}
// Lichess move accuracy (lila AccuracyPercent.fromWinPercents), incl. its +1 "uncertainty bonus"
function moveAcc(loss) {
  if (loss <= 0) return 100;
  return Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411 + 1));
}
// Lichess game accuracy (lila AccuracyPercent.gameAccuracy): volatility-weighted mean + harmonic mean, per side.
function lichessCp(e) {
  if (!e) return 0;
  if (e.mate !== undefined) return e.mate > 0 ? 1000 : e.mate < 0 ? -1000 : (e.matedSide === 'w' ? -1000 : 1000);
  return Math.max(-1000, Math.min(1000, e.cp));
}
function gameAccuracy(evals, startTurn) {
  const cps = evals.slice(1).map(lichessCp);
  const n = cps.length; if (!n) return { w: null, b: null };
  const wps = [winPct(startTurn === 'b' ? -15 : 15)].concat(cps.map(winPct));
  const ws = Math.max(2, Math.min(8, Math.floor(n / 10)));
  const windows = [];
  for (let i = 0; i < Math.max(0, Math.min(ws, wps.length) - 2); i++) windows.push(wps.slice(0, ws));
  for (let i = 0; i + ws <= wps.length; i++) windows.push(wps.slice(i, i + ws));
  const sd = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length); };
  const weights = windows.map((xs) => Math.max(0.5, Math.min(12, sd(xs))));
  const per = { w: [], b: [] };
  const first = startTurn || 'w';
  for (let i = 0; i < n; i++) {
    const color = (i % 2 === 0) === (first === 'w') ? 'w' : 'b';
    const before = color === 'w' ? wps[i] : 100 - wps[i], after = color === 'w' ? wps[i + 1] : 100 - wps[i + 1];
    per[color].push([moveAcc(before - after), weights[i] == null ? 0.5 : weights[i]]);
  }
  const side = (vs) => {
    if (!vs.length) return null;
    const wm = vs.reduce((a, [x, w]) => a + x * w, 0) / vs.reduce((a, [, w]) => a + w, 0);
    const hm = vs.length / vs.reduce((a, [x]) => a + 1 / Math.max(1, x), 0);
    return (wm + hm) / 2;
  };
  return { w: side(per.w), b: side(per.b) };
}

/* ---------------- game prep ---------------- */
function prepare(game) {
  const c = new Chess();
  const fens = [c.fen()], sans = [], verbose = [], nLegal = [], inCheck = [];
  for (const u of game.moves) {
    nLegal.push(c.moves().length); inCheck.push(c.inCheck());
    let mv; try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); } catch (e) { break; }
    if (!mv) break;
    sans.push(mv.san); verbose.push(mv); fens.push(c.fen());
  }
  const key = game.moves.join('');
  return { ...game, fens, sans, verbose, nLegal, inCheck, key, evals: new Array(fens.length).fill(null), cls: [], acc: null };
}
function terminalEval(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { mate: 0, matedSide: c.turn(), best: null, done: true };
  if (c.isDraw()) return { cp: 0, best: null, done: true };
  return null;
}
// engine answer (side-to-move view) -> White view
function toWhite(line, turn) {
  if (!line) return null;
  const s = turn === 'w' ? 1 : -1;
  return line.mate !== undefined ? { mate: line.mate * s } : { cp: line.cp * s };
}

/* ---------------- classification ---------------- */
// Inaccuracy / Mistake / Blunder: Lichess's own rules (lila Advice): a drop in winning chances of
// 0.1 / 0.2 / 0.3 (= 5 / 10 / 15 win% points), plus its forced-mate rules. Returns 0..3.
function lichessJudge(before, after, color) {
  const mPov = (e) => {
    if (e.mate === undefined) return null;
    if (e.mate === 0) return e.matedSide === color ? -1 : 1;
    return color === 'w' ? e.mate : -e.mate;
  };
  const cPov = (e) => (e.mate !== undefined ? null : color === 'w' ? e.cp : -e.cp);
  const pm = mPov(before), nm = mPov(after), pc = cPov(before), nc = cPov(after);
  if (pc !== null && nc !== null) {
    const wc = (c) => 2 / (1 + Math.exp(-0.00368208 * c)) - 1;
    const d = wc(pc) - wc(nc);
    return d >= 0.3 ? 3 : d >= 0.2 ? 2 : d >= 0.1 ? 1 : 0;
  }
  if (pm === null && nm !== null && nm < 0) { const p = pc || 0; return p < -999 ? 1 : p < -700 ? 2 : 3; } // walked into a forced mate
  if (pm !== null && pm > 0 && (nm === null || nm < 0)) { const q = nc || 0; return q > 999 ? 1 : q > 700 ? 2 : 3; } // let a forced mate slip
  return 0;
}
const pieceVal = (p) => (p.type === 'k' ? 99 : VAL[p.type]);
// the moved piece itself is left en prise
function isSacrifice(fenAfter, mv) {
  if (mv.piece === 'p' || mv.piece === 'k' || mv.promotion) return false;
  const v = VAL[mv.piece], gained = mv.captured ? VAL[mv.captured] : 0;
  if (gained >= v) return false;
  const c = new Chess(fenAfter);
  const opp = mv.color === 'w' ? 'b' : 'w';
  const att = c.attackers(mv.to, opp);
  if (!att.length) return false;
  const minAtt = Math.min(...att.map((s) => { const p = c.get(s); return p ? pieceVal(p) : 99; }));
  const def = c.attackers(mv.to, mv.color).length;
  if (minAtt === 99 && def) return false; // only the king could take, and it is defended
  return (minAtt < v || !def) && v - gained >= 2;
}
// most material the opponent can grab at once from a minor/major piece the mover left hanging (e.g. 17...Be6!! leaving the queen)
function hangingAfter(fenAfter, color) {
  const c = new Chess(fenAfter);
  let best = 0;
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured || m.flags.includes('e')) continue;
    if (!'nbrq'.includes(m.captured)) continue;
    const vv = VAL[m.captured];
    const defended = c.attackers(m.to, color).length > 0;
    if (m.piece === 'k') { if (!defended) best = Math.max(best, vv); continue; }
    best = Math.max(best, defended ? vv - VAL[m.piece] : vv);
  }
  return best;
}
function material(fen, color) {
  let s = 0;
  for (const ch of fen.split(' ')[0]) {
    const t = ch.toLowerCase(); if (!(t in VAL)) continue;
    s += (ch === t ? -1 : 1) * VAL[t] * (color === 'w' ? 1 : -1);
  }
  return s;
}
// the position before the move with the opponent to move: what could they already grab? (no en passant)
function passFen(fen) { const p = fen.split(' '); p[1] = p[1] === 'w' ? 'b' : 'w'; p[3] = '-'; return p.join(' '); }
function sacrificed(G, k) {
  const mv = G.verbose[k];
  if (mv.piece === 'k') return false;
  const gained = mv.captured ? VAL[mv.captured] : 0;
  if (isSacrifice(G.fens[k + 1], mv)) return true;
  const h = hangingAfter(G.fens[k + 1], mv.color);
  if (h - gained < 3) return false;
  // saving a bigger piece while leaving a smaller one is not a sacrifice (e.g. a queen escaping a fork)
  let hb = 0; try { hb = hangingAfter(passFen(G.fens[k]), mv.color); } catch (e) { hb = 0; }
  if (h < hb) return false;
  // and the offer must be new: not a piece already left en prise by this player's own previous move
  const hp = k >= 1 ? hangingAfter(G.fens[k - 1], mv.color) : 0;
  return h > hp;
}
// Brilliant: the engine's best move, a real piece sacrifice, still fine afterwards (or mating),
// not escaping check, not already completely winning, and not just the continuation of a sacrifice made a few moves ago.
function isBrilliant(G, k, wb, wa, isBest) {
  const mv = G.verbose[k], color = mv.color, after = G.evals[k + 1];
  if (!isBest || G.inCheck[k]) return false;
  if (!sacrificed(G, k)) return false;
  const mating = after.mate !== undefined && after.mate !== 0 && (after.mate > 0) === (color === 'w');
  if (wa < 40) return false;
  if (wb >= 85 && !mating) return false;
  if (material(G.fens[k], color) <= material(G.fens[Math.max(0, k - 6)], color) - 2) return false;
  return true;
}
// Great: the only good move (every other move is at least 20 win% worse) in a game that is still open,
// not a recapture, not a check escape, and not simply cashing in on the opponent's mistake.
function isGreat(G, k, wb, isBest) {
  const mv = G.verbose[k], before = G.evals[k];
  if (!isBest || !before.second || G.inCheck[k]) return false;
  if (wb - moverWin(before.second, mv.color) < 20) return false;
  if (!(wb > 15 && wb < 85)) return false;
  const prev = k > 0 ? G.verbose[k - 1] : null;
  if (prev && prev.captured && prev.to === mv.to) return false;
  const pc = k > 0 && G.cls[k - 1] ? G.cls[k - 1].c : null;
  if (pc === 'mistake' || pc === 'blunder' || pc === 'miss') return false;
  return true;
}
function classify(G, k) {
  const before = G.evals[k], after = G.evals[k + 1];
  if (!before || !after) return null;
  const mv = G.verbose[k], color = mv.color;
  if (G.nLegal[k] === 1) return { c: 'forced', loss: 0 };
  const uci = mv.from + mv.to + (mv.promotion || '');
  const wb = moverWin(before, color), wa = moverWin(after, color);
  const loss = Math.max(0, wb - wa);
  const isBest = before.best === uci;
  const sev = lichessJudge(before, after, color);
  if (!sev) {
    if (k < 24 && isBook(G.fens[k + 1]) && loss < 6) return { c: 'book', loss };
    if (loss <= 2 || isBest) {
      if (isBrilliant(G, k, wb, wa, isBest)) return { c: 'brilliant', loss };
      if (isGreat(G, k, wb, isBest)) return { c: 'great', loss };
      return { c: isBest ? 'best' : 'excellent', loss };
    }
    return { c: 'good', loss };
  }
  let c = sev === 3 ? 'blunder' : sev === 2 ? 'mistake' : 'inaccuracy';
  // a "miss": the opponent just went wrong and this move let the chance slip
  const prevCls = k > 0 && G.cls[k - 1] ? G.cls[k - 1].c : null;
  if ((c === 'inaccuracy' || c === 'mistake') && (prevCls === 'mistake' || prevCls === 'blunder') && wb >= 60) c = 'miss';
  return { c, loss };
}
// Which positions get the second, longer look: Brilliant candidates first, then Great ones, then the
// costliest moves of the game, at most 16 positions in all (about 20 s on a mid-range phone).
function recheckList(G) {
  const MAX = 16, out = [], seen = new Set();
  const add = (k) => { const ps = [k, k + 1].filter((i) => !seen.has(i)); if (out.length + ps.length > MAX) return false; ps.forEach((i) => { seen.add(i); out.push(i); }); return true; };
  G.cls.forEach((r, k) => { if (r && r.c === 'brilliant') add(k); });
  G.cls.forEach((r, k) => { if (r && r.c === 'great') add(k); });
  const costly = G.cls.map((r, k) => [r ? r.loss : 0, k]).filter(([l]) => l >= 4).sort((x, y) => y[0] - x[0]);
  for (const [, k] of costly) if (!add(k)) break;
  return out.sort((x, y) => x - y);
}
function computeAll(G) {
  for (let k = 0; k < G.verbose.length; k++) G.cls[k] = classify(G, k);
  const counts = { w: {}, b: {} };
  G.verbose.forEach((mv, k) => {
    const r = G.cls[k]; if (!r) return;
    counts[mv.color][r.c] = (counts[mv.color][r.c] || 0) + 1;
  });
  const done = G.evals.every(Boolean);
  G.acc = done ? gameAccuracy(G.evals, G.fens[0].split(' ')[1]) : null; G.counts = counts;
}

/* ---------------- cache ---------------- */
function loadCache(key) {
  try { const all = JSON.parse(localStorage.getItem(CACHE) || '[]'); const hit = all.find((x) => x.k === key); return hit ? hit.e : null; } catch (e) { return null; }
}
function saveCache(key, evals) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '[]').filter((x) => x.k !== key);
    all.unshift({ k: key, e: evals }); localStorage.setItem(CACHE, JSON.stringify(all.slice(0, 12)));
  } catch (e) {}
}

/* ---------------- analysis run ---------------- */
async function analyseGame() {
  const my = ++run;
  const cached = loadCache(G.key + '|' + (engineInfo ? engineInfo.short : ''));
  if (cached && cached.length === G.evals.length) { G.evals = cached; computeAll(G); G.done = true; reviewDone(); render(); return; }
  // v1.8: free full reviews per day, then review tickets (bought with Crowns); offline it always goes ahead
  if (opts.gate) {
    setProgress(0, 'Getting your review ready…');
    const go = await opts.gate(G.key);
    if (run !== my) return;
    if (!go) {
      setProgress(null, 'Free reviews used up today. Use a review ticket, or come back tomorrow. You can still step through the moves.');
      let b = $('r-gate-again');
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'r-gate-again'; b.className = 'btn btn-gold r-gate-btn'; b.textContent = 'Review this game'; $('r-progress').appendChild(b); }
      b.hidden = false; b.onclick = () => { b.hidden = true; analyseGame(); };
      render(); return;
    }
    const gb = $('r-gate-again'); if (gb) gb.hidden = true;
  }
  setProgress(0, 'Loading Stockfish…');
  analyzer.onProgress = (f) => { if (run === my) setProgress(0, `Downloading Stockfish 19… ${Math.round(f * 100)}%`); };
  const info = await analyzer.start();
  if (run !== my) return;
  if (!info) { setProgress(null, 'The analysis engine could not start on this device.'); return; }
  engineInfo = info;
  const again = loadCache(G.key + '|' + info.short);
  if (again && again.length === G.evals.length) { G.evals = again; computeAll(G); G.done = true; reviewDone(); render(); return; }
  await loadOpenings();
  const n = G.fens.length;
  const fast = info.nnue ? { depth: 18, movetime: 650 } : { depth: 14, movetime: 650 };
  for (let i = 0; i < n; i++) {
    if (run !== my) return;
    let e = terminalEval(G.fens[i]);
    if (!e) {
      const turn = G.fens[i].split(' ')[1];
      const res = await analyzer.analyse({ fen: G.fens[i], multipv: 2, ...fast });
      if (run !== my) return;
      if (!res || !res.lines.length) { e = { cp: 0, best: res && res.best }; }
      else {
        e = toWhite(res.lines[0], turn);
        e.best = res.best || res.lines[0].pv[0];
        e.pv = res.lines[0].pv.slice(0, 8);
        if (res.lines[1]) e.second = toWhite(res.lines[1], turn);
      }
    }
    G.evals[i] = e;
    if (i > 0) G.cls[i - 1] = classify(G, i - 1);
    setProgress((i + 1) / n, `Analysing with ${info.name}… ${Math.round(((i + 1) / n) * 100)}%`);
    if (i === ply || i === ply + 1 || i % 6 === 0) render();
  }
  computeAll(G);
  // second look: every Brilliant / Great candidate, plus the costliest moves of the game (up to 12 more positions),
  // is re-checked with a longer search, so the blunder / mistake labels and the accuracy rest on firmer evals.
  const deep = info.nnue ? { depth: 24, movetime: 1300 } : { depth: 16, movetime: 1300 };
  const recheck = recheckList(G);
  const todo = recheck.filter((i) => G.evals[i] && !G.evals[i].done).sort((a, b) => a - b);
  for (let j = 0; j < todo.length; j++) {
    if (run !== my) return;
    const i = todo[j];
    setProgress(0.99, `Double-checking key moves… ${j + 1}/${todo.length}`);
    const turn = G.fens[i].split(' ')[1];
    const res = await analyzer.analyse({ fen: G.fens[i], multipv: 2, ...deep });
    if (run !== my) return;
    if (res && res.lines.length) {
      const e = toWhite(res.lines[0], turn);
      e.best = res.best || res.lines[0].pv[0];
      e.pv = res.lines[0].pv.slice(0, 8);
      if (res.lines[1]) e.second = toWhite(res.lines[1], turn);
      e.deep = 1;
      G.evals[i] = e;
    }
  }
  computeAll(G); G.done = true; reviewDone();
  saveCache(G.key + '|' + info.short, G.evals);
  setProgress(null, '');
  render();
}
function setProgress(f, text) {
  const el = $('r-progress');
  el.hidden = f === null && !text;
  $('r-progress-text').textContent = text;
  $('r-progress-fill').style.width = f === null ? '0%' : Math.round(f * 100) + '%';
}

/* ---------------- view ---------------- */
export function setup(o) {
  opts = { ...opts, ...o };
  board = new Board($('r-board'), { movable: () => false });
  $('r-back').onclick = () => { if (history.state && history.state.kview === 'review') history.back(); else close(); };
  $('r-flip').onclick = () => { board.flip(); render(); };
  $('r-first').onclick = () => go(0);
  $('r-prev').onclick = () => go(ply - 1);
  $('r-next').onclick = () => go(ply + 1);
  $('r-last').onclick = () => go(G ? G.fens.length - 1 : 0);
  $('r-moves').onclick = (e) => { const b = e.target.closest('[data-ply]'); if (b) go(+b.dataset.ply); };
  $('r-graph').onclick = (e) => {
    if (!G) return; const r = $('r-graph').getBoundingClientRect();
    go(Math.round(((e.clientX - r.left) / r.width) * (G.fens.length - 1)));
  };
  document.addEventListener('keydown', (e) => {
    if ($('rscreen').hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(ply - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(ply + 1); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(G.fens.length - 1);
  });
  // swipe on the board steps moves
  let sx = null;
  $('r-board').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('r-board').addEventListener('touchend', (e) => {
    if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) go(ply + (dx < 0 ? 1 : -1));
  });
}
export const isOpen = () => !$('rscreen').hidden;
// game: { moves: [uci], white, black, result: '1-0'|'0-1'|'1/2-1/2'|'', orientation, date }
export function open(game) {
  G = prepare(game); G.orient = game.orientation || 'w'; G.mine = game.mine !== false; G.src = game;
  ply = G.fens.length - 1 > 0 ? 0 : 0;
  $('rscreen').hidden = false; document.body.classList.add('r-open');
  $('rscreen').scrollTop = 0;
  board.flip(game.orientation || 'w');
  board.set(G.fens[0], { animate: false });
  render();
  analyseGame();
}
export const current = () => (G ? { ...G.src, moves: G.verbose.map((m) => m.from + m.to + (m.promotion || '')) } : null);
export function close() {
  run++; analyzer.stop();
  $('rscreen').hidden = true; document.body.classList.remove('r-open');
  opts.onClose && opts.onClose();
}
export function back() { if (!isOpen()) return false; close(); return true; }
function go(p) {
  if (!G) return;
  p = Math.max(0, Math.min(G.fens.length - 1, p));
  if (p === ply) return;
  const fwd = p === ply + 1;
  ply = p;
  board.set(G.fens[ply], { animate: fwd || p === ply - 1 });
  if (opts.sound && fwd) opts.sound(G.verbose[ply - 1], G.fens[ply]);
  render();
}
function uciToSan(fen, uci) {
  try { const c = new Chess(fen); const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); return m ? m.san : uci; } catch (e) { return uci; }
}
function render() {
  if (!G) return;
  const fen = G.fens[ply];
  const mv = ply > 0 ? G.verbose[ply - 1] : null;
  const c = new Chess(fen);
  let check = null;
  if (c.inCheck()) for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === c.turn()) check = p.square;
  const r = ply > 0 ? G.cls[ply - 1] : null;
  const info = r ? CLS[r.c] : null;
  const marks = { last: mv ? [mv.from, mv.to] : [], check, cls: {} };
  if (mv && info) { marks.cls[mv.from] = 'rc-' + r.c; marks.cls[mv.to] = 'rc-' + r.c; marks.last = []; }
  board.setMarks(marks);
  board.setBadge(mv && info ? { sq: mv.to, icon: info.icon, color: info.color } : null);
  // best-move arrow: what the engine wanted instead of the move played (or the best move from here at the start)
  const arrows = [];
  if (mv && r && G.evals[ply - 1] && G.evals[ply - 1].best && !['best', 'book', 'forced', 'great', 'brilliant'].includes(r.c)) {
    const b = G.evals[ply - 1].best; arrows.push({ from: b.slice(0, 2), to: b.slice(2, 4) });
  }
  board.setArrows(arrows);
  // eval bar (White's share), flipped with the board
  const e = G.evals[ply];
  const ww = e ? whiteWin(e) : 50;
  const bar = $('r-evalbar');
  bar.classList.toggle('flipped', board.orientation === 'b');
  $('r-evalfill').style.height = ww + '%';
  const et = $('r-evaltxt'); et.textContent = e ? evalText(e).replace('+', '') : '';
  et.classList.toggle('on-white', ww >= 50);
  // players
  const top = board.orientation === 'w' ? 'b' : 'w';
  const pl = (col) => {
    const acc = G.acc && G.acc[col] != null ? `<span class="r-acc">${G.acc[col].toFixed(1)}</span>` : '';
    return `<span class="r-av" style="background-image:url(${pieceUrl(col + 'K')})"></span><b>${esc(col === 'w' ? G.white : G.black)}</b>${acc}`;
  };
  $('r-ptop').innerHTML = pl(top); $('r-pbottom').innerHTML = pl(top === 'w' ? 'b' : 'w');
  // coach line
  let coach;
  if (!mv) {
    const op = openingFor(G.fens.slice(1));
    coach = `<div class="r-ctitle">${G.done ? 'Review ready' : 'Starting position'}</div><div class="r-csub">${op ? esc(op.name) + ' · ' : ''}${G.sans.length} moves${G.result ? ' · ' + esc(G.result) : ''}. Tap ▶ to step through.</div>`;
  } else if (!r) {
    coach = `<div class="r-ctitle">${Math.ceil(ply / 2)}${mv.color === 'w' ? '.' : '…'} ${esc(mv.san)}</div><div class="r-csub">Analysing this move…</div>`;
  } else {
    const before = G.evals[ply - 1];
    const bestSan = before && before.best ? uciToSan(G.fens[ply - 1], before.best) : null;
    const word = { best: 'is the best move', excellent: 'is excellent', good: 'is good', book: 'is a book move', forced: 'is forced', great: 'is a great move', brilliant: 'is brilliant!!', inaccuracy: 'is an inaccuracy', mistake: 'is a mistake', miss: 'is a miss', blunder: 'is a blunder' }[r.c];
    let sub = '';
    if (r.c === 'brilliant') sub = 'A strong sacrifice that the engine agrees with.';
    else if (r.c === 'great') sub = 'The only good move in this position.';
    else if (r.c === 'book') { const op = openingFor(G.fens.slice(1, ply + 1)); sub = op ? esc(op.name) : 'A known opening move.'; }
    else if (r.c === 'miss') sub = `Missed the chance to punish. ${bestSan ? 'Best was <b>' + esc(bestSan) + '</b>.' : ''}`;
    else if (bestSan && !['best', 'forced'].includes(r.c)) sub = `Best was <b>${esc(bestSan)}</b>${before ? ' (' + evalText(before) + ')' : ''}.`;
    coach = `<div class="r-ctitle"><span class="r-icon" style="background:${info.color}">${info.icon}</span>${Math.ceil(ply / 2)}${mv.color === 'w' ? '.' : '…'} ${esc(mv.san)} <span>${word}</span><em>${evalText(e)}</em></div><div class="r-csub">${sub}</div>`;
  }
  $('r-coach').innerHTML = coach;
  $('r-first').disabled = $('r-prev').disabled = ply === 0;
  $('r-next').disabled = $('r-last').disabled = ply >= G.fens.length - 1;
  renderMoves(); renderGraph(); renderSummary();
}
function renderMoves() {
  let out = '';
  for (let i = 0; i < G.sans.length; i += 2) {
    const cell = (k) => {
      if (k >= G.sans.length) return '<span class="rm"></span>';
      const r = G.cls[k]; const info = r ? CLS[r.c] : null;
      return `<button type="button" class="rm${k + 1 === ply ? ' cur' : ''}" data-ply="${k + 1}">${info ? `<i style="background:${info.color}">${info.icon}</i>` : ''}${esc(G.sans[k])}</button>`;
    };
    out += `<li><span class="n">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}</li>`;
  }
  const ol = $('r-moves');
  ol.innerHTML = out || '<li class="r-empty">No moves in this game.</li>';
  const cur = ol.querySelector('.cur');
  if (cur) { const top = cur.offsetTop - ol.offsetTop; if (top < ol.scrollTop || top > ol.scrollTop + ol.clientHeight - 40) ol.scrollTop = top - ol.clientHeight / 2; }
}
function renderGraph() {
  const n = G.fens.length; if (n < 2) { $('r-graph').innerHTML = ''; return; }
  const W = 600, H = 70; let pts = [];
  for (let i = 0; i < n; i++) { const e = G.evals[i]; if (!e) break; pts.push([(i / (n - 1)) * W, H - (whiteWin(e) / 100) * H]); }
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect width="${W}" height="${H}" fill="#403d39"/>`;
  if (pts.length > 1) svg += `<path d="M0,${H} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)},${H} Z" fill="#eceae4"/>`;
  svg += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="rgba(128,128,128,.6)" stroke-width="1"/>`;
  G.cls.forEach((r, k) => {
    if (!r || !['blunder', 'mistake', 'brilliant', 'great', 'miss'].includes(r.c) || !pts[k + 1]) return;
    svg += `<circle cx="${pts[k + 1][0]}" cy="${pts[k + 1][1]}" r="4.5" fill="${CLS[r.c].color}" stroke="#111" stroke-width="1"/>`;
  });
  const x = (ply / (n - 1)) * W;
  svg += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="#d6ad5b" stroke-width="2.5"/></svg>`;
  $('r-graph').innerHTML = svg;
}
function renderSummary() {
  const el = $('r-summary');
  if (!G.acc) { el.innerHTML = `<div class="r-sumhead"><span>${esc(G.white)}</span><span>Accuracy</span><span>${esc(G.black)}</span></div><p class="r-wait">Accuracy appears when the analysis finishes.</p>`; return; }
  const f = (v) => (v == null ? '–' : v.toFixed(1));
  let rows = '';
  for (const c of SUMMARY_ORDER) {
    const a = G.counts.w[c] || 0, b = G.counts.b[c] || 0; const info = CLS[c];
    rows += `<div class="r-row"><b class="${a ? '' : 'z'}" style="color:${info.color}">${a}</b><span><i style="background:${info.color}">${info.icon}</i>${info.label}</span><b class="${b ? '' : 'z'}" style="color:${info.color}">${b}</b></div>`;
  }
  el.innerHTML = `<div class="r-sumhead"><span>${esc(G.white)}</span><span>Accuracy</span><span>${esc(G.black)}</span></div>
    <div class="r-accrow"><b class="r-accw">${f(G.acc.w)}</b><span>${engineInfo ? esc(engineInfo.name) : ''}</span><b class="r-accb">${f(G.acc.b)}</b></div>${rows}`;
}
window.__kingsideReview = { get G() { return G; }, get ply() { return ply; }, go, analyzer };

// achievements: a brilliant move by the player whose side the board faces (your own games)
function reviewDone() {
  try {
    if (!G || !G.mine || !G.cls) return;
    const meWhite = G.orient === 'w';
    const found = G.cls.some((r, k) => r && r.c === 'brilliant' && (k % 2 === 0) === meWhite && (G.startTurn ? G.startTurn === 'w' : true));
    if (found) Progress.record('brilliant');
  } catch (e) { /* never break the review */ }
}
