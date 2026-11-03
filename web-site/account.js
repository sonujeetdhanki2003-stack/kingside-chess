// Accounts (username + password, or guest), profiles with a rating graph, game history, and quick match.
import * as Review from './review.js';
import * as Progress from './progress.js';
import * as Streak from './streak.js';
import * as Crowns from './crowns.js';
import * as Ranks from './ranks.js';
import { stats as puzzleStats, replaceStats as replacePuzzleStats } from './puzzles.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SKEY = 'kingside-session-v1', UKEY = 'kingside-user-v1', LOCAL = 'kingside-history-v1', DEV = 'kingside-device-v1';
const TC_LABEL = { '1+0': '1 + 0', '2+1': '2 + 1', '3+2': '3 + 2', '5+0': '5 + 0', '10+0': '10 + 0', '15+10': '15 + 10', none: 'Unlimited' };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
export const session = () => ls.get(SKEY, null);
export const user = () => ls.get(UKEY, null);
const devTok = () => { const t = ls.get(DEV, null); return /^[a-f0-9]{32}$/.test(t || '') ? t : null; };
let opts = { toast: () => {}, onUser: () => {}, enterRoom: () => {}, playComputer: () => {} };
let view = 'profile', stack = [], profileCache = null, config = { google: null };

async function call(path, { body, timeout = 15000, signal } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort()); }
  try {
    const res = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: body ? { 'content-type': 'application/json' } : undefined, cache: 'no-store', signal: ctl.signal });
    let d = null; try { d = await res.json(); } catch (e) {}
    if (!res.ok || !d || d.ok === false) { const e = new Error((d && d.error) || 'Server answered ' + res.status); e.code = (d && d.code) || 'http'; e.status = res.status; throw e; }
    return d;
  } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) { const x = new Error('No connection. Check your internet.'); x.code = 'offline'; throw x; } throw e; }
  finally { clearTimeout(t); }
}
export const api = call;
function setUser(s, u) {
  const changed = (s || null) !== session();
  if (s) ls.set(SKEY, s);
  if (u) ls.set(UKEY, u); else { ls.del(SKEY); ls.del(UKEY); }
  renderTopAvatar(); opts.onUser(u);
  try { window.dispatchEvent(new CustomEvent('kingside-user')); } catch (e) {}
  if (changed) {
    startPresence();
    // streaks + achievements: a sign-in merges this phone's progress into the account; signing out leaves the account's copy behind
    if (s) Progress.sync(); else Progress.reset();
  }
}
// fresh rating/record for the home card: cheap (no profile), at most every few seconds unless forced
let meAt = 0;
export function refreshMe(force) {
  const s = session(); if (!s) return Promise.resolve(null);
  if (!force && Date.now() - meAt < 4000) return Promise.resolve(user());
  meAt = Date.now();
  return call('u/me?lite=1&s=' + s).then((d) => { if (session() === s) setUser(s, d.user); return d.user; })
    .catch((e) => { if (e.status === 401 && session() === s) setUser(null, null); return null; });
}

/* ---------------- local + server history ---------------- */
export function saveGame(g) {
  // g: { moves: [uci], white, black, result, reason, source, color, tc }
  if (!g.moves || !g.moves.length) return;
  const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const list = ls.get(LOCAL, []);
  list.unshift({ ...g, moves: g.moves.join(' '), ended: Date.now(), key });
  ls.set(LOCAL, list.slice(0, 40));
  const s = session();
  if (s && (g.source === 'ai' || g.source === 'pvp')) {
    call('u/savegame', { body: { s, key, moves: g.moves.join(' '), result: g.result, reason: g.reason, source: g.source, color: g.color, opp: g.color === 'w' ? g.black : g.white, tc: g.tc } }).catch(() => {});
  }
}

/* ---------------- puzzle rating sync ---------------- */
let pzTimer = null;
export function puzzlesChanged(s) {
  if (!session()) return;
  clearTimeout(pzTimer);
  pzTimer = setTimeout(() => call('u/update', { body: { s: session(), puzzle: slimPuzzle(s) } }).catch(() => {}), 1500);
}
const slimPuzzle = (s) => ({ r: s.r, rd: s.rd, n: s.n, won: s.won, best: s.best, streak: s.streak, daily: s.daily, hist: (s.hist || []).slice(-60), solved: (s.solved || []).slice(-600) });
function mergePuzzles(server) {
  const local = puzzleStats();
  if (server && (server.n || 0) > (local.n || 0)) replacePuzzleStats({ ...local, ...server, daily: { ...(local.daily || {}), ...(server.daily || {}) } });
  else if (local.n) puzzlesChanged(local);
}

/* ---------------- screen ---------------- */
export function setup(o) {
  opts = { ...opts, ...o };
  Progress.setup({ api: call, session, onChange: () => { opts.onProgress && opts.onProgress(); if (isOpen() && (view === 'achievements' || view === 'profile')) render(); } });
  $('a-back').onclick = () => back() || close();
  $('ascreen').addEventListener('click', onClick);
  $('ascreen').addEventListener('submit', onSubmit);
  renderTopAvatar();
  startPresence();
  call('u/config').then((c) => { config = c; }).catch(() => {});
  // refresh the signed-in user (and attach this device's tournament history to the account)
  const s = session();
  if (s) call('u/me?' + new URLSearchParams({ s, dev: devTok() || '' })).then((d) => { setUser(s, d.user); profileCache = d.profile; mergePuzzles(d.user.puzzle); Progress.sync(); })
    .catch((e) => { if (e.status === 401) setUser(null, null); });
}
export const isOpen = () => !$('ascreen').hidden;
export function open(v = null, arg = null) {
  $('ascreen').hidden = false; document.body.classList.add('a-open');
  try { history.pushState({ kview: 'account' }, ''); } catch (e) {}
  stack = []; $('ascreen').dataset.v = '';
  go(v || (session() ? 'profile' : 'auth'), arg);
}
export function close() { $('ascreen').hidden = true; document.body.classList.remove('a-open'); stack = []; }
export function back() {
  if (!isOpen()) return false;
  if (stack.length) { const [v, a] = stack.pop(); go(v, a, true); return true; }
  close(); return true;
}
function reset(v, arg) { stack = []; $('ascreen').dataset.v = ''; go(v, arg); }
function go(v, arg, isBack) {
  if (!isBack && view && $('ascreen').dataset.v && view !== v) stack.push([view, curArg]);
  view = v; curArg = arg; $('ascreen').dataset.v = v;
  $('a-body').scrollTop = 0; $('ascreen').scrollTop = 0;
  render();
}
let curArg = null;
export function setCos(cos) { const u = user(); if (u) { ls.set(UKEY, { ...u, cos }); renderTopAvatar(); } }
function renderTopAvatar() {
  const u = user(); const el = $('btn-account');
  el.innerHTML = u ? (u.cos && (u.cos.frame || u.cos.avatar) ? Crowns.avatarHtml(u.cos, (u.display || u.uname)[0].toUpperCase()) : `<span class="av-letter">${esc((u.display || u.uname)[0].toUpperCase())}</span>`) : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-9 2.2-9 5v3h18v-3c0-2.8-4.6-5-9-5z"/></svg>';
  el.setAttribute('aria-label', u ? 'Your profile' : 'Sign in');
  el.classList.toggle('signed-in', !!u);
}

function render() {
  const body = $('a-body');
  body.onclick = null; if (!Crowns.title(view)) Crowns.leave();
  const T = { shop: 'Crown Shop', crowns: 'Crown history', earn: 'Earn Crowns', leaderboard: 'Leaderboard', streak: 'Daily streak', achievements: 'Achievements', auth: 'Sign in', signup: 'Create account', recover: 'Reset password', codes: 'Recovery codes', profile: 'Profile', player: 'Player', history: 'Game history', settings: 'Account settings', friends: 'Friends' };
  $('a-title').textContent = T[view] || 'Account';
  if (view === 'auth' || view === 'signup' || view === 'recover') body.innerHTML = authHtml(view);
  else if (view === 'codes') body.innerHTML = codesHtml(curArg);
  else if (view === 'profile') { body.innerHTML = profileHtml(profileCache, true); loadProfile(); }
  else if (view === 'player') { body.innerHTML = '<div class="a-card a-center a-muted">Loading…</div>'; loadPlayer(curArg); }
  else if (view === 'history') { body.innerHTML = '<div class="a-card a-center a-muted">Loading…</div>'; loadHistory(); }
  else if (view === 'settings') body.innerHTML = settingsHtml();
  else if (view === 'friends') renderFriends(body);
  else if (view === 'achievements') body.innerHTML = achievementsHtml();
  else if (view === 'streak') { body.innerHTML = Streak.html(); Streak.wireView(body, () => { if (view === 'streak') render(); }); }
  else if (view === 'leaderboard') { body.innerHTML = lbHtml(); loadLb(); }
  else if (Crowns.title(view)) Crowns.render(view, body);
}

/* ---------------- v1.7 ratings: "1523" or "1500?" while provisional, leaderboard ---------------- */
export const POOLS = [['bullet', '🚀 Bullet', '1+0 · 2+1'], ['blitz', '⚡ Blitz', '3+2 · 5+0'], ['rapid', '🕙 Rapid', '10+0 · 15+10']]; // v1.9: + Bullet
export const poolName = (k) => (POOLS.find((x) => x[0] === k) || POOLS[1])[1];
export { Ranks };
export const rtxt = (r) => (r ? `${r.r}${r.p ? '?' : ''}` : '–');
export const poolOf = (tc) => { const m = /^(\d+)\+(\d+)$/.exec(String(tc || '')); if (!m) return null; const e = +m[1] * 60 + 40 * +m[2]; return e < 180 ? 'bullet' : e < 480 ? 'blitz' : 'rapid'; };
// the pool with the most rated games (Blitz on a tie): the home screen and profile badge use it
export function mainPool(ratings) { const r = ratings || {}; return ['blitz', 'rapid', 'bullet'].sort((a, b) => ((r[b] && r[b].n) || 0) - ((r[a] && r[a].n) || 0))[0]; }
export function myRating(pool) { const u = user(); return u && u.ratings && u.ratings[pool] ? u.ratings[pool] : null; }
let lbPool = 'blitz', lbData = {};
function lbHtml() {
  const tabs = POOLS.map(([k, n]) => `<button type="button" data-lbpool="${k}" class="${k === lbPool ? 'on' : ''}">${n}</button>`).join('');
  const d = lbData[lbPool];
  let list = '<div class="a-center a-muted lb-load">Loading…</div>';
  if (d && d.err) list = `<div class="a-center a-muted lb-load">${esc(d.err)}</div>`;
  else if (d) {
    const row = (x, me) => `<li class="lb-row${me ? ' me' : ''}${x.rank && x.rank <= 3 ? ' top' + x.rank : ''}"><span class="lb-rank">${x.rank ? (x.rank <= 3 ? ['🥇', '🥈', '🥉'][x.rank - 1] : x.rank) : '–'}</span>
      <button type="button" class="lb-who" data-player="${esc(x.uname)}"><span class="f-av${x.cos && (x.cos.avatar || x.cos.frame) ? ' f-av-cos' : ''}">${x.cos && (x.cos.avatar || x.cos.frame) ? Crowns.avatarHtml(x.cos, (x.display || x.uname || '?')[0].toUpperCase()) : esc((x.display || x.uname)[0].toUpperCase())}${x.online ? '<i></i>' : ''}</span><span><b>${esc(x.display)}</b><small>@${esc(x.uname)} · ${x.n} game${x.n === 1 ? '' : 's'}</small></span></button>
      <span class="lb-r">${Ranks.rankMini(x, 16)}${x.r}${x.p ? '<sup title="Provisional: fewer rated games">?</sup>' : ''}</span></li>`;
    const mine = d.me;
    const meInList = mine && d.list.some((x) => x.uname === mine.uname);
    list = (d.list.length ? `<ol class="lb-list">${d.list.map((x) => row(x, mine && x.uname === mine.uname)).join('')}</ol>` : '<div class="a-center a-muted lb-load">No rated games yet. Play a rated Quick Match to be first!</div>')
      + (mine && !meInList ? `<div class="lb-you"><span class="a-muted a-small">Your rank</span><ol class="lb-list">${row(mine, true)}</ol>${mine.n ? '' : '<p class="a-small a-muted">Play a rated game to get on the board.</p>'}</div>` : '')
      + (!session() ? '<p class="a-small a-muted lb-note"><button type="button" class="a-link" data-go="auth">Sign in</button> to play rated games and get a rank.</p>' : '');
  }
  return `<div class="a-card lb-card"><div class="seg lb-tabs">${tabs}</div>
    <p class="a-small a-muted lb-help">Glicko-2 ratings, like Lichess. Everyone starts at 1500; a <b>?</b> means provisional (still settling, fewer rated games). Players with a settled rating are ranked first.${d && d.total ? ` · ${d.total} rated player${d.total === 1 ? '' : 's'}` : ''}</p>${list}</div>
    <div class="a-card rk-ladder"><h3>Ranks</h3><ul>${Ranks.RANKS.map((rk, i) => `<li>${Ranks.rankIcon(rk, 22)}<b>${rk.name}</b><span data-i18n-skip>${i ? (Ranks.RANKS[i + 1] ? `${rk.min}–${Ranks.RANKS[i + 1].min - 1}` : `${rk.min}+`) : `< ${Ranks.RANKS[1].min}`}</span></li>`).join('')}</ul>
    <p class="a-small a-muted">Your rank shows once your rating settles (no <b>?</b>). Each time control has its own rating and rank.</p></div>`;
}
async function loadLb() {
  const pool = lbPool;
  try { const d = await call(`u/leaderboard?pool=${pool}` + (session() ? '&s=' + session() : '')); lbData[pool] = d; }
  catch (e) { if (!lbData[pool] || lbData[pool].err) lbData[pool] = { err: e.code === 'offline' ? 'The leaderboard needs internet.' : e.message }; }
  if (view === 'leaderboard' && pool === lbPool) $('a-body').innerHTML = lbHtml();
}
function streakCard() {
  const st = Progress.streak();
  const today = Progress.istDate();
  const days = new Set(Progress.load().days);
  // the last 7 days as dots, oldest first
  const week = [...Array(7)].map((_, i) => { const d = Progress.istDate(Date.now() - (6 - i) * 864e5); return `<i class="${days.has(d) ? 'on' : ''}${d === today ? ' today' : ''}" title="${d}"><small>${new Date(d + 'T12:00:00Z').toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'narrow' })}</small></i>`; }).join('');
  return `<div class="a-card st-card"><div class="st-top"><span class="st-flame${st.cur ? '' : ' off'}">🔥</span><div><b>${st.cur} day${st.cur === 1 ? '' : 's'}</b><small>${st.today ? 'Streak safe for today ✅' : st.cur ? 'Play a game or solve the Daily Puzzle today to keep it' : 'Play a game or solve the Daily Puzzle to start a streak'}</small></div><div class="st-best"><b>${st.best}</b><small>best</small></div></div><div class="st-week">${week}</div></div>`;
}
function achievementsHtml() {
  const p = Progress.load();
  return `${streakCard()}<div class="a-card"><div class="a-ghead"><h3>Badges</h3><span class="a-muted">${Progress.count(p)} / ${Progress.ACH.length}</span></div>${Progress.badgesHtml(p)}
    ${session() ? '' : '<p class="a-small a-muted">Saved on this phone. Create a free account to keep them on any phone.</p>'}</div>`;
}
function achCard(prog, mine) {
  const p = mine ? Progress.load() : prog || { ach: {} };
  const got = Progress.ACH.filter((a) => p.ach && p.ach[a.id]);
  const chips = got.slice(-8).reverse().map((a) => `<span class="ach-chip" title="${esc(a.name)}: ${esc(a.desc)}">${a.icon}</span>`).join('');
  return `<div class="a-card"><div class="a-ghead"><h3>Achievements <span class="a-muted">${got.length} / ${Progress.ACH.length}</span></h3>${mine ? '<button type="button" class="a-link" data-go="achievements">See all</button>' : ''}</div>
    <div class="ach-chips">${chips || `<span class="a-muted a-small">${mine ? 'None yet. Win a game, solve the Daily Puzzle or try Puzzle Rush.' : 'None yet.'}</span>`}</div></div>`;
}
function authHtml(v) {
  const g = config.google && !document.documentElement.classList.contains('in-app') ? `<div class="a-or"><span>or</span></div><div id="g-btn" class="a-google"></div>` : '';
  if (v === 'recover') return `<div class="a-card"><h2>Forgot your password?</h2><p class="a-muted">Use one of the recovery codes you saved when you made the account. Each code works once.</p>
    <form data-form="recover" class="a-form" autocomplete="off">
      <label>Username<input name="username" required autocapitalize="none" autocomplete="username" maxlength="20"></label>
      <label>Recovery code<input name="code" required placeholder="ABCDE-12345" autocapitalize="characters" maxlength="12"></label>
      <label>New password or PIN<input name="password" type="password" required minlength="4" autocomplete="new-password"></label>
      <p class="a-err" hidden></p><button class="btn btn-gold a-big" type="submit">Reset password</button></form>
    <p class="a-small a-center"><button type="button" class="a-link" data-go="auth">Back to sign in</button></p></div>`;
  const su = v === 'signup';
  return `<div class="a-hero"><div class="a-logo"><img src="pieces/wN.svg" alt=""></div><h2>${su ? 'Create your account' : 'Welcome back'}</h2>
      <p>${su ? 'Keep your rating, puzzles and game history on any phone. No email needed.' : 'Sign in to see your rating, games and friends.'}</p></div>
    <div class="a-card"><div class="a-tabs"><button type="button" data-go="auth" class="${su ? '' : 'on'}">Sign in</button><button type="button" data-go="signup" class="${su ? 'on' : ''}">New account</button></div>
    <form data-form="${su ? 'signup' : 'login'}" class="a-form">
      <label>Username<input name="username" required autocapitalize="none" autocomplete="username" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or _"></label>
      ${su ? '<label>Name to show <small>(optional)</small><input name="display" maxlength="20" autocomplete="nickname" placeholder="e.g. Sonujeet"></label>' : ''}
      <label>Password or PIN<input name="password" type="password" required minlength="4" autocomplete="${su ? 'new-password' : 'current-password'}"></label>
      ${su ? '<label>Email <small>(optional)</small><input name="email" type="email" maxlength="120" autocomplete="email" placeholder="you@example.com"></label>' : ''}
      <p class="a-err" hidden></p>
      <button class="btn btn-gold a-big" type="submit">${su ? 'Create account' : 'Sign in'}</button></form>
    ${su ? '' : '<p class="a-small a-center"><button type="button" class="a-link" data-go="recover">Forgot password?</button></p>'}${g}</div>
    <div class="a-card a-guest"><p>Just want to play? You’re already playing as a <b>guest</b>. Your games and puzzles stay on this phone.</p><button type="button" class="btn btn-ghost" data-act="close">Continue as guest</button></div>`;
}
function codesHtml(codes) {
  return `<div class="a-card"><h2>🔑 Save your recovery codes</h2>
    <p class="a-muted">If you forget your password, one of these codes lets you set a new one. Each works once. <b>Screenshot them or write them down now</b>: they won’t be shown again.</p>
    <div class="a-codes">${(codes || []).map((c) => `<code>${esc(c)}</code>`).join('')}</div>
    <div class="a-row"><button type="button" class="btn btn-ghost" data-act="copycodes">Copy codes</button><button type="button" class="btn btn-gold" data-act="codesdone">I saved them</button></div></div>`;
}
let graphPool = null, graphRange = 'all', shownProfile = null;
const RANGES = [['30', '30 days'], ['90', '90 days'], ['all', 'All time']];
function ratingCard(p, r) {
  if (!p.graphs) return `<div class="a-card"><div class="a-ghead"><h3>Rating</h3><span class="a-muted">${r.games} rated game${r.games === 1 ? '' : 's'}</span></div>${ratingGraph(p.graph)}</div>`;
  const gp = graphPool && p.graphs[graphPool] ? graphPool : p.main || 'blitz';
  const R = p.ratings[gp] || { r: 1500, p: true, n: 0 };
  const tabs = POOLS.map(([k, n]) => `<button type="button" data-gpool="${k}" class="${k === gp ? 'on' : ''}">${n}</button>`).join('');
  const rng = RANGES.map(([k, n]) => `<button type="button" data-grange="${k}" class="${k === graphRange ? 'on' : ''}">${n}</button>`).join('');
  return `<div class="a-card a-rcard"><div class="a-ghead"><h3>Rating history</h3>${Ranks.rankBadge(R)}</div>
    <div class="seg lb-tabs">${tabs}</div>
    <div class="a-rnow"><b data-i18n-skip>${rtxt(R)}</b><span class="a-muted">${R.n} rated game${R.n === 1 ? '' : 's'}${R.p ? ' · provisional' : ''}</span></div>
    ${ratingGraph(p.graphs[gp], graphRange, R)}
    <div class="seg a-ranges">${rng}</div></div>`;
}
// v1.9: a light SVG chart, one step per rated game (equal spacing reads better than a time axis when games come in bursts),
// rank thresholds as guide lines, the peak marked, a 30 / 90 day / all-time range
function ratingGraph(points, range = 'all', R = null) {
  const empty = '<div class="a-graph-empty">Play rated games (Quick Match, or a friend game marked Rated) to draw your rating graph.</div>';
  if (!points || points.length < 2) return empty;
  const pts = points.map((x, i) => (i ? x : { ...x, origin: true })).sort((a, b) => a.t - b.t); // the server's first point is the 1500 start
  const now = Date.now(), since = range === '30' ? now - 30 * 864e5 : range === '90' ? now - 90 * 864e5 : -Infinity;
  let sel = pts.filter((x) => x.t >= since);
  const before = pts.filter((x) => x.t < since);
  if (before.length) sel = [{ ...before[before.length - 1], start: true }, ...sel];
  const games = sel.filter((x) => !x.start && !x.origin).length;
  if (sel.length < 2) sel = [sel[0], { ...sel[0], t: now }];
  const W = 600, H = 190, padL = 6, padR = 6, padT = 34, padB = 12;
  const rs = sel.map((x) => x.r);
  let lo = Math.min(...rs), hi = Math.max(...rs);
  const span = Math.max(60, hi - lo); lo -= span * 0.15; hi += span * 0.15;
  const n = sel.length;
  const X = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * (W - padL - padR)), Y = (r) => padT + (1 - (r - lo) / (hi - lo)) * (H - padT - padB);
  const pc = (v, of) => ((v / of) * 100).toFixed(2);
  const line = sel.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.r).toFixed(1)}`).join(' ');
  // guide lines: the rank thresholds inside the range, else two round numbers
  let guides = Ranks.RANKS.filter((rk) => rk.min > lo && rk.min < hi).map((rk) => ({ v: rk.min, rk }));
  if (!guides.length) { const step = span > 300 ? 100 : 50; for (let v = Math.ceil(lo / step) * step; v < hi; v += step) guides.push({ v }); guides = guides.slice(0, 4); }
  const gl = guides.map((g) => `<line x1="0" x2="${W}" y1="${Y(g.v).toFixed(1)}" y2="${Y(g.v).toFixed(1)}" stroke="${g.rk ? g.rk.c : '#fff'}" stroke-opacity="${g.rk ? 0.35 : 0.09}" stroke-dasharray="${g.rk ? '5 6' : '0'}" vector-effect="non-scaling-stroke"/>`).join('');
  const glab = guides.map((g) => `<span class="ag-y" style="top:${pc(Y(g.v), H)}%">${g.rk ? Ranks.rankIcon(g.rk, 13) : ''}<i data-i18n-skip>${g.v}</i></span>`).join('');
  // peak: the highest point in the range
  let pi = 0; sel.forEach((x, i) => { if (x.r > sel[pi].r) pi = i; });
  const last = n - 1, first = sel[0], cur = sel[last];
  const chg = Math.round(cur.r - first.r);
  const px = X(pi) / W, tx = px > 0.82 ? '-88%' : px < 0.18 ? '-12%' : '-50%';
  const peakLbl = n >= 2 ? `<span class="ag-peak" style="left:${pc(X(pi), W)}%;top:${pc(Y(sel[pi].r), H)}%;--tx:${tx}"><b data-i18n-skip>${sel[pi].r}</b><small>Peak</small></span>` : '';
  const date = (t) => new Date(t).toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  const allPeak = R && R.pk ? R.pk : null;
  return `<div class="a-gwrap"><svg class="a-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Rating graph"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb33f" stop-opacity=".42"/><stop offset="1" stop-color="#7fb33f" stop-opacity="0"/></linearGradient></defs>
    ${gl}<path d="${line} L${X(last).toFixed(1)},${H} L${X(0).toFixed(1)},${H} Z" fill="url(#ag)"/><path d="${line}" fill="none" stroke="#8fc552" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
    ${glab}<i class="ag-dot ag-peakdot" style="left:${pc(X(pi), W)}%;top:${pc(Y(sel[pi].r), H)}%"></i>${peakLbl}<i class="ag-dot ag-now" style="left:${pc(X(last), W)}%;top:${pc(Y(cur.r), H)}%"></i></div>
    <div class="a-graph-axis"><span>${first.start ? (range === '30' ? '30 days ago' : '90 days ago') : date(first.t)}</span><span class="ag-chg ${chg > 0 ? 'up' : chg < 0 ? 'down' : ''}">${chg > 0 ? '+' : chg < 0 ? '−' : '±'}${Math.abs(chg)} · ${Math.max(0, games)} game${games === 1 ? '' : 's'}</span><span>Today</span></div>
    ${allPeak ? `<p class="a-small a-muted ag-allpeak">All-time peak: <b data-i18n-skip>${allPeak}</b> ${Ranks.rankMini({ r: allPeak, p: false }, 14)}</p>` : ''}`;
}
function gameRow(g, mineId) {
  const color = g.color || (mineId ? (g.wuid === mineId ? 'w' : 'b') : 'w');
  const opp = color === 'w' ? g.black : g.white;
  const res = g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (color === 'w') ? 'w' : g.result === '*' ? 'n' : 'l';
  const icon = { w: '+', l: '−', d: '=', n: '·' }[res];
  const src = { quick: '⚡ Quick', online: '🌐 Online', tournament: '🏆 Tournament', ai: '🤖 Computer', pvp: '👥 2 players' }[g.source] || '';
  const delta = g.rated ? (color === 'w' ? g.dw : g.db) : null;
  const when = new Date(g.ended).toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  const n = Math.ceil(String(g.moves).split(' ').filter(Boolean).length / 2);
  return `<li class="a-game"><span class="a-res r-${res}">${icon}</span><span class="a-gmain"><b>vs ${esc(opp)}${delta != null ? ` <em class="rr-h ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}" data-i18n-skip>${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}</em>` : ''}</b><small>${src} · ${n} moves · ${when}</small></span>
    <button type="button" class="btn btn-ghost btn-sm" data-review="${esc(JSON.stringify({ m: g.moves, w: g.white, b: g.black, r: g.result, c: color }))}">Review</button></li>`;
}
function profileHtml(p, mine) {
  const u = user();
  if (mine && !u) {
    const local = ls.get(LOCAL, []);
    const pz = puzzleStats();
    return `<div class="a-card a-guest"><h2>Playing as a guest</h2><p class="a-muted">Make a free account to keep your rating, puzzles and history on any phone, add friends and play rated Quick Match.</p>
      <div class="a-row"><button type="button" class="btn btn-gold" data-go="signup">Create account</button><button type="button" class="btn btn-ghost" data-go="auth">Sign in</button></div></div>
      <div class="a-stats"><div><b>${Math.round(pz.r)}</b><small>🧩 Puzzles</small></div><div><b>${local.length}</b><small>Games here</small></div><div><b>${Progress.streak().cur}</b><small>🔥 Streak</small></div></div>
      ${achCard(null, true)}
      <div class="a-card"><h3>Games on this phone</h3><ul class="a-games">${local.map((g) => gameRow(g)).join('') || '<li class="a-muted">No finished games yet.</li>'}</ul></div>`;
  }
  if (!p) return '<div class="a-card a-center a-muted">Loading your profile…</div>';
  const t = p.totals, r = p.rated; shownProfile = p;
  const mp = p.ratings ? (p.main || mainPool(p.ratings)) : null, mR = mp ? p.ratings[mp] : null;
  return `<div class="a-phead"><div class="a-pav${(mine ? (u && u.cos) : p.cos) && ((mine ? u.cos : p.cos).frame || (mine ? u.cos : p.cos).avatar) ? ' a-pav-cos' : ''}">${Crowns.avatarHtml(mine ? (u && u.cos) || Crowns.state().cos : p.cos, (p.display || p.uname)[0].toUpperCase())}</div><div><h2>${esc(p.display)}${p.online ? ' <span class="a-on" title="Online"></span>' : ''}</h2>
      <p class="a-muted">@${esc(p.uname)} · joined ${new Date(p.created).toLocaleDateString(window.__i18n && window.__i18n.lang() === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short', year: 'numeric' })}</p>${mR ? `<p class="a-prank">${Ranks.rankBadge(mR)}<span class="a-muted">${poolName(mp)}</span></p>` : ''}</div>
      ${mine ? '<button type="button" class="icon-btn a-gear" data-go="settings" aria-label="Account settings"><svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>' : (session() && user() && user().uname !== p.uname ? `<button type="button" class="btn btn-gold btn-sm a-gear" data-act="fadd" data-uname="${esc(p.uname)}">+ Add friend</button>` : '')}</div>
    ${mine ? `<button type="button" class="btn quick-btn a-friendsbtn" data-go="friends"><span class="qi">👫</span><span><b>Friends</b><small>${friends.friends.filter((f) => f.state === 'friends' && f.online).length} online · challenge &amp; chat</small></span></button>` : ''}
    <div class="a-stats">
      ${p.ratings ? POOLS.map(([k, n]) => `<div><b>${Ranks.rankMini(p.ratings[k], 15)}${rtxt(p.ratings[k])}</b><small>${n}</small></div>`).join('') : `<div><b>${p.rating}</b><small>⚡ Rating</small></div>`}
      <div><b>${p.puzzle ? p.puzzle.r : '–'}</b><small>🧩 Puzzles</small></div>
    </div>
    ${mine ? `<button type="button" class="btn quick-btn a-crownbtn" data-go="shop"><span class="qi">👑</span><span><b>Crown Shop</b><small><span data-crowns>${Crowns.balance()}</span> Crowns · boards, pieces, frames</small></span></button>` : ''}
    <button type="button" class="btn quick-btn a-lbbtn" data-go="leaderboard"><span class="qi">🏆</span><span><b>Leaderboard</b><small>Top 50 · Bullet, Blitz &amp; Rapid${mine ? ' · your rank' : ''}</small></span></button>
    ${achCard(p.prog, mine)}
    ${ratingCard(p, r)}
    <div class="a-card"><h3>All games</h3>
      <div class="a-wdl"><div class="a-bar">${t.games ? `<i class="w" style="flex:${t.w}"></i><i class="d" style="flex:${t.d}"></i><i class="l" style="flex:${t.l}"></i>` : '<i class="e" style="flex:1"></i>'}</div>
      <div class="a-wdl-n"><span><b>${t.winPct}%</b> wins</span><span>${t.w} W</span><span>${t.d} D</span><span>${t.l} L</span><span>${t.games} games</span></div></div>
      ${p.tournament ? `<p class="a-small a-muted">🏆 Tournaments: ${p.tournament.games} games · ${p.tournament.w} W · ${p.tournament.d} D · ${p.tournament.l} L</p>` : ''}
    </div>
    <div class="a-card"><div class="a-ghead"><h3>Recent games</h3>${mine ? '<button type="button" class="a-link" data-go="history">See all</button>' : ''}</div>
      <ul class="a-games">${p.recent.map((g) => gameRow(g)).join('') || '<li class="a-muted">No games yet. Play a Quick Match!</li>'}</ul></div>`;
}
async function loadProfile() {
  const s = session(); if (!s) return;
  try { const d = await call('u/me?' + new URLSearchParams({ s, dev: devTok() || '' })); profileCache = d.profile; setUser(s, d.user); if (view === 'profile') $('a-body').innerHTML = profileHtml(profileCache, true); }
  catch (e) { if (e.status === 401) { setUser(null, null); go('auth'); } else if (!profileCache) $('a-body').innerHTML = `<div class="a-card a-center a-muted">${esc(e.message)}</div>`; }
}
async function loadPlayer(uname) {
  try { const d = await call('u/profile?name=' + encodeURIComponent(uname)); if (view === 'player') $('a-body').innerHTML = profileHtml(d.profile, false); }
  catch (e) { $('a-body').innerHTML = `<div class="a-card a-center a-muted">${esc(e.message)}</div>`; }
}
async function loadHistory() {
  const s = session();
  if (!s) { $('a-body').innerHTML = profileHtml(null, true); return; }
  try {
    const d = await call('u/games?s=' + s);
    $('a-body').innerHTML = `<div class="a-card"><ul class="a-games">${d.games.map((g) => gameRow(g)).join('') || '<li class="a-muted">No games yet.</li>'}</ul></div>`;
  } catch (e) { $('a-body').innerHTML = `<div class="a-card a-center a-muted">${esc(e.message)}</div>`; }
}
function settingsHtml() {
  const u = user() || {};
  return `<div class="a-card"><h3>Profile</h3><form data-form="update" class="a-form">
      <label>Name to show<input name="display" maxlength="20" value="${esc(u.display || '')}"></label>
      <label>Email <small>(optional, for your records)</small><input name="email" type="email" maxlength="120" value="${esc(u.email || '')}"></label>
      <p class="a-err" hidden></p><button class="btn btn-gold" type="submit">Save</button></form></div>
    <div class="a-card"><h3>Change password</h3><form data-form="password" class="a-form">
      <label>Current password<input name="oldPassword" type="password" autocomplete="current-password" required></label>
      <label>New password or PIN<input name="newPassword" type="password" minlength="4" autocomplete="new-password" required></label>
      <p class="a-err" hidden></p><button class="btn btn-gold" type="submit">Change password</button></form></div>
    <div class="a-card"><h3>Recovery codes</h3><p class="a-muted">Lost your codes? Make a new set (the old ones stop working).</p><button type="button" class="btn btn-ghost" data-act="newcodes">Make new codes</button></div>
    <div class="a-card"><button type="button" class="btn btn-danger a-big" data-act="logout">Sign out</button>
      <p class="a-small a-center"><button type="button" class="a-link a-del" data-act="delete">Delete my account</button></p></div>`;
}
async function onSubmit(e) {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form; const data = Object.fromEntries(new FormData(f).entries());
  if (kind === 'fsearch') { fsearch(data.q).catch((er) => opts.toast(er.message)); return; }
  const btn = f.querySelector('button[type=submit]'); const errEl = f.querySelector('.a-err');
  btn.disabled = true; errEl.hidden = true;
  try {
    if (kind === 'login' || kind === 'signup') {
      const body = { ...data, dev: devTok() };
      if (kind === 'signup') body.puzzle = slimPuzzle(puzzleStats());
      const d = await call('u/' + kind, { body });
      setUser(d.session, d.user); profileCache = null;
      mergePuzzles(d.user.puzzle);
      if (kind === 'signup') { reset('codes', d.recovery); }
      else { opts.toast(`Signed in as ${d.user.display}`); reset('profile'); }
    } else if (kind === 'recover') {
      const d = await call('u/recover', { body: { ...data, dev: devTok() } });
      setUser(d.session, d.user); opts.toast(`Password changed · ${d.codesLeft} recovery code${d.codesLeft === 1 ? '' : 's'} left`); reset('profile');
    } else if (kind === 'update') {
      const d = await call('u/update', { body: { s: session(), display: data.display, email: data.email } }); setUser(session(), d.user); opts.toast('Saved');
    } else if (kind === 'password') {
      await call('u/update', { body: { s: session(), oldPassword: data.oldPassword, newPassword: data.newPassword } }); f.reset(); opts.toast('Password changed');
    }
  } catch (er) { errEl.textContent = er.message; errEl.hidden = false; }
  finally { btn.disabled = false; }
}
async function onClick(e) {
  const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go, g.dataset.arg || null); return; }
  const r = e.target.closest('[data-review]');
  if (r) { const x = JSON.parse(r.dataset.review); Review.open({ moves: x.m.split(' ').filter(Boolean), white: x.w, black: x.b, result: x.r === '1/2-1/2' ? '½-½' : x.r, orientation: x.c || 'w', mine: view !== 'player' }); try { history.pushState({ kview: 'review' }, ''); } catch (er) {} return; }
  const lp = e.target.closest('[data-lbpool]'); if (lp) { lbPool = lp.dataset.lbpool; render(); return; }
  const gp = e.target.closest('[data-gpool]'), gr = e.target.closest('[data-grange]');
  if (gp || gr) { // v1.9: redraw just the rating card (no reload, no scroll jump)
    if (gp) graphPool = gp.dataset.gpool; else graphRange = gr.dataset.grange;
    const card = $('a-body').querySelector('.a-rcard');
    if (card && shownProfile) card.outerHTML = ratingCard(shownProfile, shownProfile.rated); else render();
    return;
  }
  const p = e.target.closest('[data-player]'); if (p) { go('player', p.dataset.player); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'close') close();
  else if (act === 'codesdone') { reset('profile'); }
  else if (act === 'copycodes') { const t = [...document.querySelectorAll('.a-codes code')].map((c) => c.textContent).join('\n'); try { await navigator.clipboard.writeText('Kingside Chess recovery codes (' + (user() || {}).uname + '):\n' + t); opts.toast('Copied'); } catch (er) { opts.toast('Long-press to copy'); } }
  else if (act === 'newcodes') { try { const d = await call('u/recovery', { body: { s: session() } }); go('codes', d.recovery); } catch (er) { opts.toast(er.message); } }
  else if (act === 'delete') {
    const pw = prompt('This deletes your account, rating and game history for good. Type your password to confirm:');
    if (pw === null) return;
    try { if (presenceCtl) presenceCtl.abort(); await call('u/delete', { body: { s: session(), password: pw } }); setUser(null, null); profileCache = null; opts.toast('Account deleted'); reset('auth'); } catch (er) { opts.toast(er.message); }
  }
  else if (act === 'logout') { const s = session(); call('u/logout', { body: { s } }).catch(() => {}); setUser(null, null); profileCache = null; opts.toast('Signed out'); reset('auth'); }
  else if (['fadd', 'faccept', 'fremove', 'challenge', 'chcancel'].includes(act)) friendAct(act, a);
  else if (opts.onAct) opts.onAct(act, a);
}

/* ---------------- quick match ---------------- */
// v1.8.3: the search runs in the background. The search card can be put away ("Browse while searching"): a slim
// bar pinned to the top keeps the time and a ✕, tapping it brings the card back. The time is drawn by its own
// ticker from Date.now() (it used to change only when a 6 s server long-poll came back, so it jumped 0:06, 0:13…),
// so it is right after navigating, after the screen dims and after the app comes back from the background.
// A match found from any screen shows "Match found!" with a short countdown, Play now and Decline.
let seek = null; // { id, tc, started, offered, offerOpen, min, polled, err }
let seekTicker = null, mf = null; // mf: the match-found prompt { m, tc, deadline, timer }
const MATCH_COUNTDOWN = 4; // seconds before a found match is joined on its own
export function openQuick() { $('sheet-quick').hidden = false; renderQuickSheet(); }
function renderQuickSheet() {
  const u = user();
  const qr = (k) => (rtxt(myRating(k)) === '–' ? '1500?' : rtxt(myRating(k)));
  $('quick-who').innerHTML = u ? `Rated as <b>${esc(u.display)}</b> · 🚀 ${qr('bullet')} · ⚡ ${qr('blitz')} · 🕙 ${qr('rapid')}` : 'Playing as a guest (unrated). <button type="button" class="a-link" id="quick-signin">Sign in</button> for a rating.';
  const b = $('quick-signin'); if (b) b.onclick = () => { $('sheet-quick').hidden = true; open('auth'); };
}
const fmtWait = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const seekWaited = () => (seek ? Math.max(0, Math.floor((Date.now() - seek.started) / 1000)) : 0);
export async function startSeek(tc, { minimized = false } = {}) {
  $('sheet-quick').hidden = true;
  cancelSeek(true);
  closeMatchFound();
  const name = (ls.get('kingside-chess-prefs-v1', {}).name || '').slice(0, 20);
  const my = seek = { tc, started: Date.now(), offered: false, offerOpen: false, min: !!minimized };
  seekTicker = setInterval(renderSeekTime, 250);
  showSeek('Finding an opponent…', null);
  try {
    const d = await call('q/seek', { body: { s: session(), tc, name } });
    if (seek !== my) { call('q/cancel', { body: { id: d.id } }).catch(() => {}); return; }
    my.id = d.id;
    if (d.matched) return matched(d.matched);
    showSeek('Finding an opponent…', d.online);
    loopSeek();
  } catch (e) { if (seek === my) { stopSeek(); opts.toast(e.message); } }
}
async function loopSeek() {
  const my = seek; if (!my) return;
  if (my.polled) await new Promise((r) => setTimeout(r, my.err ? 1500 : 30));
  my.polled = true; my.err = false;
  if (seek !== my) return;
  try {
    // long-poll: the server holds this up to 6 s and answers the instant we are paired
    const d = await call('q/poll?id=' + my.id + '&hold=6000', { timeout: 15000 });
    if (seek !== my) return;
    if (d.gone) { stopSeek(); opts.toast('The search ended. Tap Play again.'); return; }
    if (d.matched) return matched(d.matched);
    showSeek('Finding an opponent…', d.online);
  } catch (e) { if (seek !== my) return; if (e.code === 'no_seek') { stopSeek(); opts.toast(e.message); return; } my.err = true; }
  loopSeek();
}
// the clock: drawn from Date.now() 4× a second, independent of the network
function renderSeekTime() {
  if (!seek) return;
  const w = seekWaited(), t = fmtWait(w);
  $('seek-time').textContent = t;
  $('seekbar-time').textContent = t;
  if (w >= 30 && !seek.offered) { seek.offered = true; seek.offerOpen = true; renderSeekOffer(); }
}
function renderSeekOffer() {
  const on = !!(seek && seek.offerOpen);
  $('seek-fallback').hidden = !(on && !seek.min);
  $('seekbar-offer').hidden = !(on && seek.min);
}
function matched(m) {
  const tc = seek ? seek.tc : '5+0';
  stopSeek();
  showMatchFound(m, tc);
}
// stop searching (no server call) and put every search UI away
function stopSeek() {
  seek = null;
  clearInterval(seekTicker); seekTicker = null;
  hideSeek();
}
export function cancelSeek(quiet) {
  if (seek && seek.id) call('q/cancel', { body: { id: seek.id } }).catch(() => {});
  const had = !!seek;
  stopSeek();
  if (had && !quiet) opts.toast('Search cancelled');
}
function showSeek(text, online) {
  if (!seek) return;
  $('seek-text').textContent = text;
  const label = TC_LABEL[seek.tc] || seek.tc;
  $('seek-tc').textContent = label + ' · ' + (session() ? 'Rated' : 'Unrated');
  $('seekbar-tc').textContent = label;
  if (online != null) $('seek-online').textContent = `${online} player${online === 1 ? '' : 's'} online`;
  else if (!seek.id) $('seek-online').textContent = '';
  $('seek').hidden = seek.min;
  $('seekbar').hidden = !seek.min;
  document.body.classList.toggle('seeking', seek.min);
  renderSeekTime();
  renderSeekOffer();
}
function hideSeek() {
  $('seek').hidden = true; $('seek-fallback').hidden = true;
  $('seekbar').hidden = true; $('seekbar-offer').hidden = true;
  document.body.classList.remove('seeking');
}
// put the search card away and keep searching (the top bar shows the time)
export function minimizeSeek() { if (!seek) return; seek.min = true; showSeek($('seek-text').textContent); }
export function expandSeek() { if (!seek) return; seek.min = false; showSeek($('seek-text').textContent); }
export const seekCardOpen = () => !!seek && !seek.min;

/* match found: a short countdown, then the game opens on its own (Play now joins at once, Decline hands it back) */
function showMatchFound(m, tc) {
  closeMatchFound();
  mf = { m, tc, deadline: Date.now() + MATCH_COUNTDOWN * 1000 };
  const you = m.color === 'b' ? 'Black' : 'White';
  $('mf-sub').textContent = (TC_LABEL[tc] || tc) + ' · ' + (session() ? 'Rated' : 'Unrated') + ' · You play ' + you;
  $('mf-piece').src = 'pieces/' + (m.color === 'b' ? 'bK' : 'wK') + '.svg';
  $('match-found').hidden = false;
  if (opts.notify) { try { opts.notify(); } catch (e) {} }
  const step = () => {
    if (!mf) return;
    const left = Math.max(0, Math.ceil((mf.deadline - Date.now()) / 1000));
    $('mf-count').textContent = String(left);
    $('mf-ring').style.setProperty('--p', String(Math.max(0, Math.min(1, (mf.deadline - Date.now()) / (MATCH_COUNTDOWN * 1000)))));
    if (Date.now() >= mf.deadline) acceptMatch();
  };
  mf.timer = setInterval(step, 100);
  step();
}
function closeMatchFound() {
  if (mf) clearInterval(mf.timer);
  mf = null;
  const el = $('match-found'); if (el) el.hidden = true;
}
function acceptMatch() {
  if (!mf) return;
  const { m } = mf; closeMatchFound();
  opts.enterRoom(m.code, m.seat, { quick: true });
}
function declineMatch() {
  if (!mf) return;
  const { m } = mf; closeMatchFound();
  // the game has not started: abort it on the server so the other player is told at once (nothing is rated or recorded)
  call('action', { body: { code: m.code, tok: m.seat, type: 'abort' } }).catch(() => {});
  opts.toast('Match declined');
}
export const matchFoundOpen = () => !!mf;

export function wireQuick() {
  $('sheet-quick').addEventListener('click', (e) => { const b = e.target.closest('[data-tc]'); if (b) startSeek(b.dataset.tc); });
  $('quick-cancel').onclick = () => { $('sheet-quick').hidden = true; };
  $('seek-cancel').onclick = () => cancelSeek(true);
  $('seek-hide').onclick = () => minimizeSeek();
  $('seek').addEventListener('click', (e) => { if (e.target === $('seek')) minimizeSeek(); });
  const keepWaiting = () => { if (seek) { seek.offerOpen = false; renderSeekOffer(); } };
  const playAi = () => { const tc = seek ? seek.tc : '5+0'; cancelSeek(true); opts.playComputer(tc); };
  $('seek-wait').onclick = keepWaiting;
  $('seek-ai').onclick = playAi;
  $('seekbar-wait').onclick = keepWaiting;
  $('seekbar-ai').onclick = playAi;
  $('seekbar-x').onclick = (e) => { e.stopPropagation(); cancelSeek(); };
  $('seekbar-open').onclick = () => expandSeek();
  $('mf-play').onclick = () => acceptMatch();
  $('mf-decline').onclick = () => declineMatch();
  // back from the background: redraw the time at once (a long-poll that hung while the app slept times out on its own)
  const wake = () => { if (seek) renderSeekTime(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
  window.addEventListener('pageshow', wake);
  window.addEventListener('online', wake);
}
export const seeking = () => !!seek;

/* ---------------- friends + challenges ---------------- */
let friends = { friends: [], challenges: [] }, pingTimer = null, waitingFor = null, seenCh = new Set(), entered = new Set();
// Presence, friend requests and challenges: while the app is on screen we keep one long-poll open
// (the server answers the moment something changes for us); in the background we just ping every 30 s.
let fv = null, presenceGen = 0, presenceCtl = null;
export function startPresence() {
  clearTimeout(pingTimer);
  if (presenceCtl) presenceCtl.abort(); // drop the held request of the previous session
  const ctl = presenceCtl = new AbortController();
  const my = ++presenceGen; fv = null;
  const tick = async () => {
    if (my !== presenceGen) return;
    let delay = 0;
    if (session()) {
      const visible = document.visibilityState !== 'hidden';
      try {
        const d = visible && fv != null ? await call(`f/wait?s=${session()}&v=${fv}&hold=20000`, { timeout: 30000, signal: ctl.signal }) : await call('f/ping?s=' + session(), { signal: ctl.signal });
        if (my !== presenceGen) return;
        friends = d; fv = d.v || 0; onFriends();
        if (!visible) delay = 30000;
      } catch (e) { if (my !== presenceGen) return; if (e.status === 401) setUser(null, null); delay = 5000; }
    } else delay = 15000;
    pingTimer = setTimeout(tick, delay);
  };
  tick();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') startPresence(); });
function onFriends() {
  const inc = friends.friends.filter((f) => f.state === 'incoming').length;
  const chIn = friends.challenges.filter((c) => !c.mine && c.state === 'pending');
  $('btn-account').dataset.badge = inc + chIn.length || '';
  // a challenge for me: show the bar
  const bar = $('challenge-bar');
  const c = chIn[0];
  if (c) {
    bar.hidden = false; bar.dataset.id = c.id;
    $('challenge-text').innerHTML = `⚔️ <b>${esc(c.from)}</b> challenges you · ${TC_LABEL[c.tc] || c.tc}${c.rated ? ' · rated' : ''}`;
    if (!seenCh.has(c.id)) { seenCh.add(c.id); opts.notify && opts.notify(); }
  } else bar.hidden = true;
  // my challenge was accepted: go to the game
  const acc = friends.challenges.find((x) => x.mine && x.state === 'accepted' && x.room && !entered.has(x.id));
  if (acc && waitingFor === acc.id) { entered.add(acc.id); waitingFor = null; hideWaiting(); opts.enterRoom(acc.room, acc.seat); }
  const dec = friends.challenges.find((x) => x.mine && x.state === 'declined' && x.id === waitingFor);
  if (dec) { waitingFor = null; hideWaiting(); opts.toast(`${dec.to} declined the challenge`); }
  if (view === 'friends' && isOpen()) renderFriendsList();
}
function friendsHtml() {
  if (!session()) return `<div class="a-card a-center"><h2>Friends</h2><p class="a-muted">Sign in to add friends, see who’s online and challenge them.</p><div class="a-row"><button type="button" class="btn btn-gold" data-go="auth">Sign in</button></div></div>`;
  return `<div class="a-card"><form data-form="fsearch" class="f-search" autocomplete="off"><input name="q" placeholder="Find players by username" autocapitalize="none" maxlength="20" aria-label="Find players"><button class="btn btn-gold" type="submit">Search</button></form><ul class="f-list" id="f-results"></ul></div>
    <div id="f-lists"></div>`;
}
function fRow(f, kind) {
  const btns = kind === 'friends' ? `<button type="button" class="btn btn-review btn-sm" data-act="challenge" data-uid="${f.id}" data-name="${esc(f.display)}">⚔️ Challenge</button>`
    : kind === 'incoming' ? `<button type="button" class="btn btn-gold btn-sm" data-act="faccept" data-uid="${f.id}">Accept</button><button type="button" class="btn btn-ghost btn-sm" data-act="fremove" data-uid="${f.id}">✕</button>`
    : kind === 'sent' ? '<span class="a-muted f-small">Request sent</span>'
    : f.friend ? '<span class="a-muted f-small">Friend</span>' : `<button type="button" class="btn btn-ghost btn-sm" data-act="fadd" data-uname="${esc(f.uname)}">+ Add</button>`;
  return `<li class="f-row"><button type="button" class="f-who" data-player="${esc(f.uname)}"><span class="f-av">${esc((f.display || f.uname)[0].toUpperCase())}${f.online ? '<i></i>' : ''}</span><span><b>${esc(f.display)}</b><small>@${esc(f.uname)} · ${f.rating}${f.online ? ' · online' : ''}</small></span></button><span class="f-btns">${btns}</span></li>`;
}
function renderFriendsList() {
  const el = $('f-lists'); if (!el) return;
  const by = (s) => friends.friends.filter((f) => f.state === s).sort((a, b) => (b.online - a.online) || a.display.localeCompare(b.display));
  const inc = by('incoming'), fr = by('friends'), sent = by('sent');
  const myCh = friends.challenges.filter((c) => c.mine && c.state === 'pending');
  el.innerHTML = (inc.length ? `<div class="a-card"><h3>Friend requests</h3><ul class="f-list">${inc.map((f) => fRow(f, 'incoming')).join('')}</ul></div>` : '') +
    (myCh.length ? `<div class="a-card f-waitcard"><p>⏳ Waiting for <b>${esc(myCh[0].to)}</b> to accept your ${TC_LABEL[myCh[0].tc]} challenge…</p><button type="button" class="btn btn-ghost btn-sm" data-act="chcancel" data-id="${myCh[0].id}">Cancel</button></div>` : '') +
    `<div class="a-card"><h3>Friends <span class="a-muted">${fr.filter((f) => f.online).length} online</span></h3><ul class="f-list">${fr.map((f) => fRow(f, 'friends')).join('') || '<li class="a-muted">No friends yet. Search for their username above, or ask them for theirs.</li>'}</ul></div>` +
    (sent.length ? `<div class="a-card"><h3>Sent requests</h3><ul class="f-list">${sent.map((f) => fRow(f, 'sent')).join('')}</ul></div>` : '');
}
export function renderFriends(body) { body.innerHTML = friendsHtml(); renderFriendsList(); if (session()) call('f/list?s=' + session()).then((d) => { friends = d; onFriends(); }).catch(() => {}); startPresence(); }
async function fsearch(q) {
  const d = await call('u/search?q=' + encodeURIComponent(q));
  const me = user();
  const known = new Map(friends.friends.map((f) => [f.id, f.state]));
  $('f-results').innerHTML = d.users.filter((x) => !me || x.id !== me.id).map((x) => fRow({ ...x, friend: known.get(x.id) === 'friends' }, known.get(x.id) === 'sent' ? 'sent' : known.get(x.id) === 'incoming' ? 'incoming' : 'search')).join('') || '<li class="a-muted">No players found.</li>';
}
async function friendAct(act, el) {
  const s = session();
  try {
    if (act === 'fadd') { const d = await call('f/request', { body: { s, uname: el.dataset.uname } }); opts.toast(d.state === 'friends' ? 'You are now friends!' : 'Friend request sent'); el.outerHTML = '<span class="a-muted f-small">Request sent</span>'; }
    else if (act === 'faccept') { await call('f/accept', { body: { s, uid: +el.dataset.uid } }); opts.toast('Friend added'); }
    else if (act === 'fremove') await call('f/remove', { body: { s, uid: +el.dataset.uid } });
    else if (act === 'challenge') { openChallenge(+el.dataset.uid, el.dataset.name); return; }
    else if (act === 'chcancel') { await call('f/answer', { body: { s, id: el.dataset.id } }); waitingFor = null; hideWaiting(); }
    friends = await call('f/list?s=' + s); onFriends();
  } catch (e) { opts.toast(e.message); }
}
let chTarget = null;
function openChallenge(uid, name) {
  chTarget = { uid, name };
  $('chal-title').textContent = `⚔️ Challenge ${name}`;
  $('sheet-chal').hidden = false;
}
async function sendChallenge(tc) {
  $('sheet-chal').hidden = true;
  const color = $('sheet-chal').querySelector('[data-color].on')?.dataset.color || 'r';
  try {
    const rated = !!($('chal-rated') && $('chal-rated').checked && tc !== 'none');
    const d = await call('f/challenge', { body: { s: session(), uid: chTarget.uid, tc, color, rated } });
    waitingFor = d.id; showWaiting(chTarget.name, tc, rated); startPresence();
  } catch (e) { opts.toast(e.message); }
}
function showWaiting(name, tc, rated) { $('chal-wait').hidden = false; $('chal-wait-text').innerHTML = `⏳ Waiting for <b>${esc(name)}</b> to accept (${TC_LABEL[tc]}${rated ? ' · rated' : ''})…`; }
function hideWaiting() { $('chal-wait').hidden = true; }
export function wireFriends() {
  $('sheet-chal').addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]'); if (c) { $('sheet-chal').querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === c)); return; }
    const t = e.target.closest('[data-tc]'); if (t) sendChallenge(t.dataset.tc);
  });
  $('chal-cancel').onclick = () => { $('sheet-chal').hidden = true; };
  $('chal-wait-cancel').onclick = async () => { if (waitingFor) { call('f/answer', { body: { s: session(), id: waitingFor } }).catch(() => {}); waitingFor = null; } hideWaiting(); };
  $('challenge-yes').onclick = async () => {
    const id = $('challenge-bar').dataset.id; $('challenge-bar').hidden = true;
    try { const d = await call('f/answer', { body: { s: session(), id, accept: true } }); opts.enterRoom(d.room, d.seat); startPresence(); } catch (e) { opts.toast(e.message); }
  };
  $('challenge-no').onclick = async () => { const id = $('challenge-bar').dataset.id; $('challenge-bar').hidden = true; try { await call('f/answer', { body: { s: session(), id } }); } catch (e) {} startPresence(); };
}

window.__kingsideAccount = { session, user, api: call, get view() { return view; } };
