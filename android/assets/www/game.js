import { Chess } from './vendor/chess.js';
import { pieceUrl } from './board.js';
import { Engine, fallbackMove } from './engine.js';
import * as Progress from './progress.js';
import * as I18n from './i18n.js';
import { Sound } from './sound.js';
import * as Net from './online.js';
import * as Tourney from './tourney.js';
import * as Review from './review.js';
import * as Puzzles from './puzzles.js';
import * as Learn from './learn.js';
import * as Account from './account.js';
import * as Bots from './bots.js';
import * as Share from './share.js';
import * as Streak from './streak.js';
import * as Crowns from './crowns.js';
import { loadOpenings, openingFor, ready as openingsReady } from './openings.js';

const STORE = 'kingside-chess-v1';
const PREFS = 'kingside-chess-prefs-v1';
const $ = (id) => document.getElementById(id);
const FILES = 'abcdefgh';
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// 10 levels, beginner to full strength (ratings are rough chess.com-style estimates).
// 1-5 play "humanly": the engine's top moves, picked with odds that fall off with how bad they are, plus slips.
const LEVELS = {
  1:  { name: 'Beginner',     elo: '~250',  cfg: { multipv: 8, depth: 1, temp: 260, blunder: 0.2, random: 0.3 } },
  2:  { name: 'Novice',       elo: '~500',  cfg: { multipv: 6, depth: 2, temp: 170, blunder: 0.1, random: 0.08 } },
  3:  { name: 'Casual',       elo: '~800',  cfg: { multipv: 5, depth: 3, temp: 110, blunder: 0.05 } },
  4:  { name: 'Club',         elo: '~1100', cfg: { multipv: 4, depth: 5, temp: 65, blunder: 0.025 } },
  5:  { name: 'Intermediate', elo: '~1400', cfg: { multipv: 3, depth: 8, temp: 35, blunder: 0.01 } },
  6:  { name: 'Advanced',     elo: '~1700', cfg: { elo: 1650, movetime: 500 } },
  7:  { name: 'Expert',       elo: '~2000', cfg: { elo: 1950, movetime: 700 } },
  8:  { name: 'Master',       elo: '~2300', cfg: { elo: 2300, movetime: 900 } },
  9:  { name: 'Grandmaster',  elo: '~2700', cfg: { skill: 20, movetime: 1000 } },
  10: { name: 'Maximum',      elo: '3000+', cfg: { skill: 20, movetime: 2500 } },
};
const OLD_LEVEL = { 1: 1, 2: 3, 3: 4, 4: 6, 5: 8, 6: 10 }; // saved games from before v1.4 (6 levels)
const levelOf = (n) => LEVELS[n] || LEVELS[4];
// v1.7: the computer is a named bot (settings.bot) or a plain level (settings.bot = null)
const curBot = () => (settings.mode === 'ai' && settings.bot ? Bots.botById(settings.bot) : null);
const aiName = () => { const b = curBot(); return b ? b.name : 'Stockfish'; };
const aiFull = () => { const b = curBot(); return b ? `${b.name} (bot ~${b.elo})` : `Stockfish (${levelOf(settings.level).name})`; };
const aiLevel = () => { const b = curBot(); return b ? b.lvl : settings.level; };
const TCS = { 'none': null, '1+0': [1, 0], '2+1': [2, 1], '3+2': [3, 2], '5+0': [5, 0], '10+0': [10, 0], '15+10': [15, 10] };

/* ---------------- state ---------------- */
const chess = new Chess();
let settings = { mode: 'ai', level: 4, lv: 2, color: 'w', tc: 'none', bot: 'meera' };   // color: player's colour in ai mode
let prefs = { theme: 'emerald', pieces: 'classic', dests: true, coords: true, autoflip: false, sound: true, premove: true, name: '' };
let orientation = 'w';
let clock = null;          // { w, b, inc, running, turnStart }
let result = null;         // { winner: 'w'|'b'|null, reason }
let selected = null;
let legalFrom = [];        // verbose moves from selected
let hintMove = null;
let thinking = false;
let gen = 0;               // bumps on every position change to invalidate engine answers
let pendingPromo = null;
// online play: { code, tok, color, state, ver, game, offset, run, conn, pending, abort }
let online = null;
const pieceEls = new Map(); // square -> element
const squareEls = new Map();

const engine = new Engine();
// v1.9: Chrome refuses (and logs an error for) vibration before the first tap; skip it quietly until then
if (navigator.vibrate && navigator.userActivation) { const vib = navigator.vibrate.bind(navigator); try { navigator.vibrate = (p) => (navigator.userActivation.hasBeenActive ? vib(p) : false); } catch (e) { /* read-only: leave it */ } }
const sound = new Sound();

/* ---------------- persistence ---------------- */
function save() {
  if (settings.mode === 'online') return;
  try {
    const moves = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    let c = null;
    if (clock) {
      c = { w: clock.w, b: clock.b, inc: clock.inc, started: clock.started };
      if (clock.running) c[chess.turn()] = Math.max(0, clock[chess.turn()] - (performance.now() - clock.turnStart));
    }
    localStorage.setItem(STORE, JSON.stringify({ v: 1, settings, moves, clock: c, result, orientation }));
  } catch (e) { /* storage full or blocked */ }
}
function savePrefs() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {} }
function load() {
  try { const p = JSON.parse(localStorage.getItem(PREFS) || 'null'); if (p) prefs = { ...prefs, ...p }; } catch (e) {}
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s || s.v !== 1) return false;
    const old = s.settings && !s.settings.lv;
    settings = { ...settings, ...s.settings, lv: 2 };
    if (old) settings.level = OLD_LEVEL[settings.level] || 4;
    if (!LEVELS[settings.level]) settings.level = 4;
    if (s.settings && !('bot' in s.settings)) settings.bot = null; // a v1.6 game in progress stays a plain level
    if (settings.bot !== undefined && settings.bot !== null && !Bots.botById(settings.bot)) settings.bot = null;
    for (const uci of s.moves || []) {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    }
    orientation = s.orientation || 'w';
    result = s.result || null;
    if (s.clock) clock = { w: s.clock.w, b: s.clock.b, inc: s.clock.inc, started: s.clock.started, running: false, turnStart: 0 };
    return true;
  } catch (e) { chess.reset(); return false; }
}

/* ---------------- geometry ---------------- */
function sqToRC(sq) {
  const f = FILES.indexOf(sq[0]); const r = +sq[1] - 1;
  return orientation === 'w' ? { row: 7 - r, col: f } : { row: r, col: 7 - f };
}
function rcToSq(row, col) {
  return orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
}
function placeEl(el, sq) {
  const { row, col } = sqToRC(sq);
  el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
}
function squareAtPoint(x, y) {
  const r = $('board').getBoundingClientRect();
  const col = Math.floor(((x - r.left) / r.width) * 8);
  const row = Math.floor(((y - r.top) / r.height) * 8);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return rcToSq(row, col);
}

/* ---------------- board rendering ---------------- */
function buildSquares() {
  const wrap = $('squares');
  wrap.innerHTML = '';
  squareEls.clear();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = rcToSq(row, col);
      const d = document.createElement('div');
      const dark = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      d.className = 'sq ' + (dark ? 'dark' : 'light');
      d.dataset.square = sq;
      d.setAttribute('role', 'gridcell');
      d.setAttribute('aria-label', sq);
      if (col === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
      if (row === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
      wrap.appendChild(d);
      squareEls.set(sq, d);
    }
  }
}

function currentPieces() {
  const map = new Map();
  for (const rank of chess.board()) for (const p of rank) if (p) map.set(p.square, p.color + p.type.toUpperCase());
  return map;
}

function renderPieces(animate) {
  const layer = $('pieces');
  const next = currentPieces();
  const removed = []; const added = [];
  for (const [sq, el] of pieceEls) {
    if (next.get(sq) === el.dataset.code) continue;
    removed.push([sq, el]);
  }
  for (const [sq, code] of next) {
    const el = pieceEls.get(sq);
    if (el && el.dataset.code === code) continue;
    added.push([sq, code]);
  }
  for (const [sq] of removed) pieceEls.delete(sq);
  const dist = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
  const pick = (sq, test) => {
    let best = -1, bd = 99;
    removed.forEach(([rsq, el], i) => { if (test(el.dataset.code)) { const d = dist(rsq, sq); if (d < bd) { bd = d; best = i; } } });
    return best >= 0 ? removed.splice(best, 1)[0] : null;
  };
  const leftover = [];
  for (const [sq, code] of added) {
    const hit = pick(sq, (c) => c === code);
    if (hit) { setPos(hit[1], sq, code, animate); } else leftover.push([sq, code]);
  }
  for (const [sq, code] of leftover) {
    // promotion (or un-promotion on undo): slide the pawn/piece of the same colour
    const hit = pick(sq, (c) => c[0] === code[0] && (c[1] === 'P' || code[1] === 'P'));
    if (hit) { setPos(hit[1], sq, code, animate); continue; }
    const el = document.createElement('div');
    el.className = 'piece instant ' + code;
    el.dataset.code = code;
    placeEl(el, sq);
    layer.appendChild(el);
    pieceEls.set(sq, el);
    if (animate) { el.style.opacity = '0'; requestAnimationFrame(() => { el.classList.remove('instant'); el.style.opacity = ''; }); }
    else requestAnimationFrame(() => el.classList.remove('instant'));
  }
  for (const [, el] of removed) {
    if (animate) { el.style.zIndex = '1'; el.classList.add('fade'); setTimeout(() => el.remove(), 220); }
    else el.remove();
  }
  function setPos(el, sq, code, anim) {
    pieceEls.set(sq, el);
    el.classList.toggle('instant', !anim);
    placeEl(el, sq);
    if (el.dataset.code !== code) {
      const old = el.dataset.code;
      const swap = () => { el.classList.remove(old); el.classList.add(code); };
      el.dataset.code = code;
      anim ? setTimeout(swap, 150) : swap();
    }
    if (!anim) requestAnimationFrame(() => el.classList.remove('instant'));
  }
}

function rebuildPieces() {
  for (const el of pieceEls.values()) el.remove();
  pieceEls.clear();
  renderPieces(false);
}

function renderHighlights() {
  const hist = chess.history({ verbose: true });
  const last = hist[hist.length - 1];
  let checkSq = null;
  if (chess.inCheck()) {
    const k = chess.turn() + 'K';
    for (const [sq, c] of currentPieces()) if (c === k) checkSq = sq;
  }
  const dests = new Map(legalFrom.map((m) => [m.to, m]));
  for (const [sq, el] of squareEls) {
    el.classList.toggle('last', !!last && (sq === last.from || sq === last.to));
    el.classList.toggle('sel', sq === selected);
    el.classList.toggle('check', sq === checkSq);
    const dm = prefs.dests ? dests.get(sq) : null;
    el.classList.toggle('dest', !!dm);
    el.classList.toggle('cap', !!dm && (dm.flags.includes('c') || dm.flags.includes('e')));
    el.classList.toggle('hint', !!hintMove && (sq === hintMove.from || sq === hintMove.to));
    el.classList.toggle('pre', !!premove && (sq === premove.from || sq === premove.to) || sq === preSel);
    el.classList.toggle('umark', userMarks.has(sq));
  }
  renderArrow();
}

function renderArrow() {
  const svg = $('arrows');
  let s = '';
  if (hintMove) s += arrowSvg(hintMove.from, hintMove.to, 'rgba(60,140,255,.9)');
  for (const a of userArrows) s += arrowSvg(a.from, a.to, 'rgba(240,160,40,.92)');
  if (arrowDraw && arrowDraw.to !== arrowDraw.from) s += arrowSvg(arrowDraw.from, arrowDraw.to, 'rgba(240,160,40,.65)');
  svg.innerHTML = s;
}

/* ---------------- players / captured / moves ---------------- */
function aiColor() { return settings.color === 'w' ? 'b' : 'w'; }
function isHumanTurn() {
  if (result) return false;
  if (settings.mode === 'pvp') return true;
  if (settings.mode === 'online') return !!online && !!online.state && online.state.status === 'active' && chess.turn() === online.color && !online.pending;
  return chess.turn() === settings.color && !thinking;
}

function renderPlayers() {
  const bottomColor = orientation;
  const topColor = orientation === 'w' ? 'b' : 'w';
  const label = (c) => {
    if (settings.mode === 'online') return onlineLabel(c);
    if (settings.mode === 'pvp') return c === 'w' ? 'White' : 'Black';
    if (c === aiColor()) { const b = curBot(); if (b) return `<span data-i18n-skip>${escapeHtml(b.name)}</span> <small>${escapeHtml(Bots.t(b.tag))} · ~${b.elo}</small>`; const L = levelOf(settings.level); return `Stockfish <small>${L.name} · ${L.elo}</small>`; }
    const u = Account.user();
    return u ? `${escapeHtml(u.display || u.uname)}` : 'You';
  };
  // avatars: the engine is a knight; people get their initial on a coloured tile
  const avatar = (c, el) => {
    let letter = '';
    if (settings.mode === 'ai' && c !== aiColor()) { const u = Account.user(); letter = u ? (u.display || u.uname)[0] : ''; }
    else if (settings.mode === 'online' && online && online.state) letter = (online.state.names[c] || '')[0] || '';
    const bot = settings.mode === 'ai' && c === aiColor();
    const persona = bot && curBot();
    // v1.8.2: your own worn avatar (Crown Shop) instead of your initial
    const me = (settings.mode === 'ai' && c !== aiColor()) || (settings.mode === 'online' && online && c === online.color);
    const cos = me && Account.user() && Account.user().cos;
    if (cos && cos.avatar) letter = cos.avatar;
    el.className = 'avatar ' + (persona ? 'av-persona' : bot ? 'av-bot' : cos && cos.avatar ? 'av-letter av-emoji-tile' : letter ? 'av-letter av-' + (letter.toUpperCase().charCodeAt(0) % 6) : 'av-piece');
    el.textContent = bot ? '' : cos && cos.avatar ? letter : letter.toUpperCase();
    el.style.backgroundImage = persona ? `url(${Bots.avatarUrl(persona)})` : bot ? `url(pieces/${c}N.svg)` : letter ? '' : `url(pieces/${c}K.svg)`;
  };
  $('name-top').innerHTML = label(topColor);
  $('name-bottom').innerHTML = label(bottomColor);
  avatar(topColor, $('avatar-top'));
  avatar(bottomColor, $('avatar-bottom'));
  $('player-top').classList.toggle('thinking', thinking && aiColor() === topColor);
  $('player-bottom').classList.toggle('thinking', thinking && aiColor() === bottomColor);

  // captured pieces by each side, from the move history
  const caps = { w: [], b: [] };
  for (const m of chess.history({ verbose: true })) if (m.captured) caps[m.color].push(m.captured);
  let mat = 0;
  for (const rank of chess.board()) for (const p of rank) if (p) mat += (p.color === 'w' ? 1 : -1) * VALUES[p.type];
  const order = 'pnbrq';
  const html = (c) => {
    const list = caps[c].slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const opp = c === 'w' ? 'b' : 'w';
    let out = '', prev = null;
    for (const t of list) { out += `<img src="pieces/${opp}${t.toUpperCase()}.svg" alt="${t}"${prev && prev !== t ? ' class="gap"' : ''}>`; prev = t; }
    const adv = c === 'w' ? mat : -mat;
    if (adv > 0) out += `<span class="adv">+${adv}</span>`;
    return out;
  };
  $('captured-top').innerHTML = html(topColor);
  $('captured-bottom').innerHTML = html(bottomColor);
  renderClocks();
}

function renderMoves() {
  const ol = $('moves');
  const hist = chess.history();
  if (!hist.length) { ol.innerHTML = '<li><span class="empty">No moves yet. White to play.</span></li>'; $('opening').textContent = ''; return; }
  let out = '';
  for (let i = 0; i < hist.length; i += 2) {
    const n = i / 2 + 1;
    out += `<li><span class="n">${n}.</span><span class="m${i === hist.length - 1 ? ' cur' : ''}">${hist[i]}</span><span class="m${i + 1 === hist.length - 1 ? ' cur' : ''}">${hist[i + 1] || ''}</span></li>`;
  }
  ol.innerHTML = out;
  ol.scrollTop = ol.scrollHeight; ol.scrollLeft = ol.scrollWidth;
  $('opening').textContent = openingName(hist);
}

const OPENINGS = [
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy Lopez'], ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'], ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nf6', 'Petrov Defence'], ['e4 e5 f4', "King's Gambit"], ['e4 e5 Nc3', 'Vienna Game'], ['e4 e5', "King's Pawn Game"],
  ['e4 c5', 'Sicilian Defence'], ['e4 e6', 'French Defence'], ['e4 c6', 'Caro-Kann Defence'], ['e4 d5', 'Scandinavian Defence'],
  ['e4 Nf6', "Alekhine's Defence"], ['e4 d6', 'Pirc Defence'], ['e4 g6', 'Modern Defence'],
  ['d4 d5 c4 e6', "Queen's Gambit Declined"], ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"], ['d4 d5 c4 c6', 'Slav Defence'],
  ['d4 d5 c4', "Queen's Gambit"], ['d4 d5 Bf4', 'London System'], ['d4 Nf6 Bf4', 'London System'], ['d4 Nf6 c4 g6', "King's Indian Defence"],
  ['d4 Nf6 c4 e6', 'Indian Defence'], ['d4 f5', 'Dutch Defence'], ['d4 d5', "Queen's Pawn Game"], ['d4 Nf6', 'Indian Defence'],
  ['c4', 'English Opening'], ['Nf3', 'Réti Opening'], ['f4', "Bird's Opening"], ['g3', "King's Fianchetto"], ['b3', 'Larsen Opening'],
];
function openingName(hist) {
  if (openingsReady()) {
    const op = openingFor(chess.history({ verbose: true }).map((m) => m.after));
    if (op) return op.name;
  } else loadOpenings().then((d) => { if (d) renderMoves(); });
  const line = hist.slice(0, 10).join(' ');
  for (const [seq, name] of OPENINGS) if (line === seq || line.startsWith(seq + ' ')) return name;
  return '';
}

/* ---------------- status ---------------- */
function renderStatus() {
  const st = $('status'), sub = $('substatus');
  st.className = 'status';
  const side = (c) => (c === 'w' ? 'White' : 'Black');
  if (settings.mode === 'online') { renderOnlineStatus(); return; }
  if (result) {
    const r = result;
    let text;
    if (!r.winner) text = 'Draw';
    else if (settings.mode === 'ai') text = r.winner === settings.color ? 'You won!' : `${aiName()} won`;
    else text = side(r.winner) + ' wins';
    st.textContent = text;
    st.classList.add(!r.winner ? 'draw' : settings.mode === 'ai' ? (r.winner === settings.color ? 'win' : 'loss') : 'win');
    sub.textContent = reasonText(r);
  } else if (thinking) {
    st.textContent = `${aiName()} is thinking…`;
    sub.textContent = engine.failed ? 'Using the backup engine' : !engine.ready ? `Loading the engine… ${Math.round((engine.progress || 0) * 100)}%` : curBot() ? `${curBot().name} · ~${curBot().elo}` : levelOf(settings.level).name + ' level';
  } else {
    const check = chess.inCheck() ? ' — Check!' : '';
    if (settings.mode === 'ai') st.textContent = (chess.turn() === settings.color ? 'Your move' : `${aiName()} to move`) + check;
    else st.textContent = side(chess.turn()) + ' to move' + check;
    sub.textContent = !engine.ready && settings.mode === 'ai' && !engine.failed ? `Loading the engine… ${Math.round((engine.progress || 0) * 100)}%` : hintMove ? 'Hint: ' + hintMove.san : chess.history().length ? '' : 'Drag a piece or tap it, then tap a square';
  }
  $('btn-undo').disabled = chess.history().length === 0;
  $('btn-resign').disabled = !!result || chess.history().length === 0;
  $('btn-hint').disabled = !!result || thinking;
}
function reasonText(r) {
  const side = (c) => (c === 'w' ? 'White' : 'Black');
  switch (r.reason) {
    case 'checkmate': return 'by checkmate';
    case 'resign': return side(r.loser) + ' resigned';
    case 'timeout': return r.winner ? side(r.loser) + ' ran out of time' : 'Time out vs insufficient material';
    case 'stalemate': return 'by stalemate';
    case 'threefold': return 'by threefold repetition';
    case 'fifty': return 'by the 50-move rule';
    case 'material': return 'by insufficient material';
    case 'agreement': return 'by agreement';
    case 'forfeit': return r.winner ? side(r.loser) + ' forfeited' : 'by forfeit';
    case 'admin': return 'result set by the organizer';
    case 'aborted': return 'game aborted';
    case 'ended': return 'the tournament was ended';
    default: return '';
  }
}

function render(animate) {
  renderPieces(animate);
  renderHighlights();
  renderPlayers();
  renderMoves();
  renderStatus();
}

/* ---------------- game flow ---------------- */
function checkGameOver() {
  if (chess.isCheckmate()) return { winner: chess.turn() === 'w' ? 'b' : 'w', loser: chess.turn(), reason: 'checkmate' };
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'material' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'threefold' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' };
  return null;
}


function recordFinished(r) {
  try {
    const moves = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
    if (moves.length < 2) return;
    const res = r.winner === 'w' ? '1-0' : r.winner === 'b' ? '0-1' : '1/2-1/2';
    let key, g;
    if (settings.mode === 'online' && online && online.state) {
      key = 'room:' + online.code + ':' + (online.state.game || 1);
      const n = online.state.names || {};
      g = { source: online.state.t ? 'tournament' : online.state.quick ? 'quick' : 'online', white: n.w || 'White', black: n.b || 'Black', color: online.color, tc: online.state.tc };
    } else {
      key = 'local:' + moves.join('').slice(0, 60) + ':' + moves.length;
      const me = prefs.name || 'You';
      g = settings.mode === 'ai' ? { source: 'ai', color: settings.color, white: settings.color === 'w' ? me : aiFull(), black: settings.color === 'b' ? me : aiFull(), tc: settings.tc }
        : { source: 'pvp', color: 'w', white: 'White', black: 'Black', tc: settings.tc };
    }
    const done = JSON.parse(localStorage.getItem('kingside-saved-v1') || '[]');
    if (done.includes(key)) return;
    localStorage.setItem('kingside-saved-v1', JSON.stringify([key, ...done].slice(0, 80)));
    Account.saveGame({ ...g, moves, result: res, reason: r.reason });
    // streak day + achievements (2-player games on one phone count for the streak, not as wins)
    const mode = settings.mode === 'online' ? 'online' : settings.mode;
    Progress.record('game', { plies: moves.length, mode, level: aiLevel(), win: mode !== 'pvp' && !!r.winner && r.winner === g.color });
    renderStreak();
    // v1.8 Crowns: the server replays the game and pays a real win (online games are paid by the game server itself)
    if (mode === 'online') Crowns.onlineDone();
    else Crowns.gameFinished({ moves: moves.join(' '), mode: mode === 'pvp' ? 'pvp' : 'ai', bot: curBot() ? curBot().id : null, level: settings.level, color: g.color, result: res, reason: r.reason });
  } catch (e) { /* history is a bonus; never break the game */ }
}

function finish(r) {
  result = r; premove = null; preSel = null;
  recordFinished(r);
  thinking = false;
  engine.cancel();
  if (clock) clock.running = false;
  selected = null; legalFrom = []; hintMove = null;
  render(false);
  save();
  sound.play('end');
  setTimeout(showResult, 650);
  if (settings.mode === 'online') setTimeout(() => Account.refreshMe(true), 800); // rated result: fresh rating for the home card
  const bot = curBot();
  if (bot) { const k = !r.winner ? 'draw' : r.winner === aiColor() ? 'win' : 'lose'; setTimeout(() => botSay(Bots.line(bot, k), 5000), 300); }
}

function showResult() {
  if (!result) return;
  const r = result;
  let title, icon;
  if (!r.winner) { title = 'Draw'; icon = `pieces/${settings.mode === 'ai' ? settings.color : settings.mode === 'online' && online ? online.color : 'w'}K.svg`; }
  else if (settings.mode === 'online' && online) { title = r.winner === online.color ? 'You won! 🎉' : `${oppName()} wins`; icon = `pieces/${r.winner}K.svg`; }
  else if (settings.mode === 'ai') { title = r.winner === settings.color ? 'You won! 🎉' : `${aiName()} wins`; icon = `pieces/${r.winner}K.svg`; }
  else { title = (r.winner === 'w' ? 'White' : 'Black') + ' wins'; icon = `pieces/${r.winner}K.svg`; }
  if (!r.winner && settings.mode === 'online' && online && online.state && online.state.t && online.state.t.arma) { title = online.color === 'b' ? 'Draw — you go through! 🎉' : 'Draw — Black goes through'; icon = 'pieces/bK.svg'; }
  $('result-title').textContent = title;
  const moves = Math.ceil(chess.history().length / 2);
  $('result-text').textContent = `${reasonText(r).replace(/^by /, 'By ')} · ${moves} move${moves === 1 ? '' : 's'}`;
  $('result-icon').style.backgroundImage = `url(${icon})`;
  const mine = settings.mode === 'online' && online ? online.color : settings.mode === 'ai' ? settings.color : r.winner;
  $('sheet-result').firstElementChild.dataset.out = !r.winner ? 'draw' : r.winner === mine ? 'win' : 'loss';
  renderResultActions();
  renderResultRating();
  openSheet('sheet-result');
}
// v1.7: the rating change of a rated online game, under the result.
// v1.9: "+8" green / "−12" red, the new rating counts up, the rank badge, and a "Promoted to Gold!" moment.
async function renderResultRating() {
  const el = $('result-rating'); el.hidden = true; el.innerHTML = ''; el.className = 'result-rating';
  if (settings.mode === 'ai') { el.hidden = false; el.innerHTML = '<span class="rr-casual">Unrated · games against bots don’t change your rating</span>'; return; }
  if (settings.mode !== 'online' || !online || !online.state || online.state.t) return;
  const st = online.state, code = online.code, game = st.game || 1, me = online.color;
  if (!st.rated || !st.uids || !st.uids.w || !st.uids.b) { el.hidden = false; el.innerHTML = '<span class="rr-casual">Casual game · ratings unchanged</span>'; return; }
  for (let i = 0; i < 6; i++) {
    let d = null; try { d = await Account.api(`u/rres?code=${code}&game=${game}`); } catch (e) { return; }
    if (!online || online.code !== code) return;
    if (d.found) {
      if (!d.rated || !d[me]) { el.hidden = false; el.innerHTML = '<span class="rr-casual">Not rated: games ended before move 2 count for nobody</span>'; return; }
      showRatingChange(el, d.pool, d[me], d.id);
      Account.refreshMe(true);
      return;
    }
    await new Promise((res) => setTimeout(res, 700));
  }
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function showRatingChange(el, pool, x, gid) {
  const R = Account.Ranks;
  const now = { r: x.r1, p: x.p }, before = { r: x.r0, p: x.p0 == null ? x.p : x.p0 };
  const up = x.d > 0, down = x.d < 0;
  el.hidden = false; el.classList.add('rr-v19');
  el.innerHTML = `<div class="rr-row"><span class="rr-pool">${Account.poolName(pool)} rating</span>
      <b class="rr-num" data-i18n-skip>${x.r0}</b><span class="rr-q" data-i18n-skip>${x.p ? '?' : ''}</span>
      <span class="rr-d ${up ? 'up' : down ? 'down' : ''}" data-i18n-skip>${up ? '+' : down ? '−' : '±'}${Math.abs(x.d)}</span></div>
    <div class="rr-rank">${R.rankBadge(now)}${x.p ? '<small class="a-muted">Your rank shows once the rating settles</small>' : rankHint(now)}</div>`;
  el.classList.remove('rr-pop'); void el.offsetWidth; el.classList.add('rr-pop');
  // count up (or down) from the old rating to the new one
  const num = el.querySelector('.rr-num'), t0 = performance.now(), dur = Math.min(1400, 500 + Math.abs(x.d) * 35);
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = (t) => {
    const k = reduce ? 1 : Math.min(1, (t - t0) / dur);
    num.textContent = String(Math.round(x.r0 + (x.r1 - x.r0) * easeOut(k)));
    if (k < 1) requestAnimationFrame(step); else { num.classList.add('rr-done'); maybeRankUp(pool, before, now, gid); }
  };
  setTimeout(() => requestAnimationFrame(step), reduce ? 0 : 350);
}
function rankHint(x) {
  const nx = Account.Ranks.nextRank(x);
  return nx ? `<small class="a-muted rr-next">${nx.min - x.r} to ${nx.name}</small>` : '';
}
// promoted (a higher rank than before) or placed (the rating just settled): a short celebration, once per game
function maybeRankUp(pool, before, now, gid) {
  const R = Account.Ranks, a = R.rankOf(before), b = R.rankOf(now);
  if (!b) return;
  const placed = !a && before.p && !now.p;
  const promoted = a && R.RANKS.indexOf(b) > R.RANKS.indexOf(a);
  if (!placed && !promoted) return;
  const key = 'kingside-rankup-' + (gid || pool + now.r);
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) { /* private mode: show anyway */ }
  showRankUp(b, pool, now.r, placed);
}
export function showRankUp(rk, pool, r, placed) {
  const R = Account.Ranks;
  let ov = $('rank-up');
  if (!ov) { ov = document.createElement('div'); ov.id = 'rank-up'; ov.className = 'rank-up'; ov.setAttribute('role', 'alertdialog'); document.body.appendChild(ov); }
  const conf = [...Array(28)].map((_, i) => `<i style="--x:${(Math.random() * 2 - 1).toFixed(2)};--d:${(0.15 + Math.random() * 0.5).toFixed(2)}s;--c:${['#f3c64d', '#8fc552', rk.c, '#ff7a6b', '#7cb8ff', '#fff'][i % 6]};--r:${Math.round(Math.random() * 360)}deg"></i>`).join('');
  ov.innerHTML = `<div class="ru-conf" aria-hidden="true">${conf}</div><div class="ru-card rk-${rk.id}" style="--rc:${rk.c}">
    <div class="ru-glow" aria-hidden="true"></div><div class="ru-icon">${R.rankIcon(rk, 104)}</div>
    <p class="ru-kicker">${placed ? 'Placement complete' : 'Rank up!'}</p>
    <h2>${placed ? `You’re ${rk.name}!` : `Promoted to ${rk.name}!`}</h2>
    <p class="ru-sub"><span>${Account.poolName(pool)}</span> <b data-i18n-skip>${r}</b></p>
    <button type="button" class="btn btn-gold" id="ru-ok">Nice!</button></div>`;
  ov.hidden = false; ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
  try { sound.play('rankup'); } catch (e) { /* no sound */ }
  try { navigator.vibrate && navigator.vibrate([30, 60, 30]); } catch (e) { /* no vibration */ }
  const close = () => { ov.classList.remove('show'); setTimeout(() => { ov.hidden = true; }, 250); };
  ov.onclick = (e) => { if (e.target.id === 'ru-ok' || e.target === ov) close(); };
}
// v1.7: a bot says something (start / end of the game) in a bubble under its name
let sayTimer = null;
function botSay(text, ms = 4500) {
  if (!text || settings.mode !== 'ai') return;
  const pop = $('chat-pop'); if (!pop) return;
  pop.textContent = text; pop.hidden = false; pop.classList.add('bot-say'); pop.setAttribute('data-i18n-skip', '');
  clearTimeout(sayTimer); sayTimer = setTimeout(() => { pop.hidden = true; pop.classList.remove('bot-say'); }, ms);
}
// v1.7: what the share sheet needs for the game on the board
function shareInfo() {
  const moves = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  const r = result; const res = r ? (r.winner === 'w' ? '1-0' : r.winner === 'b' ? '0-1' : '1/2-1/2') : '*';
  let white = 'White', black = 'Black', wr = '', br = '', source = settings.mode;
  const u = Account.user();
  if (settings.mode === 'ai') {
    const b = curBot(); const me = (u && (u.display || u.uname)) || prefs.name || 'You';
    const ai = b ? b.name : `Stockfish ${levelOf(settings.level).name}`; const aiR = b ? '~' + b.elo : levelOf(settings.level).elo;
    if (settings.color === 'w') { white = me; black = ai; br = aiR; } else { black = me; white = ai; wr = aiR; }
    source = b ? 'bot' : 'ai';
  } else if (settings.mode === 'online' && online && online.state) {
    const st = online.state; white = st.names.w || 'White'; black = st.names.b || 'Black';
    const rr = (c) => { const x = st.rt && st.uids && st.uids[c] && st.rt.u[st.uids[c]]; return x ? `${x.r}${x.p ? '?' : ''}` : ''; };
    wr = rr('w'); br = rr('b'); source = st.t ? 'tournament' : st.quick ? 'quick' : 'online';
  }
  const hist = chess.history();
  return { moves, white, black, wr, br, result: res, reason: r ? r.reason : '', opening: openingName(hist) || '', source, tc: settings.mode === 'online' && online && online.state ? online.state.tc : settings.tc,
    orientation: settings.mode === 'online' && online ? online.color : settings.mode === 'ai' ? settings.color : orientation };
}
function shareFromReview() {
  const g0 = Review.current(); if (!g0) return;
  const res = g0.result === '½-½' ? '1/2-1/2' : ['1-0', '0-1', '1/2-1/2'].includes(g0.result) ? g0.result : '*';
  Share.open({ moves: g0.moves, white: g0.white || 'White', black: g0.black || 'Black', wr: g0.wr || '', br: g0.br || '', result: res, reason: g0.reason || '', opening: '', source: 'review', orientation: g0.orientation || 'w' });
}

function makeMove(m, { animate = true, remote = false } = {}) {
  let mv;
  try { mv = chess.move(m); } catch (e) { return null; }
  if (!mv) return null;
  gen++;
  userArrows = []; userMarks.clear();
  if (settings.mode === 'online') {
    selected = null; legalFrom = []; hintMove = null;
    render(animate);
    playMoveSound(mv);
    if (!remote) sendOnlineMove(mv);
    if (remote && premove) setTimeout(tryPremove, 60);
    return mv;
  }
  // clock
  if (clock) {
    const now = performance.now();
    if (clock.running) {
      clock[mv.color] -= now - clock.turnStart;
      clock[mv.color] += clock.inc;
    }
    clock.started = true;
    clock.running = true;
    clock.turnStart = now;
  }
  selected = null; legalFrom = []; hintMove = null;
  if (settings.mode === 'pvp' && prefs.autoflip && orientation !== chess.turn()) {
    orientation = chess.turn();
    buildSquares(); rebuildPieces();
  }
  render(animate);
  playMoveSound(mv);
  const over = checkGameOver();
  if (over) { finish(over); return mv; }
  save();
  if (premove && settings.mode === 'ai' && mv.color === aiColor()) setTimeout(tryPremove, 60);
  maybeEngineMove();
  return mv;
}

function playMoveSound(mv) {
  if (chess.isCheckmate()) { /* end sound plays in finish */ }
  else if (chess.inCheck()) sound.play('check');
  else if (mv.flags.includes('k') || mv.flags.includes('q')) sound.play('castle');
  else if (mv.captured) sound.play('capture');
  else if (mv.promotion) sound.play('promote');
  else sound.play('move');
}

async function maybeEngineMove() {
  if (settings.mode !== 'ai' || result || chess.turn() !== aiColor()) return;
  thinking = true;
  renderStatus(); renderPlayers();
  const myGen = gen;
  const fen = chess.fen();
  const bot = curBot();
  const L = levelOf(settings.level).cfg;
  const t0 = performance.now();
  let uci = null;
  // engine still downloading: give it a little while, then play with the backup engine
  const ask = async (f, cfg) => {
    if (engine.ready || engine.failed) return engine.bestMove(f, cfg);
    const u = await Promise.race([engine.bestMove(f, cfg), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
    if (u === 'timeout') { if (myGen === gen) engine.cancel(); return null; }
    return u;
  };
  if (bot) {
    // bots: their own opening repertoire, then the engine with their style picking among its candidate moves (bots.js)
    uci = (await Bots.chooseMove(bot, chess, { bestMove: ask })).uci;
    if (myGen !== gen || result) return;
    if (!uci) uci = fallbackMove(Chess, fen, 2);
  } else if (L.random && Math.random() < L.random) {
    uci = randomishMove();
  } else {
    uci = await ask(fen, L);
    if (myGen !== gen || result) return;
    if (!uci) uci = fallbackMove(Chess, fen, 2);
  }
  if (myGen !== gen || result) return;
  const minDelay = 450 + Math.random() * 350;
  const wait = minDelay - (performance.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (myGen !== gen || result) return;
  thinking = false;
  if (uci) makeMove({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  else renderStatus();
}

function randomishMove() {
  // weak play for the lowest levels: random move, but take a free queen if offered
  const moves = chess.moves({ verbose: true });
  const caps = moves.filter((m) => m.captured === 'q');
  const pool = caps.length && Math.random() < 0.5 ? caps : moves;
  const m = pool[Math.floor(Math.random() * pool.length)];
  return m.from + m.to + (m.promotion || '');
}


/* ---------------- premoves + drawn arrows ---------------- */
let premove = null;          // { from, to }
let preSel = null;           // square picked for a premove
let userArrows = [], userMarks = new Set(), arrowDraw = null, longPress = null;
function myColor() {
  if (settings.mode === 'ai') return settings.color;
  if (settings.mode === 'online' && online && online.state && online.state.status === 'active') return online.color;
  return null;
}
function canPremove(c) { return prefs.premove !== false && !result && myColor() === c && chess.turn() !== c; }
function clearPremove() { if (premove || preSel) { premove = null; preSel = null; renderHighlights(); } }
function setPremove(from, to) { premove = { from, to }; preSel = null; renderHighlights(); sound.play('move'); }
function tryPremove() {
  if (!premove || !isHumanTurn()) return;
  const p = premove; premove = null; preSel = null;
  const cand = chess.moves({ square: p.from, verbose: true }).filter((m) => m.to === p.to);
  if (!cand.length) { renderHighlights(); return; }
  makeMove({ from: p.from, to: p.to, promotion: cand.some((m) => m.promotion) ? 'q' : undefined }, { animate: true });
}
function clearDrawn() { if (userArrows.length || userMarks.size) { userArrows = []; userMarks.clear(); renderHighlights(); } }
function arrowSvg(from, to, color) {
  const a = sqToRC(from), b = sqToRC(to);
  const x1 = a.col * 100 + 50, y1 = a.row * 100 + 50, x2 = b.col * 100 + 50, y2 = b.row * 100 + 50;
  const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1);
  const ex = x1 + Math.cos(ang) * (len - 34), ey = y1 + Math.sin(ang) * (len - 34);
  const tx = x1 + Math.cos(ang) * (len - 8), ty = y1 + Math.sin(ang) * (len - 8);
  const sx = x1 + Math.cos(ang) * 22, sy = y1 + Math.sin(ang) * 22;
  const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
  return `<g opacity=".85"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="15"/><polygon points="${tx},${ty} ${ex + px * 26},${ey + py * 26} ${ex - px * 26},${ey - py * 26}" fill="${color}"/></g>`;
}
function startArrow(sq) { arrowDraw = { from: sq, to: sq }; if (drag) onPointerCancel(); select(null); renderArrow(); }
function finishArrow() {
  const a = arrowDraw; arrowDraw = null; if (!a) return;
  if (a.to === a.from) { if (userMarks.has(a.from)) userMarks.delete(a.from); else userMarks.add(a.from); }
  else { const i = userArrows.findIndex((x) => x.from === a.from && x.to === a.to); if (i >= 0) userArrows.splice(i, 1); else userArrows.push({ from: a.from, to: a.to }); }
  renderHighlights();
}

/* ---------------- user input ---------------- */
function canMoveColor(c) {
  if (!isHumanTurn()) return false;
  return chess.turn() === c;
}
function select(sq) {
  selected = sq;
  legalFrom = sq ? chess.moves({ square: sq, verbose: true }) : [];
  renderHighlights();
}
function tryUserMove(from, to) {
  const cands = legalFrom.filter((m) => m.from === from && m.to === to);
  if (!cands.length) return false;
  if (cands.some((m) => m.promotion)) { askPromotion(from, to); return true; }
  sound.unlock();
  makeMove({ from, to }, { animate: true });
  return true;
}

function askPromotion(from, to) {
  const color = chess.turn();
  pendingPromo = { from, to };
  const box = $('promo-choices');
  box.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.backgroundImage = `url(${pieceUrl(color + t.toUpperCase())})`;
    b.setAttribute('aria-label', { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[t]);
    b.dataset.piece = t;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = pendingPromo; pendingPromo = null;
      $('promo').hidden = true;
      if (p) makeMove({ from: p.from, to: p.to, promotion: t }, { animate: true });
    });
    box.appendChild(b);
  }
  $('promo').hidden = false;
  box.querySelector('button').focus({ preventScroll: true });
}
function cancelPromotion() {
  pendingPromo = null;
  $('promo').hidden = true;
  rebuildPieces();
  select(null);
}

let drag = null;
function onPointerDown(e) {
  if (e.button === 2) { const s2 = squareAtPoint(e.clientX, e.clientY); if (s2) { e.preventDefault(); startArrow(s2); try { $('board').setPointerCapture(e.pointerId); } catch (er) {} } return; }
  if (e.button !== undefined && e.button !== 0) return;
  if (pendingPromo) { if (e.target.closest('.promo-card')) return; cancelPromotion(); return; }
  sound.unlock();
  const sq = squareAtPoint(e.clientX, e.clientY);
  if (!sq) return;
  const piece = chess.get(sq);
  clearDrawn();
  clearTimeout(longPress);
  if (e.pointerType !== 'mouse') longPress = setTimeout(() => { if (drag && drag.moved) return; navigator.vibrate && navigator.vibrate(12); startArrow(sq); }, 500);
  // premoves: while the opponent is thinking, pick your piece and a square
  if (preSel && sq !== preSel) { setPremove(preSel, sq); return; }
  if (premove) { clearPremove(); if (!(piece && canPremove(piece.color))) return; }
  if (piece && canPremove(piece.color) && !canMoveColor(piece.color)) {
    e.preventDefault(); preSel = sq; renderHighlights();
    const rect = $('board').getBoundingClientRect();
    drag = { from: sq, el: pieceEls.get(sq), id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, wasSelected: false, rect, over: null, pre: true };
    try { $('board').setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }
  // tap-to-move onto a destination
  if (selected && sq !== selected && legalFrom.some((m) => m.to === sq)) {
    e.preventDefault();
    tryUserMove(selected, sq);
    return;
  }
  if (piece && canMoveColor(piece.color)) {
    e.preventDefault();
    const wasSelected = selected === sq;
    if (hintMove) { hintMove = null; renderStatus(); }
    select(sq);
    const el = pieceEls.get(sq);
    const rect = $('board').getBoundingClientRect();
    drag = { from: sq, el, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, wasSelected, rect, over: null };
    try { $('board').setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }
  if (selected) select(null);
  else if (piece && !result && settings.mode === 'ai' && piece.color === settings.color && thinking) toast(`Wait for ${aiName()} to move`);
  else if (piece && settings.mode === 'online' && online && online.state) {
    const s = online.state;
    if (s.status === 'waiting') toast('Waiting for your friend to join');
    else if (s.status === 'active' && piece.color === online.color && chess.turn() !== online.color) toast(`${oppName()}'s turn`);
  }
}
function onPointerMove(e) {
  if (arrowDraw) { const s2 = squareAtPoint(e.clientX, e.clientY); if (s2 && s2 !== arrowDraw.to) { arrowDraw.to = s2; renderArrow(); } return; }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  clearTimeout(longPress);
  e.preventDefault();
  if (!drag.moved) { drag.moved = true; drag.el && drag.el.classList.add('dragging'); }
  const r = drag.rect, size = r.width / 8;
  if (drag.el) {
    const x = e.clientX - r.left - size / 2, y = e.clientY - r.top - size / 2 - (e.pointerType === 'touch' ? size * 0.35 : 0);
    drag.el.style.transform = `translate(${x}px, ${y}px) scale(${e.pointerType === 'touch' ? 1.25 : 1.08})`;
  }
  const over = squareAtPoint(e.clientX, e.clientY - (e.pointerType === 'touch' ? size * 0.35 : 0));
  if (over !== drag.over) {
    if (drag.over && squareEls.get(drag.over)) squareEls.get(drag.over).classList.remove('over');
    drag.over = over;
    if (over && squareEls.get(over)) squareEls.get(over).classList.add('over');
  }
}
function onPointerUp(e) {
  clearTimeout(longPress);
  if (arrowDraw) { finishArrow(); return; }
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  if (d.over && squareEls.get(d.over)) squareEls.get(d.over).classList.remove('over');
  if (d.el) d.el.classList.remove('dragging');
  if (d.pre) {
    if (d.el) placeEl(d.el, d.from);
    if (d.moved && d.over && d.over !== d.from) setPremove(d.from, d.over);
    return;
  }
  if (!d.moved) {
    if (d.wasSelected) select(null);
    return;
  }
  const target = d.over;
  if (target && target !== d.from && legalFrom.some((m) => m.to === target)) {
    if (d.el) { d.el.classList.add('instant'); placeEl(d.el, target); requestAnimationFrame(() => d.el.classList.remove('instant')); }
    const cands = legalFrom.filter((m) => m.to === target);
    if (cands.some((m) => m.promotion)) { askPromotion(d.from, target); return; }
    makeMove({ from: d.from, to: target }, { animate: false });
    return;
  }
  // snap back
  if (d.el) placeEl(d.el, d.from);
  if (target && target !== d.from) sound.play('illegal');
}
function onPointerCancel() {
  clearTimeout(longPress);
  if (!drag) return;
  if (drag.el) { drag.el.classList.remove('dragging'); placeEl(drag.el, drag.from); }
  if (drag.over && squareEls.get(drag.over)) squareEls.get(drag.over).classList.remove('over');
  drag = null;
}

/* ---------------- clock ---------------- */
function fmt(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) { const s = Math.floor(ms / 1000), t = Math.floor((ms % 1000) / 100); return `0:0${s}.${t}`; }
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function clockValue(c) {
  if (settings.mode === 'online') return onlineClockValue(c);
  if (!clock) return 0;
  let v = clock[c];
  if (clock.running && chess.turn() === c && !result) v -= performance.now() - clock.turnStart;
  return v;
}
function renderClocks() {
  const top = orientation === 'w' ? 'b' : 'w', bottom = orientation;
  for (const [id, c] of [['clock-top', top], ['clock-bottom', bottom]]) {
    const el = $(id);
    const hasClock = settings.mode === 'online' ? !!(online && online.state && online.state.clock) : !!clock;
    if (!hasClock) { el.hidden = true; continue; }
    el.hidden = false;
    const v = clockValue(c);
    el.textContent = fmt(v);
    const active = !result && chess.turn() === c && (settings.mode === 'online' ? online.state.clock.running && online.state.status === 'active' : clock.started);
    el.classList.toggle('active', active);
    el.classList.toggle('low', v < 20000);
    el.classList.toggle('flag', v <= 0);
  }
}
function tick() {
  if (settings.mode === 'online') { onlineTick(); return; }
  if (clock && clock.running && !result) {
    const c = chess.turn();
    if (clockValue(c) <= 0) {
      clock[c] = 0;
      const opp = c === 'w' ? 'b' : 'w';
      // the side with time left wins only if it could still mate
      const canMate = hasMatingMaterial(opp);
      finish(canMate ? { winner: opp, loser: c, reason: 'timeout' } : { winner: null, reason: 'timeout' });
      return;
    }
    renderClocks();
  }
}
function hasMatingMaterial(color) {
  let minors = 0;
  for (const rank of chess.board()) for (const p of rank) {
    if (!p || p.color !== color) continue;
    if (p.type === 'p' || p.type === 'q' || p.type === 'r') return true;
    if (p.type === 'n' || p.type === 'b') minors++;
  }
  return minors >= 2;
}
setInterval(tick, 100);
setInterval(() => { if (clock && clock.running && !result) save(); }, 3000);

/* ---------------- actions ---------------- */
// v1.8.3: starting any other game while Quick Match searches in the background stops the search
function stopQuickSearch() { if (Account.seeking()) { Account.cancelSeek(true); toast('Quick Match search stopped'); } }
function newGame(opts) {
  stopQuickSearch();
  if (opts && opts.mode === 'online') { startOnline(opts); return; }
  showView('game');
  if (online || settings.mode === 'online') leaveOnline();
  settings = { ...settings, ...opts };
  if (settings.mode === 'ai' && settings.color === 'r') settings.color = Math.random() < 0.5 ? 'w' : 'b';
  if (settings.mode === 'pvp') settings.color = 'w';
  engine.cancel();
  thinking = false;
  gen++;
  chess.reset();
  result = null; selected = null; legalFrom = []; hintMove = null; premove = null; preSel = null; userArrows = []; userMarks.clear();
  const tc = TCS[settings.tc];
  clock = tc ? { w: tc[0] * 60000, b: tc[0] * 60000, inc: tc[1] * 1000, running: false, started: false, turnStart: 0 } : null;
  orientation = settings.mode === 'ai' ? settings.color : 'w';
  engine.newGame();
  buildSquares(); applyPrefs();
  rebuildPieces();
  render(false);
  save();
  sound.play('start');
  const bot = curBot();
  if (bot) setTimeout(() => botSay(Bots.line(bot, 'start'), 5000), 500);
  maybeEngineMove();
}

function undo() {
  if (settings.mode === 'online') return;
  if (!chess.history().length || pendingPromo) return;
  engine.cancel();
  const wasThinking = thinking;
  thinking = false;
  gen++;
  if (settings.mode === 'ai') {
    if (wasThinking || chess.turn() !== settings.color) chess.undo();
    else { chess.undo(); if (chess.turn() !== settings.color) chess.undo(); }
    if (chess.turn() !== settings.color && chess.history().length === 0) { /* engine plays white: let it move again */ }
  } else chess.undo();
  result = null; selected = null; legalFrom = []; hintMove = null;
  if (clock) { clock.turnStart = performance.now(); clock.running = clock.started && chess.history().length > 0; }
  render(true);
  save();
  sound.play('move');
  maybeEngineMove();
}

async function hint() {
  if (settings.mode === 'online') return;
  if (result || thinking) return;
  if (settings.mode === 'ai' && chess.turn() !== settings.color) return;
  const myGen = gen;
  $('substatus').textContent = 'Finding the best move…';
  $('btn-hint').disabled = true;
  let uci = await engine.bestMove(chess.fen(), { skill: 20, movetime: 700 });
  if (!uci) uci = fallbackMove(Chess, chess.fen(), 2);
  $('btn-hint').disabled = false;
  if (myGen !== gen || !uci) { renderStatus(); return; }
  const tmp = new Chess(chess.fen());
  let san = uci;
  try { san = tmp.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }).san; } catch (e) {}
  hintMove = { from: uci.slice(0, 2), to: uci.slice(2, 4), san };
  renderHighlights(); renderStatus();
}

function flip() {
  orientation = orientation === 'w' ? 'b' : 'w';
  buildSquares();
  for (const [sq, el] of pieceEls) placeEl(el, sq);
  renderHighlights(); renderPlayers();
  save();
}

function resign() {
  if (settings.mode === 'online') { onlineResign(); return; }
  if (result || !chess.history().length) return;
  const loser = settings.mode === 'ai' ? settings.color : chess.turn();
  $('confirm-text').textContent = settings.mode === 'ai' ? `The game will count as a win for ${aiName()}.` : `${loser === 'w' ? 'White' : 'Black'} resigns and the game ends.`;
  openSheet('sheet-confirm');
  $('confirm-yes').onclick = () => {
    closeSheet('sheet-confirm');
    finish({ winner: loser === 'w' ? 'b' : 'w', loser, reason: 'resign' });
  };
}


/* ---------------- online play ---------------- */
const turnOf = (fen) => fen.split(' ')[1];
const serverNow = () => Date.now() + (online ? online.offset || 0 : 0);
function oppColor() { return online ? (online.color === 'w' ? 'b' : 'w') : 'b'; }
function oppName() {
  if (!online || !online.state) return 'Your friend';
  return online.state.names[oppColor()] || 'Your friend';
}
function seatRating(c) {
  const st = online && online.state; if (!st || !st.rt || !st.uids || !st.uids[c]) return '';
  const r = st.rt.u && st.rt.u[st.uids[c]]; return r ? ` <small class="rt">${Account.Ranks.rankMini(r, 14)}${r.r}${r.p ? '?' : ''}</small>` : '';
}
function onlineLabel(c) {
  if (!online || !online.state) return c === 'w' ? 'White' : 'Black';
  const st = online.state;
  if (c === online.color) {
    const me = st.names[c] ? escapeHtml(st.names[c]) + seatRating(c) + ' <small>(you)</small>' : 'You';
    const dot = online.conn === 'ok' ? 'on' : 'off';
    return `${me} <i class="pres ${dot}" title="${dot === 'on' ? 'Connected' : 'Reconnecting'}"></i>`;
  }
  if (!st.joined[c]) return `<span class="muted-name">Waiting for friend…</span>`;
  const on = st.online[c];
  return `${escapeHtml(st.names[c] || 'Friend')}${seatRating(c)} <i class="pres ${on ? 'on' : 'off'}" title="${on ? 'Connected' : 'Disconnected'}"></i><small class="pres-text">${on ? 'online' : 'offline'}</small>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

function onlineClockValue(c) {
  const st = online && online.state;
  if (!st || !st.clock) return 0;
  let v = st.clock[c];
  if (st.clock.running && st.status === 'active' && turnOf(st.fen) === c && chess.turn() === c) v -= serverNow() - st.clock.turnStart;
  return v;
}
let lastFlagCall = 0;
function onlineTick() {
  const st = online && online.state;
  if (!st || !st.clock || st.status !== 'active') return;
  if (st.clock.running && onlineClockValue(turnOf(st.fen)) <= 0 && Date.now() - lastFlagCall > 1500) {
    lastFlagCall = Date.now();
    onlineAction('flag', { quiet: true });
  }
  renderClocks();
}

function renderOnlineStatus() {
  const st = $('status'), sub = $('substatus');
  st.className = 'status';
  const s = online && online.state;
  const bar = $('offer-bar');
  bar.hidden = true;
  $('btn-resign').disabled = !s || s.status !== 'active';
  $('btn-draw').disabled = !s || s.status !== 'active' || s.drawOffer === online.color;
  $('btn-draw').querySelector('span').textContent = s && s.drawOffer === online.color ? 'Offered' : 'Draw';
  if (!s) { st.textContent = 'Connecting…'; sub.textContent = ''; return; }
  const conn = online.conn !== 'ok' ? 'Connection lost, reconnecting…' : '';
  if (s.status === 'waiting') {
    st.textContent = 'Waiting for your friend';
    sub.textContent = conn || `Game code ${s.code} · tap Invite to share`;
    return;
  }
  if (s.status === 'over' && s.result) {
    const r = s.result;
    st.textContent = !r.winner ? 'Draw' : r.winner === online.color ? 'You won!' : 'You lost';
    st.classList.add(!r.winner ? 'draw' : r.winner === online.color ? 'win' : 'loss');
    const rm = s.rematch || {};
    if (s.t) {
      if (!r.winner && s.t.arma) st.textContent = online.color === 'b' ? 'Draw — you go through!' : 'Draw — Black goes through';
      sub.textContent = conn || `${reasonText(r)} · 🏆 ${s.t.label}`;
      return;
    }
    sub.textContent = conn || reasonText(r) + (rm[online.color] ? ' · rematch asked' : '');
    if (rm[oppColor()] && !rm[online.color]) showOfferBar(`${oppName()} wants a rematch`, 'Accept', () => onlineAction('rematch'), 'No thanks', () => closeOfferBar());
    return;
  }
  const check = chess.inCheck() ? ' — Check!' : '';
  st.textContent = (chess.turn() === online.color ? 'Your move' : `${oppName()}'s move`) + check;
  if (conn) sub.textContent = conn;
  else if (!s.online[oppColor()]) sub.textContent = `${oppName()} is offline — they can rejoin from the ${s.t ? 'tournament page' : 'link'}`;
  else if (s.drawOffer === online.color) sub.textContent = 'Draw offered, waiting for an answer';
  else if (s.t && s.moves.length >= 2) sub.textContent = `🏆 ${s.t.name} · ${s.t.label}${s.t.arma ? ' (draw = Black wins)' : ''}`;
  else sub.textContent = s.moves.length < 2 && s.clock ? 'Clocks start after both first moves' : 'Playing online · code ' + s.code;
  if (s.drawOffer === oppColor()) showOfferBar(`${oppName()} offers a draw`, 'Accept', () => onlineAction('accept_draw'), 'Decline', () => onlineAction('decline_draw'));
}
let offerDismissed = '';
function showOfferBar(text, yes, onYes, no, onNo) {
  if (offerDismissed === text + online.state.ver) return;
  const bar = $('offer-bar');
  $('offer-text').textContent = text;
  $('offer-yes').textContent = yes; $('offer-no').textContent = no;
  $('offer-yes').onclick = () => { bar.hidden = true; onYes(); };
  $('offer-no').onclick = () => { offerDismissed = text + online.state.ver; bar.hidden = true; onNo(); };
  bar.hidden = false;
}
function closeOfferBar() { $('offer-bar').hidden = true; }

function renderResultActions() {
  const again = $('result-again');
  if (settings.mode !== 'online' || !online || !online.state) { again.textContent = 'Play again'; again.disabled = false; $('result-note').textContent = ''; return; }
  if (online.state.t) {
    again.textContent = 'Back to tournament'; again.disabled = false;
    const r = online.state.result;
    $('result-note').textContent = online.state.t.arma && r && !r.winner ? 'Armageddon: a draw counts as a win for Black.' : `🏆 ${online.state.t.name} · ${online.state.t.label}`;
    return;
  }
  const rm = online.state.rematch || {};
  if (rm[online.color]) { again.textContent = 'Rematch asked'; again.disabled = true; $('result-note').textContent = `Waiting for ${oppName()} to accept…`; }
  else { again.textContent = rm[oppColor()] ? 'Accept rematch' : 'Rematch'; again.disabled = false; $('result-note').textContent = rm[oppColor()] ? `${oppName()} wants a rematch` : 'Colours swap in the rematch'; }
}

function setOnlineUI(on) {
  document.body.classList.toggle('is-online', on);
  renderHub();
}

async function startOnline(opts) {
  const name = (opts.name || '').trim().slice(0, 20);
  if (name !== prefs.name) { prefs.name = name; savePrefs(); }
  toast('Creating your game…');
  let st;
  try { st = await Net.createRoom({ color: opts.color === 'r' ? 'random' : opts.color, tc: opts.tc, name, rated: !!opts.rated }); }
  catch (e) { toast(e.http ? e.message : 'No connection. Online play needs internet.'); return; }
  Net.rememberSeat(st.code, st.tok);
  $('toast').hidden = true;
  enterRoom(st.code, st.tok, st);
  openInvite();
}

async function joinByCode(code, { quiet = false } = {}) {
  code = Net.cleanCode(code);
  if (!code) return false;
  stopQuickSearch();
  const tok = Net.seatFor(code);
  let st;
  try { st = await Net.joinRoom(code, tok, prefs.name || ''); }
  catch (e) {
    if (e.code === 'full') toast('That game already has two players.');
    else if (e.code === 'no_room') toast(`No game found with code ${code}.`);
    else if (!quiet) toast(e.http ? e.message : 'No connection. Online play needs internet.');
    else if (!e.http) { enterRoom(code, tok, null); return true; } // offline on refresh: keep trying in the background
    return false;
  }
  Net.rememberSeat(code, st.tok || tok);
  enterRoom(code, st.tok || tok, st);
  if (!tok || (st.tok && st.tok !== tok)) {
    const host = st.names[st.you === 'w' ? 'b' : 'w'];
    toast(`You joined ${host ? host + "'s" : 'the'} game · you play ${st.you === 'w' ? 'White' : 'Black'}`);
  }
  return true;
}

function enterRoom(code, tok, st) {
  if (online) { if (online.code !== code) Net.leave(online.code, online.tok); stopPolling(); }
  engine.cancel(); thinking = false; gen++;
  settings = { ...settings, mode: 'online' };
  chatSeen = -1;
  online = { code, tok, color: st ? st.you : 'w', state: null, ver: 0, game: 0, offset: 0, run: 0, conn: st ? 'ok' : 'retrying', pending: null, abort: null };
  result = null; selected = null; legalFrom = []; hintMove = null; clock = null;
  chess.reset();
  try { history.replaceState(null, '', '?room=' + code); } catch (e) {}
  setOnlineUI(true);
  showView('game');
  closeSheet('sheet-result');
  if (st) applyServerState(st, true);
  else { orientation = 'w'; buildSquares(); rebuildPieces(); render(false); }
  startPolling();
}

// v1.8.3: after a Quick Match that never started (declined), put the local game (vs computer / 2 players) back on the board
function restoreLocalGame() {
  chess.reset(); result = null; clock = null; selected = null; legalFrom = []; hintMove = null; premove = null;
  if (!load()) settings = { ...settings, mode: 'ai', tc: 'none' };
  if (settings.mode === 'online') settings = { ...settings, mode: 'ai' };
  if (clock && clock.started && !result && chess.history().length) { clock.running = true; clock.turnStart = performance.now(); }
  buildSquares(); rebuildPieces(); render(false);
  if (settings.mode === 'ai') maybeEngineMove();
}
function backToTourney() {
  const c = online && online.state && online.state.t ? online.state.t.code : null;
  if (!c) return;
  leaveOnline();
  location.href = '/?t=' + c;
}
function leaveOnline() {
  document.body.classList.remove('is-tgame');
  if (!online) { setOnlineUI(false); return; }
  Net.leave(online.code, online.tok);
  stopPolling();
  online = null;
  Net.forgetCurrent();
  closeOfferBar();
  setOnlineUI(false);
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

function applyServerState(st, first = false) {
  if (!online || !st || st.code !== online.code) return;
  if (!first && online.state && st.ver < online.state.ver) return; // older than what we hold
  const sample = st.now - Date.now();
  if (!online.offsetSet || sample > online.offset || sample < online.offset - 4000) { online.offset = sample; online.offsetSet = true; }
  const prev = online.state;
  const newGameStarted = !prev || prev.game !== st.game;
  const colorChanged = online.color !== st.you;
  if (!st.you) {
    // this browser's seat was taken back from another browser
    toast('This game moved to your other browser or phone');
    leaveOnline(); newGame({ mode: settings.mode === 'online' ? 'ai' : settings.mode });
    return;
  }
  online.state = st; online.ver = st.ver;
  document.body.classList.toggle('is-tgame', !!st.t);
  if (st.you) online.color = st.you;

  // moves: extend what we have, or rebuild when histories differ (rematch, missed state)
  const local = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  const remote = st.moves;
  const isPrefix = local.length <= remote.length && local.every((u, i) => u === remote[i]);
  const pendingAhead = online.pending && local.length === remote.length + 1 && remote.every((u, i) => u === local[i]);
  let rebuilt = false;
  if (newGameStarted || colorChanged || (!isPrefix && !pendingAhead)) {
    chess.reset();
    for (const u of remote) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
    result = null; selected = null; legalFrom = [];
    if (first || newGameStarted || colorChanged) orientation = online.color;
    buildSquares(); rebuildPieces();
    rebuilt = true;
    if (!first && newGameStarted) { closeSheet('sheet-result'); sound.play('start'); toast(`Rematch! You play ${online.color === 'w' ? 'White' : 'Black'}`); }
  } else if (isPrefix && remote.length > local.length) {
    const extra = remote.slice(local.length);
    extra.forEach((u, i) => makeMove({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }, { animate: i === extra.length - 1, remote: true }));
    if (selected && !chess.get(selected)) { selected = null; legalFrom = []; }
  }
  if (prev && prev.status === 'waiting' && st.status === 'active') {
    sound.play('start');
    closeSheet('sheet-invite');
    toast(`${st.names[oppColor()] || 'Your friend'} joined. ${online.color === 'w' ? 'You play White, your move' : 'You play Black'}`);
  }
  if (prev && prev.status === 'active' && st.status === 'active') {
    if (st.drawOffer === oppColor() && prev.drawOffer !== oppColor()) sound.play('check');
    if (prev.joined && st.online[oppColor()] !== prev.online[oppColor()] && st.joined[oppColor()]) toast(st.online[oppColor()] ? `${oppName()} is back` : `${oppName()} disconnected`);
  }
  // v1.8.3: a Quick Match that one player declined before it began: nothing is recorded; the other player searches again
  if (st.quick && st.status === 'over' && st.result && st.result.reason === 'aborted' && !result) {
    const byMe = st.result.by === online.color, tc = st.tc;
    leaveOnline(); restoreLocalGame(); goHome();
    if (!byMe) { toast('Your opponent declined. Searching again…'); Account.startSeek(tc); }
    return;
  }
  if (st.status === 'over' && st.result) {
    if (!result) { finish(st.result); }
    else { result = st.result; renderResultActions(); }
  } else if (result) { result = null; }
  if (!rebuilt) renderHighlights();
  renderPlayers(); renderMoves(); renderStatus();
  if (!$('sheet-result').hidden) renderResultActions();
  updateInvite();
  renderChat(st);
}

function startPolling() {
  if (!online) return;
  const myRun = ++online.run;
  let errors = 0;
  (async () => {
    while (online && online.run === myRun) {
      const ctl = new AbortController();
      online.abort = ctl;
      try {
        const st = await Net.poll(online.code, online.tok, online.ver, ctl.signal);
        if (!online || online.run !== myRun) return;
        errors = 0;
        const was = online.conn; online.conn = 'ok';
        applyServerState(st, !online.state);
        if (was !== 'ok') { renderPlayers(); renderStatus(); }
      } catch (e) {
        if (!online || online.run !== myRun) return;
        if (e.code === 'no_room') { toast('That game no longer exists.'); leaveOnline(); openNewGame(); return; }
        errors++;
        if (online.conn !== 'retrying') { online.conn = 'retrying'; renderPlayers(); renderStatus(); }
        await new Promise((r) => setTimeout(r, Math.min(6000, 600 * errors)));
      }
    }
  })();
}
function stopPolling() {
  if (!online) return;
  online.run++;
  if (online.abort) try { online.abort.abort(); } catch (e) {}
}
function kickPolling() { if (online) { stopPolling(); startPolling(); } }

async function sendOnlineMove(mv) {
  const uci = mv.from + mv.to + (mv.promotion || '');
  const ply = chess.history().length - 1;
  online.pending = uci;
  const code = online.code;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const st = await Net.sendMove(code, online.tok, uci, ply);
      if (!online || online.code !== code) return;
      online.pending = null;
      applyServerState(st);
      return;
    } catch (e) {
      if (!online || online.code !== code) return;
      if (e.http) {
        // the server said no (stale position, game over…): take its version of the game
        online.pending = null;
        if (!['stale', 'not_your_turn'].includes(e.code)) toast(e.message);
        await resync();
        return;
      }
      online.conn = 'retrying'; renderStatus();
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  online.pending = null;
  await resync();
  toast('Your move did not reach the server. Check your connection.');
}
async function resync() {
  if (!online) return;
  try { const st = await Net.poll(online.code, online.tok, -1); if (online) { online.state = null; applyServerState(st, true); } }
  catch (e) { kickPolling(); }
}
async function onlineAction(type, { quiet = false } = {}) {
  if (!online) return;
  try { const st = await Net.sendAction(online.code, online.tok, type); applyServerState(st); }
  catch (e) { if (!quiet) toast(e.http ? e.message : 'No connection, try again.'); }
}
function onlineResign() {
  if (!online || !online.state || online.state.status !== 'active') return;
  $('confirm-text').textContent = `${oppName()} wins the game.`;
  openSheet('sheet-confirm');
  $('confirm-yes').onclick = () => { closeSheet('sheet-confirm'); onlineAction('resign'); };
}
function offerDraw() {
  if (!online || !online.state || online.state.status !== 'active') return;
  onlineAction('offer_draw');
  toast('Draw offered');
}

/* invite sheet */
function updateInvite() {
  if (!online) return;
  const link = Net.roomLink(online.code);
  $('invite-code').textContent = online.code;
  $('invite-link').textContent = link.replace(/^https?:\/\//, '');
  const tcTxt = online.state && online.state.tc && online.state.tc !== 'none' ? ` (${online.state.tc.replace('+', ' + ')})` : '';
  const msg = `Play chess with me${tcTxt}! Tap to join my game: ${link}  (code ${online.code})`;
  $('invite-wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('invite-wa').dataset.msg = msg;
  const s = online.state;
  const waiting = !s || s.status === 'waiting';
  $('invite-status').innerHTML = waiting ? '<span class="spin" aria-hidden="true"></span> Waiting for your friend to open the link…' : `✓ ${escapeHtml(oppName())} is in the game`;
  $('invite-color').textContent = s ? `You play ${online.color === 'w' ? 'White' : 'Black'}${s.tc && s.tc !== 'none' ? ' · ' + s.tc.replace('+', ' + ') : ' · no clock'}` : '';
}
function openInvite() { updateInvite(); openSheet('sheet-invite'); }
async function copyInvite() {
  const link = Net.roomLink(online.code);
  try { await navigator.clipboard.writeText(link); toast('Link copied'); }
  catch (e) {
    const r = document.createRange(); r.selectNodeContents($('invite-link'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Select and copy the link');
  }
}
async function nativeShare() {
  const link = Net.roomLink(online.code);
  try { await navigator.share({ title: 'Kingside Chess', text: `Play chess with me! Code ${online.code}`, url: link }); }
  catch (e) { if (e && e.name !== 'AbortError') copyInvite(); }
}


/* ---------------- game review ---------------- */
function reviewGame() {
  const moves = chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));
  if (!moves.length) { toast('Play a few moves first, then review the game'); return; }
  if (settings.mode === 'online' && online && online.state && online.state.status === 'active' && !result) { toast('Game Review opens when the game is over'); return; }
  let white = 'White', black = 'Black';
  if (settings.mode === 'ai') { const sf = aiFull(); white = settings.color === 'w' ? (prefs.name || 'You') : sf; black = settings.color === 'b' ? (prefs.name || 'You') : sf; }
  else if (settings.mode === 'online' && online) { const n = online.state && online.state.names || {}; white = n.w || 'White'; black = n.b || 'Black'; }
  const res = result ? (result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '½-½') : '';
  closeSheet('sheet-result');
  Review.open({ moves, white, black, result: res, orientation });
  try { history.pushState({ kview: 'review' }, ''); } catch (e) {}
}


function renderQuick() {
  const s = Puzzles.stats();
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  $('puzzle-sub').textContent = 'Rating ' + Math.round(s.r);
  $('daily-sub').textContent = s.daily[today] === 'ok' ? 'Solved today ✅' + (s.streak > 1 ? ' 🔥' + s.streak : '') : s.daily[today] ? 'Missed today' : 'Today’s challenge';
  renderHub();
}
// v1.8 Crowns: the home Shop tile, and using a board / piece set bought in the Shop
function renderCrownTile() {
  const el = $('shop-sub'); if (!el) return;
  el.textContent = `${Crowns.balance()} Crowns · boards, pieces, frames`;
}
function useItem(it) {
  if (!it) return;
  if (it.type === 'theme') prefs.theme = it.v; else if (it.type === 'pieces') prefs.pieces = it.v; else return;
  applyPrefs(); savePrefs(); toast(it.type === 'theme' ? 'New board on ✅' : 'New pieces on ✅');
}
// home: streak flame, Puzzle Rush best, badges count
let lastStreak = null;
function renderStreak() {
  if (!$('hub-streak')) return;
  const st = Progress.streak();
  $('hub-streak-n').textContent = st.cur;
  $('hub-streak').classList.toggle('off', !st.today);
  $('hub-streak').setAttribute('aria-label', `${st.cur}-day streak${st.today ? '' : ', not played today yet'}`);
  if (lastStreak != null && st.cur > lastStreak) { $('hub-streak').classList.remove('pulse'); void $('hub-streak').offsetWidth; $('hub-streak').classList.add('pulse'); }
  lastStreak = st.cur;
  const p = Progress.load();
  $('ach-sub').textContent = `${Progress.count(p)} of ${Progress.ACH.length} badges`;
  const rb = Puzzles.rushBest();
  renderLearnTile();
  $('rush-sub').textContent = rb ? `Best: ${rb}` : '3 minutes · 3 strikes';
  Streak.renderCard();
  const u = Account.user(); const mk = u ? Account.mainPool(u.ratings) : 'blitz', br = Account.myRating(mk);
  if ($('lb-sub')) $('lb-sub').textContent = u && br && br.n ? `${Account.poolName(mk).split(' ')[0]} ${Account.rtxt(br)} · see your rank` : 'Top players · your rank';
}


// home: the Learn tile (lessons done, the next lesson)
function renderLearnTile() {
  if (!$('learn-sub')) return;
  const s = Learn.summary();
  $('learn-sub').textContent = s.done ? `${s.done} of ${s.total} lessons done` : `${s.total} interactive lessons`;
  $('learn-bar').style.width = Math.round((s.done / s.total) * 100) + '%';
  $('learn-go').textContent = s.done >= s.total ? 'Review' : s.done ? 'Continue' : 'Start';
}

/* ---------------- in-game chat ---------------- */
let chatSeen = -1, chatPopTimer = null;
function renderChat(st) {
  const log = $('chat-log'); if (!log || !online) return;
  const list = (st && st.chat) || [];
  log.innerHTML = list.map((m) => `<li class="${m.c === online.color ? 'me' : ''}">${escapeHtml(m.m)}</li>`).join('');
  log.scrollTop = log.scrollHeight;
  if (chatSeen < 0) { chatSeen = list.length; return; }
  const fresh = list.slice(chatSeen).filter((m) => m.c !== online.color);
  chatSeen = list.length;
  if (fresh.length) {
    const last = fresh[fresh.length - 1];
    const pop = $('chat-pop'); pop.textContent = last.m; pop.hidden = false;
    clearTimeout(chatPopTimer); chatPopTimer = setTimeout(() => { pop.hidden = true; }, 4500);
    if ($('chat-card').classList.contains('min')) $('chat-badge').hidden = false;
    if (navigator.vibrate) navigator.vibrate(20);
  }
}
async function sendChat(msg) {
  msg = String(msg || '').trim(); if (!msg || !online) return;
  try { const st = await Net.sendChat(online.code, online.tok, msg); applyServerState(st); }
  catch (e) { toast(e.http ? e.message : 'Message not sent: no connection'); }
}
function wireChat() {
  $('chat-form').onsubmit = (e) => { e.preventDefault(); const i = $('chat-input'); sendChat(i.value); i.value = ''; };
  $('chat-quick').onclick = (e) => { const b = e.target.closest('button'); if (b) sendChat(b.textContent); };
  $('chat-min').onclick = () => { const c = $('chat-card'); c.classList.toggle('min'); $('chat-min').textContent = c.classList.contains('min') ? '+' : '–'; if (!c.classList.contains('min')) $('chat-badge').hidden = true; };
  $('btn-chat').onclick = () => { const c = $('chat-card'); c.classList.remove('min'); $('chat-min').textContent = '–'; $('chat-badge').hidden = true; c.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => $('chat-input').focus({ preventScroll: true }), 350); };
}

/* ---------------- sheets & prefs ---------------- */
function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) { $(id).hidden = true; }
let draft = {};
function setupSeg(root, name, value, onChange) {
  const seg = root.querySelector(`.seg[data-name="${name}"]`);
  const mark = (v) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === String(v)));
  mark(value);
  seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; mark(b.dataset.value); onChange(b.dataset.value); };
}
function openNewGame(preset) {
  draft = { mode: settings.mode, level: settings.level, color: settings.mode === 'ai' ? settings.color : 'w', tc: settings.tc, bot: settings.bot || 'meera', kind: settings.bot ? 'bots' : prefs.kind || 'bots', ...(preset && preset.mode ? preset : {}) };
  const root = $('sheet-new');
  const pre = preset && preset.mode ? preset.mode : '';
  root.classList.toggle('preset', !!pre);
  $('new-title').textContent = { ai: 'Play Computer', online: 'Play a Friend', pvp: '2 Players' }[pre] || 'New game';
  $('new-sub').textContent = { ai: 'Pick a bot with its own style, or a plain level from 1 to 10 (Stockfish 19).', online: 'Send your friend a link. The game starts the moment they open it.', pvp: 'Pass the phone between moves.' }[pre] || '';
  const sync = () => {
    root.querySelectorAll('.ai-only').forEach((el) => (el.hidden = draft.mode !== 'ai' && !(draft.mode === 'online' && el.classList.contains('online-too'))));
    root.querySelectorAll('.online-only').forEach((el) => (el.hidden = draft.mode !== 'online'));
    $('new-start').textContent = draft.mode === 'online' ? 'Create game link' : 'Start game';
    const L = levelOf(draft.level); $('level-desc').textContent = `${L.name} · ${L.elo}`;
    // v1.7: bots or levels
    root.querySelectorAll('.kind-bots').forEach((el) => (el.hidden = draft.mode !== 'ai' || draft.kind !== 'bots'));
    root.querySelectorAll('.kind-levels').forEach((el) => (el.hidden = draft.mode !== 'ai' || draft.kind !== 'levels'));
    renderBotPicker();
    // v1.7: rated friend games (signed in, with a clock)
    const signed = !!Account.session();
    $('rated-row').hidden = draft.mode !== 'online';
    $('opt-rated').disabled = !signed || draft.tc === 'none';
    if ($('opt-rated').disabled) $('opt-rated').checked = false;
    $('rated-why').textContent = !signed ? 'sign in to play rated games' : draft.tc === 'none' ? 'pick a clock to play rated' : 'counts for both ratings when your friend is signed in too';
  };
  const renderBotPicker = () => {
    const grid = $('bot-grid');
    if (!grid.dataset.built) {
      grid.innerHTML = Bots.BOTS.map((b) => `<button type="button" class="bot-pick" role="radio" data-bot="${b.id}" aria-label="${escapeHtml(b.name)}, about ${b.elo}"><img src="${Bots.avatarUrl(b)}" alt="" width="52" height="52"><b data-i18n-skip>${escapeHtml(b.short || b.name)}</b><small>${b.elo}${b.id === 'titan' ? '+' : ''}</small></button>`).join('');
      grid.dataset.built = '1';
      grid.onclick = (e) => { const p = e.target.closest('[data-bot]'); if (p) { draft.bot = p.dataset.bot; renderBotPicker(); } };
    }
    grid.querySelectorAll('[data-bot]').forEach((x) => { const on = x.dataset.bot === draft.bot; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); x.classList.toggle('locked', !Crowns.owns('bot', x.dataset.bot)); });
    const b = Bots.botById(draft.bot) || Bots.BOTS[1];
    $('bot-info').innerHTML = `<img src="${Bots.avatarUrl(b)}" alt="" width="64" height="64"><div><b><span data-i18n-skip>${escapeHtml(b.name)}</span> ${b.flag}</b><small class="bot-tag">${escapeHtml(Bots.t(b.tag))} · ~${b.elo}${b.id === 'titan' ? '+' : ''}</small><p data-i18n-skip>${escapeHtml(Bots.t(b.bio))}</p>${Crowns.owns('bot', b.id) ? '' : `<small class="bot-lockp">🔒 Unlock for 👑 ${Crowns.priceOf('bot', b.id)}</small>`}</div>`; // v1.8.2: a locked bot shows its price
  };
  setupSeg(root, 'kind', draft.kind, (v) => { draft.kind = v; sync(); });
  if (draft.kind === 'bots') setupSeg(root, 'kind', 'bots', (v) => { draft.kind = v; sync(); });
  setupSeg(root, 'mode', draft.mode, (v) => { draft.mode = v; sync(); });
  setupSeg(root, 'level', draft.level, (v) => { draft.level = +v; sync(); });
  setupSeg(root, 'color', draft.color, (v) => { draft.color = v; });
  setupSeg(root, 'tc', draft.tc, (v) => { draft.tc = v; sync(); });
  sync();
  $('online-name').value = prefs.name || '';
  $('join-code').value = '';
  openSheet('sheet-new');
  $('new-start').focus({ preventScroll: true });
}
function applyPrefs() {
  for (const c of [...document.body.classList]) if (c.startsWith('theme-')) document.body.classList.remove(c);
  // v1.8: a premium board / piece set shows only when it is unlocked on this phone or account
  const theme = Crowns.owns('theme', prefs.theme) ? prefs.theme : 'emerald', pieces = Crowns.owns('pieces', prefs.pieces) ? prefs.pieces : 'classic';
  document.body.classList.add('theme-' + theme);
  if (document.body.dataset.pieces !== pieces) { document.body.dataset.pieces = pieces; document.dispatchEvent(new Event('kingside-pieces')); }
  $('board').classList.toggle('no-coords', !prefs.coords);
  $('btn-sound').classList.toggle('muted', !prefs.sound);
  $('btn-sound').setAttribute('aria-label', prefs.sound ? 'Sound on' : 'Sound off');
  sound.enabled = prefs.sound;
}
function openSettings() {
  const root = $('sheet-settings');
  // v1.8: premium boards and piece sets show a 🔒 price; tapping one offers it for Crowns
  const lockSeg = (name, type) => {
    const cur = () => (Crowns.owns(type, prefs[name]) ? prefs[name] : name === 'theme' ? 'emerald' : 'classic');
    const pick = (v) => { prefs[name] = v; applyPrefs(); savePrefs(); lockSeg(name, type); };
    setupSeg(root, name, cur(), (v) => {
      if (Crowns.owns(type, v)) return pick(v);
      setupSeg(root, name, cur(), () => {}); lockSeg(name, type);
      Crowns.offer(type + ':' + v, () => pick(v));
    });
    root.querySelectorAll(`.seg[data-name="${name}"] button`).forEach((b) => {
      const locked = !Crowns.owns(type, b.dataset.value);
      b.classList.toggle('locked', locked);
      if (locked) b.dataset.price = Crowns.priceOf(type, b.dataset.value); else delete b.dataset.price;
    });
  };
  lockSeg('theme', 'theme');
  lockSeg('pieces', 'pieces');
  $('opt-premove').checked = prefs.premove !== false;
  $('opt-dests').checked = prefs.dests; $('opt-coords').checked = prefs.coords;
  $('opt-autoflip').checked = prefs.autoflip; $('opt-sound').checked = prefs.sound;
  openSheet('sheet-settings');
}
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
}


/* ---------------- views: home hub, game, tab bar, More menu ---------------- */
let view = 'home';
function gameInProgress() {
  if (online) return !online.state || online.state.status !== 'over';
  return chess.history().length > 0 && !result;
}
function showView(v, { push = true } = {}) {
  if (v === view) return;
  view = v;
  document.body.classList.toggle('view-home', v === 'home');
  document.body.classList.toggle('view-game', v === 'game');
  if (v === 'game' && push) { try { history.pushState({ kview: 'game' }, ''); } catch (e) {} }
  if (v === 'home') { renderHub(); Account.refreshMe(); }
  else requestAnimationFrame(() => { for (const [sq, el] of pieceEls) placeEl(el, sq); });
  window.scrollTo(0, 0);
  syncTabs();
}
function goHome() {
  if (view !== 'game') return;
  if (history.state && history.state.kview === 'game') { history.back(); setTimeout(() => { if (view === 'game') showView('home'); }, 400); return; }
  showView('home');
}
function syncTabs() {
  const b = document.body.classList;
  const t = b.contains('l-open') ? 'learn' : b.contains('p-open') ? 'puzzles' : b.contains('a-open') ? ($('ascreen').dataset.v === 'friends' ? 'friends' : $('ascreen').dataset.v === 'achievements' ? 'home' : 'more') : b.contains('t-open') ? 'more' : !$('sheet-more').hidden ? 'more' : view === 'game' ? 'play' : 'home';
  document.querySelectorAll('#tabbar [data-tab]').forEach((x) => { x.classList.toggle('on', x.dataset.tab === t); x.setAttribute('aria-current', x.dataset.tab === t ? 'page' : 'false'); });
}
function closeOverlays() {
  if (Review.isOpen()) Review.close();
  if (Puzzles.isOpen()) Puzzles.close();
  if (Learn.isOpen()) Learn.close();
  if (Account.isOpen()) Account.close();
  if (Tourney.isOpen()) Tourney.close();
  document.querySelectorAll('.sheet-backdrop').forEach((b) => (b.hidden = true));
}
function onTab(t) {
  sound.unlock();
  if (t === 'more') { openMore(); return; }
  closeOverlays();
  if (t === 'home') showView('home');
  else if (t === 'play') { showView('game'); if (!gameInProgress() && !chess.history().length) openNewGame({ mode: 'ai' }); }
  else if (t === 'puzzles') Puzzles.open();
  else if (t === 'learn') Learn.open();
  else if (t === 'friends') Account.open('friends');
  syncTabs();
}
function openMore() {
  const u = Account.user();
  $('more-profile-sub').textContent = u ? `${u.display || u.uname} · @${u.uname}` : 'Sign in or create an account';
  $('more-sound-sub').textContent = prefs.sound ? 'On' : 'Off';
  $('more-sound').classList.toggle('on', !!prefs.sound);
  openSheet('sheet-more');
  syncTabs();
}
function onMore(what) {
  if (what === 'sound') { $('btn-sound').click(); $('more-sound-sub').textContent = prefs.sound ? 'On' : 'Off'; $('more-sound').classList.toggle('on', !!prefs.sound); return; }
  closeSheet('sheet-more');
  if (what === 'profile') Account.open();
  else if (what === 'history') Account.open('history');
  else if (what === 'shop') Account.open('shop');
  else if (what === 'crowns') Account.open('crowns');
  else if (what === 'settings') openSettings();
  else if (what === 'pvp') openNewGame({ mode: 'pvp' });
  else if (what === 'join') { openNewGame({ mode: 'online', color: 'w' }); setTimeout(() => $('join-code').focus(), 150); }
  else if (what === 'tourney') Tourney.open();
  else if (what === 'leaders') { Tourney.open(); setTimeout(() => $('t-lbtop').click(), 0); }
  syncTabs();
}
function miniBoard(fen, flipped) {
  const cells = [];
  for (const row of fen.split(' ')[0].split('/')) for (const ch of row) {
    if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) cells.push(null); else cells.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
  }
  if (flipped) cells.reverse();
  return cells.map((p, i) => `<i class="${((i >> 3) + i) % 2 ? 'd' : 'l'}">${p ? `<img src="${pieceUrl(p)}" alt="">` : ''}</i>`).join('');
}
function renderHub() {
  if (!$('hub')) return;
  const u = Account.user(); const ps = Puzzles.stats();
  $('hub-greet').textContent = u ? `Hi, ${u.display || u.uname}` : 'Welcome to Kingside';
  const mk = u ? Account.mainPool(u.ratings) : 'blitz', mr = Account.myRating(mk) || { r: u ? u.rating : 1500, p: true };
  const rk = Account.Ranks.rankOf(mr); // v1.9: the rank of the main pool, when settled
  $('hub-sub').textContent = u ? `${Account.poolName(mk).split(' ')[0]} ${Account.rtxt(mr)} rating${rk ? ' · ' + rk.name : ''} · 🧩 ${Math.round(ps.r)} puzzles` : 'Playing as a guest · tap to sign in';
  const av = $('hub-av');
  av.classList.toggle('signed-in', !!u);
  if (u) {
    const L = (u.display || u.uname)[0].toUpperCase(); if (u.cos && (u.cos.avatar || u.cos.frame)) av.innerHTML = Crowns.avatarHtml(u.cos, L); else av.textContent = L; // v1.8.2: the worn avatar/frame, like the top bar
    if (rk) av.insertAdjacentHTML('beforeend', `<span class="hub-rk" title="${rk.name}">${Account.Ranks.rankIcon(rk, 18)}</span>`); // v1.9 rank on the avatar
  } else av.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-9 2.2-9 5v3h18v-3c0-2.8-4.6-5-9-5z"/></svg>';
  const cont = $('hub-continue');
  const live = gameInProgress();
  cont.hidden = !live;
  if (live) {
    let title, sub;
    const n = Math.ceil(chess.history().length / 2) || 1;
    if (online) { const st = online.state; title = st && st.joined[oppColor()] ? 'vs ' + oppName() : 'Waiting for your friend'; sub = st && st.t ? st.t.name : st && st.quick ? 'Quick Match' : 'Online game'; }
    else if (settings.mode === 'ai') { const b = curBot(); const L = levelOf(settings.level); title = 'vs ' + aiName(); sub = b ? Bots.t(b.tag) + ' · ~' + b.elo : L.name + ' · ' + L.elo; }
    else { title = '2 Players'; sub = 'On this phone'; }
    const turn = online ? (chess.turn() === online.color ? 'Your move' : 'Their move') : settings.mode === 'ai' ? (chess.turn() === settings.color ? 'Your move' : `${aiName()} to move`) : (chess.turn() === 'w' ? 'White' : 'Black') + ' to move';
    $('hc-title').textContent = title;
    $('hc-sub').textContent = `${turn} · ${sub} · move ${n}`;
    $('hc-board').innerHTML = miniBoard(chess.fen(), orientation === 'b');
  }
  $('review-sub').textContent = chess.history().length && !live ? 'Review your last game' : 'Learn from your games';
  renderStreak();
}

/* ---------------- wiring ---------------- */
function wire() {
  const board = $('board');
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', onPointerCancel);
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  $('btn-new').onclick = openNewGame;
  $('btn-home').onclick = goHome;
  $('btn-computer').onclick = () => openNewGame({ mode: 'ai' });
  $('hub-hello').onclick = () => Account.open();
  $('hub-continue').onclick = () => { showView('game'); if (online) kickPolling(); };
  $('btn-hub-review').onclick = () => { if (chess.history().length) reviewGame(); else Account.open('history'); };
  $('tabbar').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) onTab(b.dataset.tab); };
  $('sheet-more').onclick = (e) => { const b = e.target.closest('[data-more]'); if (b) onMore(b.dataset.more); };
  $('more-close').onclick = () => { closeSheet('sheet-more'); syncTabs(); };
  new MutationObserver(syncTabs).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncTabs).observe($('ascreen'), { attributes: true, attributeFilter: ['data-v'] });
  new MutationObserver(syncTabs).observe($('sheet-more'), { attributes: true, attributeFilter: ['hidden'] });
  $('btn-undo').onclick = undo;
  $('btn-hint').onclick = hint;
  $('btn-flip').onclick = flip;
  $('btn-review').onclick = reviewGame;
  $('btn-account').onclick = () => Account.open();
  $('btn-quick').onclick = () => { sound.unlock(); Account.openQuick(); };
  $('btn-daily').onclick = () => { sound.unlock(); Puzzles.open('daily'); };
  $('btn-puzzles').onclick = () => { sound.unlock(); Puzzles.open(); };
  $('btn-learn').onclick = () => { sound.unlock(); Learn.open(); syncTabs(); };
  $('btn-rush').onclick = () => { sound.unlock(); Puzzles.open('rush'); };
  // language: English / हिन्दी (More menu), and a one-time suggestion on phones set to Hindi
  const syncLang = () => document.querySelectorAll('.lang-seg [data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === I18n.lang()));
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (!b) return; $('lang-suggest').hidden = true; if (b.dataset.lang !== I18n.lang() || !I18n.chosen()) I18n.set(b.dataset.lang); syncLang(); });
  syncLang();
  $('lang-suggest').hidden = !I18n.suggest();
  $('btn-ach').onclick = () => Account.open('achievements');
  $('btn-puzzle-top').onclick = () => { sound.unlock(); Puzzles.open(); };
  $('result-review').onclick = reviewGame;
  $('btn-resign').onclick = resign;
  $('btn-settings').onclick = openSettings;
  $('btn-sound').onclick = () => { prefs.sound = !prefs.sound; applyPrefs(); savePrefs(); if (prefs.sound) { sound.unlock(); sound.play('move'); } };
  $('new-cancel').onclick = () => closeSheet('sheet-new');
  $('new-start').onclick = () => {
    // v1.8: Natasha and Titan are unlocked with Crowns (the plain levels 1–10, including full strength, stay free)
    if (draft.mode === 'ai' && draft.kind === 'bots' && draft.bot && !Crowns.owns('bot', draft.bot)) { Crowns.offer('bot:' + draft.bot, () => $('new-start').click()); return; }
    closeSheet('sheet-new'); sound.unlock(); draft.name = $('online-name').value;
    if (draft.mode === 'ai') { draft.bot = draft.kind === 'bots' ? draft.bot || 'meera' : null; if (prefs.kind !== draft.kind) { prefs.kind = draft.kind; savePrefs(); } }
    draft.rated = draft.mode === 'online' && $('opt-rated').checked && draft.tc !== 'none';
    const d = { ...draft }; delete d.kind; newGame(d);
  };
  $('result-share').onclick = () => { closeSheet('sheet-result'); Share.open(shareInfo()); };
  $('r-share').onclick = shareFromReview;
  $('btn-leaders').onclick = () => Account.open('leaderboard');
  $('btn-crowns').onclick = () => Account.open('shop');
  $('btn-shop').onclick = () => Account.open('shop');
  $('streak-card').onclick = () => { Streak.resetMonth(); Account.open('streak'); };
  $('hub-streak').onclick = (e) => { e.stopPropagation(); Streak.resetMonth(); Account.open('streak'); };
  $('btn-online').onclick = () => openNewGame({ mode: 'online', color: 'w' });
  $('btn-draw').onclick = offerDraw;
  $('btn-tourney').onclick = () => Tourney.open();
  $('btn-trophy').onclick = () => Tourney.open();
  $('btn-tback').onclick = backToTourney;
  $('btn-invite').onclick = openInvite;
  $('invite-close').onclick = () => closeSheet('sheet-invite');
  $('invite-copy').onclick = copyInvite;
  if (navigator.share) $('invite-share').onclick = nativeShare; else $('invite-share').hidden = true;
  $('join-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = Net.cleanCode($('join-code').value);
    if (code.length < 4) { toast('Type the 6-letter game code'); return; }
    sound.unlock();
    const n = $('online-name').value.trim().slice(0, 20);
    if (n !== prefs.name) { prefs.name = n; savePrefs(); }
    if (await joinByCode(code)) closeSheet('sheet-new');
  };
  $('settings-done').onclick = () => closeSheet('sheet-settings');
  $('opt-dests').onchange = (e) => { prefs.dests = e.target.checked; savePrefs(); renderHighlights(); };
  $('opt-coords').onchange = (e) => { prefs.coords = e.target.checked; savePrefs(); applyPrefs(); };
  $('opt-autoflip').onchange = (e) => { prefs.autoflip = e.target.checked; savePrefs(); };
  $('opt-sound').onchange = (e) => { prefs.sound = e.target.checked; savePrefs(); applyPrefs(); };
  $('opt-premove').onchange = (e) => { prefs.premove = e.target.checked; savePrefs(); if (!prefs.premove) clearPremove(); };
  $('result-close').onclick = () => closeSheet('sheet-result');
  $('result-again').onclick = () => {
    if (settings.mode === 'online' && online && online.state && online.state.t) { backToTourney(); return; }
    if (settings.mode === 'online' && online) { onlineAction('rematch'); return; }
    closeSheet('sheet-result'); openNewGame();
  };
  $('confirm-no').onclick = () => closeSheet('sheet-confirm');
  document.querySelectorAll('.sheet-backdrop').forEach((bd) => bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.querySelectorAll('.sheet-backdrop').forEach((bd) => (bd.hidden = true)); if (pendingPromo) cancelPromotion(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => { save(); if (online) Net.leave(online.code, online.tok); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && online) kickPolling(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && online) kickPolling(); });
  window.addEventListener('online', () => { if (online) kickPolling(); });
  engine.onReady = () => renderStatus();
  engine.onProgress = () => renderStatus();
}

function init() {
  I18n.apply();
  const had = load();
  buildSquares();
  Crowns.setup({ api: (...a) => Account.api(...a), session: () => Account.session(), dev: () => Progress.deviceTok(), toast, openView: (v) => Account.open(v), signIn: () => Account.open('auth'),
    onChange: () => { applyPrefs(); renderCrownTile(); if (!$('sheet-settings').hidden) openSettings(); },
    onCos: (c) => Account.setCos(c), use: useItem,
    playBot: (id) => { const b = Bots.botById(id); if (!b) return; Account.close(); newGame({ mode: 'ai', bot: id, level: b.lvl, color: 'w', tc: 'none' }); } });
  applyPrefs();
  wire();
  rebuildPieces();
  if (clock && clock.started && !result && chess.history().length) { clock.running = true; clock.turnStart = performance.now(); }
  render(false);
  engine.start();
  Tourney.setup({ toast, onClose: () => { if (settings.mode !== 'online') render(false); } });
  Review.setup({ toast, gate: (k) => Crowns.reviewGate(k), sound: (mv, fen) => { if (!prefs.sound) return; const c = new Chess(fen); if (c.inCheck()) sound.play('check'); else if (mv.captured) sound.play('capture'); else if (mv.flags.includes('k') || mv.flags.includes('q')) sound.play('castle'); else sound.play('move'); } });
  // back button / gesture: full-screen views close first (the Android app calls __kingsideViewBack)
  const moveSound = (mv, c) => { if (!prefs.sound) return; if (c.inCheck()) sound.play('check'); else if (mv.captured) sound.play('capture'); else if (mv.flags.includes('k') || mv.flags.includes('q')) sound.play('castle'); else if (mv.promotion) sound.play('promote'); else sound.play('move'); };
  Learn.setup({ toast, sound: moveSound, confetti: Tourney.confetti, onClose: () => { renderLearnTile(); syncTabs(); } });
  Puzzles.setup({ toast, sound: moveSound, onChange: (s) => { renderQuick(); Account.puzzlesChanged(s); }, onClose: renderQuick });
  Account.setup({ toast, onUser: (u) => { if (u && !prefs.name) { prefs.name = u.display; savePrefs(); $('online-name').value = u.display; } renderQuick(); if (view === 'home') renderHub(); },
    onProgress: () => { if (view === 'home') renderStreak(); },
    enterRoom: (code, tok) => { Net.rememberSeat(code, tok); Tourney.isOpen() && Tourney.close(); Account.isOpen() && Account.close(); Puzzles.isOpen() && Puzzles.close(); Review.isOpen() && Review.close(); Learn.isOpen() && Learn.close(); document.querySelectorAll('.sheet-backdrop').forEach((b) => (b.hidden = true)); joinByCode(code, { quiet: true }).then(() => { if (!online || !online.state || online.state.status !== 'active') return; sound.unlock(); sound.play('start'); toast('Opponent found · good luck!'); }); },
    notify: () => { sound.unlock(); sound.play('check'); if (navigator.vibrate) navigator.vibrate([30, 60, 30]); },
    playComputer: (tc) => { leaveOnline(); newGame({ mode: 'ai', level: 4, color: 'r', tc: TCS[tc] ? tc : 'none' }); } });
  Account.wireQuick();
  Account.wireFriends();
  Share.setup({ api: Account.api, toast }); Share.wire();
  Streak.setup({ toast });
  Crowns.checkin();
  window.addEventListener('kingside-frozen', (e) => { Progress.addFrozen(e.detail); renderStreak(); });
  let crownSess = Account.session();
  window.addEventListener('kingside-user', () => { if (Account.session() !== crownSess) { crownSess = Account.session(); Crowns.checkin(); } });
  wireChat();
  window.__kingsideViewBack = () => {
    if (Account.matchFoundOpen()) return true;                      // v1.8.3: answer the match-found prompt with its buttons
    if (Account.seekCardOpen()) { Account.minimizeSeek(); return true; } // v1.8.3: Back puts the search card away, the search keeps going
    if (Review.back() || Puzzles.back() || Learn.back() || Account.back()) return true;
    if (Tourney.isOpen()) return Tourney.back();
    if (view === 'game') { goHome(); return true; }   // in a game: back goes to the home screen
    return false;
  };
  // back on the home screen after an overlay (puzzles, profile, tournaments): repaint the hub with fresh ratings
  const overlayOpen = () => /\b(p-open|l-open|a-open|t-open|r-open)\b/.test(document.body.className);
  let wasOverlay = overlayOpen();
  new MutationObserver(() => { const o = overlayOpen(); if (wasOverlay && !o && view === 'home') { renderHub(); Account.refreshMe(); } wasOverlay = o; })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'home') { renderHub(); Account.refreshMe(); } });
  // v1.8.2: on the website the phone's Back button closes an open sheet (new game, settings, result…) instead of leaving the game.
  // The Android/Windows apps do this through window.__kingsideBack, so this only runs in a browser.
  const inApp = () => !!window.KingsideNative || document.documentElement.classList.contains('in-app');
  const openSheets = () => [...document.querySelectorAll('.sheet-backdrop')].filter((b) => !b.hidden && b.isConnected);
  let sheetEntry = false, skipPop = 0;
  const syncSheetHistory = () => {
    if (inApp()) return;
    const open = openSheets().length > 0;
    if (open && !sheetEntry) { try { history.pushState({ ...(history.state || {}), ksheet: 1 }, ''); sheetEntry = true; } catch (e) {} }
    else if (!open && sheetEntry) { sheetEntry = false; if (history.state && history.state.ksheet) { skipPop++; history.back(); } }
  };
  new MutationObserver(syncSheetHistory).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop--; return; }
    if (sheetEntry) {
      sheetEntry = false;
      const open = openSheets(), top = open[open.length - 1];
      if (top) { const close = top.querySelector('[id$="-close"], [id$="-cancel"], [id$="-done"], #confirm-no'); if (close) close.click(); else top.hidden = true; }
      setTimeout(syncSheetHistory, 0);
      return;
    }
    if (Review.isOpen()) Review.close(); else if (Puzzles.isOpen()) Puzzles.back(); else if (Learn.isOpen()) Learn.back(); else if (Account.isOpen()) Account.back();
    else if (view === 'game' && !(history.state && history.state.kview === 'game') && !Tourney.isOpen()) showView('home', { push: false });
  });
  renderQuick();
  const roomParam = Net.cleanCode(new URLSearchParams(location.search).get('room'));
  const tParam = Net.cleanCode(new URLSearchParams(location.search).get('t'));
  const cur = Net.currentRoom();
  const fallback = () => { setOnlineUI(false); if (had) maybeEngineMove(); renderHub(); };
  const pzParam = new URLSearchParams(location.search).get('puzzle');
  // v1.7: /?g=<id> opens a shared game in Game Review
  const gParam = (new URLSearchParams(location.search).get('g') || '').replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (gParam) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    Account.api('share?id=' + gParam).then((d) => {
      const x = d.game;
      Review.open({ moves: x.moves.split(' '), white: x.white, black: x.black, wr: x.wr, br: x.br, result: x.result === '1/2-1/2' ? '½-½' : x.result, reason: x.reason, orientation: 'w', mine: false });
      try { history.pushState({ kview: 'review' }, ''); } catch (e) {}
    }).catch(() => toast('That shared game could not be loaded'));
  }
  if (pzParam && !roomParam && !tParam) { try { history.replaceState(null, '', location.pathname); } catch (e) {} setOnlineUI(false); if (had) maybeEngineMove(); Puzzles.open(pzParam === 'daily' ? 'daily' : null); }
  else
  if (tParam && !roomParam) {
    setOnlineUI(false);
    Tourney.open(tParam);
    if (had) maybeEngineMove();
  } else if (roomParam) {
    setOnlineUI(true);
    $('status').textContent = 'Joining game ' + roomParam + '…'; $('substatus').textContent = '';
    joinByCode(roomParam, { quiet: !!Net.seatFor(roomParam) }).then((ok) => {
      if (!ok) { try { history.replaceState(null, '', location.pathname); } catch (e) {} settings.mode = had ? settings.mode : 'ai'; render(false); fallback(); }
    });
  } else if (cur && cur.code) {
    // reopened the app: go back into an online game that is still running
    Net.poll(cur.code, cur.tok, -1).then((st) => {
      if (st && st.you && st.status !== 'over') joinByCode(cur.code, { quiet: true });
      else { Net.forgetCurrent(); fallback(); }
    }).catch((e) => { if (e.http) Net.forgetCurrent(); fallback(); });
  } else fallback();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__chess = { showRankUp, chess, get result() { return result; }, get thinking() { return thinking; }, get settings() { return settings; }, get online() { return online; }, engine, newGame, makeMove };
}
init();
