// Daily streaks + achievements. Kept on this phone for guests; merged into the account (server-side) when signed in.
// A day counts toward the streak when you finish a game, finish a lesson or solve the Daily Puzzle.
// v1.7: days are this phone's own calendar days (India time on an Indian phone, UTC on a UTC one); before v1.7 they were India dates.
const KEY = 'kingside-progress-v1', DEV = 'kingside-device-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// YYYY-MM-DD of the calendar day at time t in time zone tz (default: this device's zone)
export function dayKey(t = now(), tz = opts.tz) {
  const d = new Date(t);
  if (tz) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch (e) { /* unknown zone: device zone */ } }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const istDate = (t) => dayKey(t); // old name, kept for older callers
export const prevDay = (d, n = 1) => new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const now = () => (opts.now ? opts.now() : Date.now());

// id, icon, name, how to get it, test(counters, streak)
export const ACH = [
  { id: 'first_game', icon: '♟️', name: 'First Move', desc: 'Finish your first game', t: (c) => c.games >= 1 },
  { id: 'first_win', icon: '🥇', name: 'First Win', desc: 'Win a game', t: (c) => c.wins >= 1 },
  { id: 'wins_10', icon: '🔟', name: 'On a Roll', desc: 'Win 10 games', t: (c) => c.wins >= 10 },
  { id: 'wins_50', icon: '🎖️', name: 'Veteran', desc: 'Win 50 games', t: (c) => c.wins >= 50 },
  { id: 'beat_4', icon: '🤖', name: 'Club Player', desc: 'Beat the computer at level 4 or higher', t: (c) => c.lvl >= 4 },
  { id: 'beat_6', icon: '⚙️', name: 'Advanced', desc: 'Beat the computer at level 6 or higher', t: (c) => c.lvl >= 6 },
  { id: 'beat_8', icon: '🧠', name: 'Master Slayer', desc: 'Beat the computer at level 8 or higher', t: (c) => c.lvl >= 8 },
  { id: 'beat_10', icon: '👑', name: 'Machine Breaker', desc: 'Beat the computer at level 10', t: (c) => c.lvl >= 10 },
  { id: 'online_win', icon: '🌐', name: 'Online Victory', desc: 'Beat a real person online', t: (c) => c.onlineWins >= 1 },
  { id: 'champion', icon: '🏆', name: 'Champion', desc: 'Win a tournament', t: (c) => c.tWins >= 1 },
  { id: 'daily_1', icon: '📅', name: 'Daily Solver', desc: 'Solve the Daily Puzzle', t: (c) => c.daily >= 1 },
  { id: 'puzzles_50', icon: '🧩', name: 'Puzzle Fan', desc: 'Solve 50 rated puzzles', t: (c) => c.pzWon >= 50 },
  { id: 'rush_10', icon: '⚡', name: 'Rusher', desc: 'Score 10+ in Puzzle Rush', t: (c) => c.rushBest >= 10 },
  { id: 'rush_20', icon: '🚀', name: 'Speed Demon', desc: 'Score 20+ in Puzzle Rush', t: (c) => c.rushBest >= 20 },
  { id: 'rush_30', icon: '🌩️', name: 'Lightning', desc: 'Score 30+ in Puzzle Rush', t: (c) => c.rushBest >= 30 },
  { id: 'streak_3', icon: '🕯️', name: 'Warming Up', desc: 'Keep a 3-day streak', t: (c, s) => s.best >= 3 },
  { id: 'streak_7', icon: '🔥', name: 'On Fire', desc: 'Keep a 7-day streak', t: (c, s) => s.best >= 7 },
  { id: 'streak_30', icon: '☄️', name: 'Unstoppable', desc: 'Keep a 30-day streak', t: (c, s) => s.best >= 30 },
  { id: 'brilliant', icon: '💎', name: 'Brilliant!', desc: 'Play a brilliant move (found in Game Review)', t: (c) => c.brill >= 1 },
];

let opts = { api: null, session: () => null, onChange: () => {}, now: null, tz: undefined };
const blank = () => ({ v: 1, days: [], ach: {}, c: {}, best: 0 });
export function load() { try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); return p && p.v === 1 ? { ...blank(), ...p } : blank(); } catch (e) { return blank(); } }
function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} opts.onChange(p); try { window.dispatchEvent(new CustomEvent('kingside-progress')); } catch (e) {} }
export function deviceTok() {
  let t = null; try { t = JSON.parse(localStorage.getItem(DEV) || 'null'); } catch (e) {}
  if (!/^[a-f0-9]{32}$/.test(t || '')) {
    t = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(DEV, JSON.stringify(t)); } catch (e) {}
  }
  return t;
}

// current streak (ending today, or yesterday if today isn't done yet) and the best ever
export function streak(p = load(), t = now(), tz = opts.tz) {
  const set = new Set(p.days);
  const today = dayKey(t, tz), y = prevDay(today);
  let cur = 0;
  let d = set.has(today) ? today : set.has(y) ? y : null;
  while (d && set.has(d)) { cur++; d = prevDay(d); }
  let best = 0, run = 0, prev = null;
  for (const x of [...set].sort()) { run = prev && Date.parse(x + 'T12:00:00Z') - Date.parse(prev + 'T12:00:00Z') === 864e5 ? run + 1 : 1; best = Math.max(best, run); prev = x; }
  return { cur, best: Math.max(best, p.best || 0, cur), today: set.has(today), day: today, atRisk: !set.has(today) && cur > 0 };
}

export function merge(a, b) {
  const A = a || {}, B = b || {};
  const days = [...new Set([...(A.days || []), ...(B.days || [])])].sort().slice(-400);
  const ach = { ...(A.ach || {}) };
  for (const [k, v] of Object.entries(B.ach || {})) ach[k] = ach[k] ? Math.min(ach[k], v) : v;
  const c = { ...(A.c || {}) };
  for (const [k, v] of Object.entries(B.c || {})) c[k] = Math.max(c[k] || 0, v);
  return { v: 1, days, ach, c, best: Math.max(A.best || 0, B.best || 0) };
}

// something happened: count it, mark today, unlock what's earned
export function record(kind, d = {}) {
  const p = load(); const c = p.c;
  const inc = (k, n = 1) => { c[k] = (c[k] || 0) + n; };
  let day = false;
  if (kind === 'game') {
    if ((d.plies || 0) >= 2) { inc('games'); day = true; }
    if (d.win) { inc('wins'); if (d.mode === 'ai') c.lvl = Math.max(c.lvl || 0, d.level || 0); if (d.mode === 'online') inc('onlineWins'); }
  } else if (kind === 'daily') { if (d.ok) { inc('daily'); day = true; } }
  else if (kind === 'lesson') { inc('lessons'); day = true; }
  else if (kind === 'puzzles') c.pzWon = Math.max(c.pzWon || 0, d.won || 0);
  else if (kind === 'rush') { c.rushBest = Math.max(c.rushBest || 0, d.score || 0); inc('rushRuns'); }
  else if (kind === 'champion') inc('tWins');
  else if (kind === 'brilliant') inc('brill');
  if (day) { const t = dayKey(); if (!p.days.includes(t)) p.days.push(t); p.days = p.days.sort().slice(-400); }
  const s = streak(p); p.best = Math.max(p.best || 0, s.best);
  const fresh = [];
  for (const a of ACH) if (!p.ach[a.id] && a.t(c, s)) { p.ach[a.id] = Date.now(); fresh.push(a); }
  save(p);
  fresh.forEach((a, i) => setTimeout(() => toast(a), 900 + i * 2600));
  if (day || fresh.length || kind === 'rush') scheduleSync();
  return { fresh, streak: s };
}

/* ---------------- unlock toast ---------------- */
let toastTimer = null;
function toast(a) {
  let el = $('ach-toast');
  if (!el) { el = document.createElement('div'); el.id = 'ach-toast'; el.className = 'ach-toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.innerHTML = `<span class="at-ic">${a.icon}</span><span class="at-t"><small>Achievement unlocked</small><b>${esc(a.name)}</b></span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  try { navigator.vibrate && navigator.vibrate([20, 40, 20]); } catch (e) {}
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------------- account sync ---------------- */
let syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); }
export async function sync() {
  const s = opts.session(); if (!s || !opts.api) return;
  try {
    const d = await opts.api('u/progress', { body: { s, prog: load() } });
    if (opts.session() !== s) return;
    const before = Object.keys(load().ach).length;
    const m = merge(load(), d.prog);
    save(m);
    if (Object.keys(m.ach).length !== before) opts.onChange(m);
  } catch (e) { /* offline: try again next time */ }
}
// set a counter (used by Learn: ln_<lesson> = 1 when a lesson is finished) and sync it to the account
export function setCounter(k, v) {
  const p = load(); if ((p.c[k] || 0) >= v) return;
  p.c[k] = v; save(p); scheduleSync();
}
// a different account signs in on this phone: start from that account's record, not the last one's
export function reset() { save(blank()); }
// true the first time a key is seen on this phone (so a reloaded finished game is not counted twice)
export function once(key) {
  let s = []; try { s = JSON.parse(localStorage.getItem(KEY + '-seen') || '[]'); } catch (e) {}
  if (s.includes(key)) return false;
  s.push(key); try { localStorage.setItem(KEY + '-seen', JSON.stringify(s.slice(-300))); } catch (e) {}
  return true;
}
export function setup(o) { opts = { ...opts, ...o }; }
// v1.8: days covered by a Streak Freeze (decided by the server) count for the streak; kept apart too, to show ❄️
export function addFrozen(days) {
  const list = (days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)));
  if (!list.length) return;
  let frz = []; try { frz = JSON.parse(localStorage.getItem(KEY + '-frozen') || '[]'); } catch (e) {}
  try { localStorage.setItem(KEY + '-frozen', JSON.stringify([...new Set([...frz, ...list])].sort().slice(-60))); } catch (e) {}
  const p = load(); const add = list.filter((d) => !p.days.includes(d));
  if (!add.length) return;
  p.days = [...p.days, ...add].sort().slice(-400); save(p); scheduleSync();
}
export function frozen() { try { return new Set(JSON.parse(localStorage.getItem(KEY + '-frozen') || '[]')); } catch (e) { return new Set(); } }

/* ---------------- views ---------------- */
export function badgesHtml(p = load(), { all = true, limit = 0 } = {}) {
  const list = all ? ACH : ACH.filter((a) => p.ach[a.id]);
  const items = (limit ? list.slice(0, limit) : list).map((a) => {
    const got = p.ach[a.id];
    return `<li class="ach ${got ? 'got' : 'locked'}" title="${esc(a.desc)}"><span class="ach-ic">${got ? a.icon : '🔒'}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></li>`;
  }).join('');
  return `<ul class="ach-grid">${items}</ul>`;
}
export function count(p = load()) { return ACH.filter((a) => p.ach[a.id]).length; }
if (typeof window !== 'undefined') window.__kingsideProgress = { load, streak, record, ACH, sync, dayKey };
