// Kingside Chess tournaments: create, join, live lobby, pairings, standings, bracket, champion screen, leaderboard.
// No accounts: each device has a random player id in localStorage, and the organizer's device keeps an admin key.
import * as Progress from './progress.js';
import * as Net from './online.js';

const API = '/api/t/';
const DEV = 'kingside-device-v1';
const ADM = 'kingside-tadmin-v1';
const LIST = 'kingside-tlist-v1';
const PREFS = 'kingside-chess-prefs-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TC_LABEL = { none: 'Unlimited', '3+2': '3 + 2', '5+0': '5 + 0', '10+0': '10 + 0', '15+10': '15 + 10' };
const RULE_KO = 'Knockout draws: a drawn game goes to an <b>Armageddon</b> decider with colours swapped. In Armageddon a draw counts as a win for <b>Black</b>.';
const RULE_RR = 'Everyone plays everyone once. Win = 1 point, draw = ½. Ties are split by <b>Sonneborn-Berger</b> (the points of the players you beat, plus half of those you drew).';

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
export function deviceTok() {
  let t = ls.get(DEV, null);
  if (!/^[a-f0-9]{32}$/.test(t || '')) {
    t = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
    ls.set(DEV, t);
  }
  return t;
}
const admFor = (code) => (ls.get(ADM, {})[code] || '');
function saveAdm(code, adm) { const m = ls.get(ADM, {}); m[code] = adm; ls.set(ADM, m); }
function remember(code, name) {
  const l = ls.get(LIST, []).filter((x) => x.code !== code);
  l.unshift({ code, name, at: Date.now() });
  ls.set(LIST, l.slice(0, 12));
}
const myName = () => (ls.get(PREFS, {}).name || '');
function saveName(n) { const p = ls.get(PREFS, {}); if (p.name !== n) { p.name = n; ls.set(PREFS, p); } }

async function call(path, opts = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(API + path, { ...opts, signal: ctl.signal, cache: 'no-store', headers: opts.body ? { 'content-type': 'application/json' } : undefined });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok || !data || data.ok === false) {
      const e = new Error((data && data.error) || `Server answered ${res.status}`);
      e.code = (data && data.code) || 'http_' + res.status; e.http = true; throw e;
    }
    return data;
  } finally { clearTimeout(timer); }
}
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b) });
const tLink = (code) => `${location.origin}/?t=${code}`;

/* ---------------- state ---------------- */
let view = 'home';      // home | create | t | leaders
let T = null;           // current tournament state from the server
let code = null;
let run = 0, abort = null, conn = 'ok';
let draft = { format: 'rr', tc: '5+0', playing: true };
let confettiShown = '';
let lastMyRoom = null;
let opts = { onClose: () => {}, toast: (m) => alert(m) };
const toast = (m) => opts.toast(m);

export function setup(o) { opts = { ...opts, ...o }; wire(); }
export function isOpen() { return !$('tscreen').hidden; }

export function open(c) {
  document.body.classList.add('t-open');
  $('tscreen').hidden = false;
  if (c) { code = Net.cleanCode(c); T = null; lastMyRoom = null; go('t'); startPoll(); }
  else go('home');
}
export function close() {
  stopPoll(); code = null; T = null;
  $('tscreen').hidden = true;
  document.body.classList.remove('t-open');
  stopConfetti();
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  opts.onClose();
}
// Android back button: step back inside the tournament screen; false when it is closed
export function back() {
  if (!isOpen()) return false;
  const sheet = $('t-sheet'); if (!sheet.hidden) { sheet.hidden = true; return true; }
  if (view === 'create' || view === 'leaders' || view === 't') { stopPoll(); code = null; T = null; go('home'); return true; }
  close(); return true;
}

function go(v) {
  view = v;
  secCache = {};
  $('t-body').innerHTML = '';
  $('t-body').scrollTop = 0; $('tscreen').scrollTop = 0;
  if (v !== 't') { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  else { try { history.replaceState(null, '', '?t=' + code); } catch (e) {} }
  if (v === 'leaders') loadLeaders();
  render();
}

/* ---------------- polling ---------------- */
function startPoll() {
  const my = ++run;
  let errors = 0;
  (async () => {
    while (run === my && code) {
      const ctl = new AbortController(); abort = ctl;
      try {
        const q = new URLSearchParams({ code, tok: deviceTok(), adm: admFor(code), ver: String(T ? T.ver : 0) });
        const st = await call('poll?' + q, { signal: ctl.signal }, 20000);
        if (run !== my) return;
        errors = 0; conn = 'ok';
        apply(st);
      } catch (e) {
        if (run !== my) return;
        if (e.code === 'no_tourney') { T = null; conn = 'gone'; render(); return; }
        errors++; conn = 'retrying'; render();
        await new Promise((r) => setTimeout(r, Math.min(6000, 700 * errors)));
      }
    }
  })();
}
function stopPoll() { run++; if (abort) try { abort.abort(); } catch (e) {} }
function kick() { if (code && view === 't') { stopPoll(); startPoll(); } }

function apply(st) {
  if (!st || st.code !== code) return;
  const prev = T;
  T = st;
  if (st.me || st.admin) remember(st.code, st.name);
  const mg = st.myGame;
  const room = mg && mg.room && !mg.res ? mg.room : null;
  if (room && room !== lastMyRoom && prev) {
    try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {}
    toast(`Your game vs ${mg.opp} is ready`);
  }
  lastMyRoom = room;
  render();
  if (prev && prev.status !== st.status) { $('tscreen').scrollTop = 0; }
  if (st.status === 'done' && st.champion && confettiShown !== st.code) { confettiShown = st.code; confetti(); }
  if (st.status === 'done' && st.champion && st.me && st.me === st.champion && Progress.once('tourney-win:' + st.code)) Progress.record('champion');
}

/* ---------------- rendering ---------------- */
let secCache = {};
function render() {
  $('t-title').textContent = view === 'leaders' ? 'Leaderboard' : view === 'create' ? 'New tournament' : view === 't' && T ? T.name : 'Tournaments';
  const secs = view === 'home' ? homeSecs() : view === 'create' ? createSecs() : view === 'leaders' ? leaderSecs() : tSecs();
  const body = $('t-body');
  // update only the sections whose markup changed, so typing in an input survives live updates
  const keys = secs.map((s) => s[0]);
  [...body.children].forEach((el) => { if (!keys.includes(el.dataset.k)) { el.remove(); delete secCache[el.dataset.k]; } });
  let prevEl = null;
  for (const [k, html] of secs) {
    let el = body.querySelector(`:scope > [data-k="${k}"]`);
    if (!el) { el = document.createElement('section'); el.dataset.k = k; el.className = 't-sec ts-' + k; }
    if (secCache[k] !== html) { el.innerHTML = html; secCache[k] = html; }
    if (prevEl ? prevEl.nextSibling !== el : body.firstChild !== el) body.insertBefore(el, prevEl ? prevEl.nextSibling : body.firstChild);
    prevEl = el;
  }
}

function homeSecs() {
  const list = ls.get(LIST, []);
  return [
    ['hero', `<div class="t-hero"><div class="t-trophy" aria-hidden="true">🏆</div><h2>Play a tournament with friends</h2>
      <p>Round-robin for 3–8 players or a knockout bracket for up to 16. Share one link on WhatsApp; pairings, results and standings run themselves.</p>
      <button class="btn btn-gold t-big" data-act="new">Create tournament</button></div>`],
    ['joinc', `<form class="t-card t-joincode" data-form="code"><label class="label" for="t-code-in">Got a tournament code?</label>
      <div class="join-row"><input class="text-in code-in" id="t-code-in" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC123" aria-label="Tournament code"><button class="btn btn-ghost" type="submit">Open</button></div></form>`],
    ['mine', list.length ? `<div class="t-card"><span class="label">Your tournaments</span><ul class="t-list">${list.map((x) => `<li><button data-act="openT" data-code="${esc(x.code)}"><b>${esc(x.name)}</b><small>${esc(x.code)}</small><i>›</i></button></li>`).join('')}</ul></div>` : ''],
    ['lbb', `<button class="btn btn-online t-lb-btn" data-act="leaders"><span aria-hidden="true">📈</span> All-time leaderboard</button>`],
  ];
}

function seg(name, value, items) {
  return `<div class="seg ${items.length > 3 ? 'seg-wrap' : ''}" data-tseg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;
}
function createSecs() {
  return [['form', `<form class="t-card t-create" data-form="create">
    <label class="label" for="t-name">Tournament name</label>
    <input class="text-in" id="t-name" maxlength="40" placeholder="e.g. Sunday Blitz" autocomplete="off">
    <div class="field"><span class="label">Format</span>${seg('format', draft.format, [['rr', 'Round-robin<small>3–8 players</small>'], ['ko', 'Knockout<small>up to 16</small>']])}</div>
    <p class="t-rule" id="t-rule">${draft.format === 'ko' ? RULE_KO + ' Byes are given automatically when the number of players isn’t 2, 4, 8 or 16.' : RULE_RR}</p>
    <div class="field"><span class="label">Clock (each game)</span>${seg('tc', draft.tc, [['3+2', '3 + 2'], ['5+0', '5 + 0'], ['10+0', '10 + 0'], ['15+10', '15 + 10'], ['none', 'Unlimited']])}</div>
    <label class="toggle"><input type="checkbox" id="t-playing" ${draft.playing ? 'checked' : ''}><span>I’m playing too</span></label>
    <div id="t-myname-wrap" ${draft.playing ? '' : 'hidden'}><label class="label" for="t-myname">Your name</label>
    <input class="text-in" id="t-myname" maxlength="20" autocomplete="nickname" placeholder="e.g. Sonujeet" value="${esc(myName())}"></div>
    <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-act="home">Cancel</button><button type="submit" class="btn btn-gold">Create tournament</button></div>
  </form>`]];
}

function nameOf(id) { if (!T || !id) return ''; const p = T.players.find((x) => x.id === id); return p ? p.name : '?'; }
function pTag(id, bold) {
  const p = T.players.find((x) => x.id === id);
  if (!p) return '<span class="t-bye">bye</span>';
  return `<span class="t-pn${bold ? ' win' : ''}${p.kicked ? ' kicked' : ''}">${esc(p.name)}${id === T.me ? ' <small>(you)</small>' : ''}</span>`;
}
const resText = (g) => (!g.res ? '' : g.res === 'w' ? '1–0' : g.res === 'b' ? '0–1' : '½–½');
function reasonWord(r) {
  const base = String(r || '').replace('+arma', '');
  return ({ checkmate: 'checkmate', resign: 'resigned', timeout: 'on time', stalemate: 'stalemate', threefold: 'repetition', fifty: '50-move rule', material: 'insufficient material', agreement: 'agreed draw', forfeit: 'forfeit', admin: 'set by organizer', ended: 'ended' })[base] || base;
}

function tSecs() {
  if (!T) {
    if (conn === 'gone') return [['msg', `<div class="t-card t-empty"><h3>Tournament not found</h3><p>Check the link or the code.</p><button class="btn btn-gold" data-act="home">Back</button></div>`]];
    return [['msg', `<div class="t-card t-empty"><span class="spin"></span> Loading tournament…</div>`]];
  }
  const s = T, out = [];
  const fmt = s.format === 'ko' ? 'Knockout' : 'Round-robin';
  const active = s.players.filter((p) => !p.kicked).length;
  const statusChip = s.status === 'lobby' ? '<i class="chip chip-lobby">Lobby · open to join</i>' : s.status === 'running' ? `<i class="chip chip-live">● Live · ${s.format === 'ko' ? esc(s.roundNames[s.round]) : `Round ${s.round + 1} of ${s.totalRounds}`}</i>` : `<i class="chip chip-done">Finished</i>`;
  out.push(['head', `<div class="t-headcard"><div class="t-meta">${fmt} · ${esc(TC_LABEL[s.tc] || s.tc)} · ${active} player${active === 1 ? '' : 's'}</div>${statusChip}
    ${conn === 'retrying' ? '<div class="t-conn">Connection lost, reconnecting…</div>' : ''}</div>`]);

  if (s.status === 'done') out.push(['champ', champSec()]);
  if (s.status === 'lobby') {
    out.push(['invite', inviteSec('Invite friends')]);
    out.push(['joinbox', joinSec()]);
    out.push(['players', lobbyPlayers()]);
    out.push(['rule', `<p class="t-rule">${s.format === 'ko' ? RULE_KO : RULE_RR}</p>`]);
    if (s.admin) out.push(['adminL', adminLobby()]);
  }
  if (s.status === 'running') {
    if (s.me || s.kicked) out.push(['mygame', myGameSec()]);
    out.push(['round', roundSec()]);
    if (s.format === 'ko') out.push(['bracket', bracketSec()]);
    out.push(['table', tableSec()]);
    if (s.format === 'rr') out.push(['history', historySec()]);
    out.push(['rule', `<p class="t-rule">${s.format === 'ko' ? RULE_KO : RULE_RR}</p>`]);
    if (s.admin) out.push(['adminR', adminRunning()]);
  }
  if (s.status === 'done') {
    if (s.format === 'ko' && s.rounds.length) out.push(['bracket', bracketSec()]);
    out.push(['table', tableSec(true)]);
    if (s.format === 'rr') out.push(['history', historySec()]);
    out.push(['again', `<div class="t-card t-again"><button class="btn btn-ghost" data-act="new">New tournament</button><button class="btn btn-ghost" data-act="leaders">Leaderboard</button></div>`]);
  }
  return out;
}

function inviteSec(title) {
  const link = tLink(T.code);
  return `<div class="t-card t-invite"><span class="label">${title}</span>
    <div class="t-codebox"><div class="t-code">${esc(T.code)}</div><div class="invite-link">${esc(link.replace(/^https?:\/\//, ''))}</div></div>
    <a class="btn btn-wa" data-act="wa" href="${waHref(inviteText())}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>Share on WhatsApp</a>
    <div class="invite-row"><button class="btn btn-ghost" data-act="copy">Copy link</button>${navigator.share ? '<button class="btn btn-ghost" data-act="share">More…</button>' : ''}</div></div>`;
}
const waHref = (text) => 'https://wa.me/?text=' + encodeURIComponent(text);
function inviteText() {
  return `♟️ Join my chess tournament "${T.name}" on Kingside Chess (${T.format === 'ko' ? 'knockout' : 'round-robin'}, ${TC_LABEL[T.tc] || T.tc}). Tap to join: ${tLink(T.code)}`;
}

function joinSec() {
  const s = T;
  if (s.me) return `<div class="t-card t-in"><div class="t-ok">✓ You’re in as <b>${esc(nameOf(s.me))}</b></div><p>Waiting for the organizer to start. Keep this page open, it updates by itself.</p><button class="btn btn-ghost btn-sm" data-act="quit">Leave tournament</button></div>`;
  const full = s.players.length >= s.limits[1];
  if (full) return `<div class="t-card"><b>This tournament is full.</b></div>`;
  return `<form class="t-card t-join" data-form="join"><label class="label" for="t-join-name">Your name</label>
    <div class="join-row"><input class="text-in" id="t-join-name" maxlength="20" autocomplete="nickname" placeholder="Type your name" value="${esc(myName())}"><button class="btn btn-gold" type="submit">Join</button></div></form>`;
}
function lobbyPlayers() {
  const s = T;
  const [lo, hi] = s.limits;
  return `<div class="t-card"><span class="label">Players · ${s.players.length}/${hi}</span>
    ${s.players.length ? `<ol class="t-players">${s.players.map((p) => `<li><i class="pres ${p.online ? 'on' : 'off'}"></i><span>${esc(p.name)}${p.id === s.me ? ' <small>(you)</small>' : ''}</span>${s.admin ? `<button class="t-x" data-act="kick" data-pid="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</li>`).join('')}</ol>` : '<p class="t-muted">Nobody yet. Share the link!</p>'}
    ${s.players.length < lo ? `<p class="t-muted">Needs at least ${lo} players to start.</p>` : ''}</div>`;
}
function adminLobby() {
  const s = T, ok = s.players.length >= s.limits[0];
  return `<div class="t-card t-admin"><span class="label">Organizer</span>
    <button class="btn btn-gold t-big" data-act="start" ${ok ? '' : 'disabled'}>Start tournament</button>
    <p class="t-muted">${ok ? `Pairings are made the moment you start. ${s.format === 'ko' ? 'Bracket positions are drawn at random.' : ''}` : `Waiting for ${s.limits[0] - s.players.length} more player${s.limits[0] - s.players.length === 1 ? '' : 's'}.`}</p>
    <button class="btn btn-ghost btn-sm" data-act="end">Cancel tournament</button></div>`;
}

function myGameSec() {
  const s = T, g = s.myGame;
  const rn = s.format === 'ko' ? s.roundNames[s.round] : `Round ${s.round + 1}`;
  if (s.kicked) return `<div class="t-card t-my"><b>The organizer removed you from this tournament.</b></div>`;
  if (!g) return '';
  if (g.out) return `<div class="t-card t-my"><b>You’re out of the tournament.</b><p class="t-muted">Follow the rest of the bracket below.</p></div>`;
  if (g.bye) return `<div class="t-card t-my"><b>${rn}: you have a bye.</b><p class="t-muted">Sit back, your next game appears here when the round ends.</p></div>`;
  if (!g.res && g.room) {
    return `<div class="t-card t-my t-ready"><div class="t-myrow"><div><div class="t-mylabel">${esc(rn)}${g.arma ? ' · Armageddon' : ''}</div>
      <div class="t-myvs">Your game vs <b>${esc(g.opp)}</b></div><div class="t-muted">You play ${g.color === 'w' ? 'White' : 'Black'}${g.arma ? ' · a draw counts as a win for Black' : ''}</div></div>
      <img src="pieces/${g.color}K.svg" alt="" width="44" height="44"></div>
      <button class="btn btn-gold t-big" data-act="play" data-room="${esc(g.room)}">Play now ▶</button></div>`;
  }
  const word = g.res === 'd' ? (g.arma ? (g.color === 'b' ? 'You drew the Armageddon, so you go through' : 'Drawn Armageddon, so Black goes through') : 'Your game was drawn') : g.res === g.color ? 'You won your game 🎉' : 'You lost your game';
  return `<div class="t-card t-my"><b>${word}</b><p class="t-muted">${!g.done ? 'An Armageddon decider is being set up…' : 'Waiting for the other games in this round to finish. Your next game shows up here.'}</p></div>`;
}

function gameRow(ri, mi, m) {
  const s = T;
  if (m.bye) return `<li class="t-game"><div class="t-gp">${pTag(m.a || m.b)} <span class="t-muted">has a bye</span></div></li>`;
  const g = m.games[m.games.length - 1];
  if (!g) return '';
  const first = m.games.length > 1 ? m.games[0] : null;
  let state;
  if (g.res) state = `<b class="t-res">${resText(g)}</b> <small>${esc(reasonWord(g.reason))}</small>`;
  else if (g.live && g.live.started) state = `<span class="t-livedot">●</span> move ${Math.ceil(g.live.ply / 2) || 1}, ${g.live.turn === 'w' ? 'White' : 'Black'} to play`;
  else state = '<span class="t-muted">waiting for the first move</span>';
  const adminBtn = s.admin && s.status === 'running' && ri === s.round && !m.done && !g.res ? `<button class="btn btn-ghost btn-sm" data-act="setres" data-m="${mi}">Set result</button>` : '';
  return `<li class="t-game${m.done ? ' done' : ''}"><div class="t-gp"><span class="t-side">♔</span>${pTag(g.w, g.res === 'w' || (m.done && m.winner === g.w && s.format === 'ko'))}<span class="t-vs">vs</span><span class="t-side">♚</span>${pTag(g.b, g.res === 'b' || (m.done && m.winner === g.b && s.format === 'ko'))}</div>
    <div class="t-gs">${g.arma ? '<i class="chip chip-arma">Armageddon</i> ' : ''}${state}${first ? ` <small class="t-muted">(game 1 ${resText(first)})</small>` : ''}${adminBtn}</div></li>`;
}
function roundSec() {
  const s = T, ms = s.rounds[s.round] || [];
  const title = s.format === 'ko' ? s.roundNames[s.round] : `Round ${s.round + 1} of ${s.totalRounds}`;
  const left = ms.filter((m) => !m.done).length;
  return `<div class="t-card"><span class="label">${esc(title)} · ${left ? `${left} game${left === 1 ? '' : 's'} in progress` : 'complete'}</span><ul class="t-games">${ms.map((m, mi) => gameRow(s.round, mi, m)).join('')}</ul></div>`;
}
function historySec() {
  const s = T;
  const done = s.rounds.map((ms, ri) => [ri, ms]).filter(([ri]) => s.status === 'done' || ri < s.round);
  if (!done.length) return '';
  return `<div class="t-card"><span class="label">Results by round</span>${done.map(([ri, ms]) => `<div class="t-hround"><div class="t-hr">Round ${ri + 1}</div><ul class="t-games">${ms.map((m, mi) => gameRow(ri, mi, m)).join('')}</ul></div>`).join('')}</div>`;
}
const half = (x) => { const w = Math.floor(x), h = x - w >= 0.5; return w === 0 && h ? '½' : w + (h ? '½' : ''); };
function tableSec(final) {
  const s = T, ko = s.format === 'ko';
  const anyPlayed = s.standings.some((x) => x.played > 0);
  const rows = s.standings.map((x) => `<tr class="${x.id === s.me ? 'me' : ''}${x.kicked ? ' kicked' : ''}${x.id === s.champion ? ' champ' : ''}">
    <td class="t-pl">${x.id === s.champion ? '🏆' : anyPlayed ? esc(x.place) : '–'}</td><td class="t-nm">${esc(x.name)}${x.id === s.me ? ' <small>(you)</small>' : ''}${x.kicked ? ' <small>withdrawn</small>' : ''}</td>
    ${ko ? '' : `<td class="t-pts">${half(x.pts)}</td>`}<td>${x.w}</td><td>${x.d}</td><td>${x.l}</td>${ko ? '' : `<td class="t-sb">${half(x.sb)}</td>`}</tr>`).join('');
  return `<div class="t-card"><span class="label">${final ? 'Final standings' : 'Standings'}</span>
    <div class="t-tablewrap"><table class="t-table"><thead><tr><th>#</th><th class="t-nm">Player</th>${ko ? '' : '<th title="Points">Pts</th>'}<th title="Wins">W</th><th title="Draws">D</th><th title="Losses">L</th>${ko ? '' : '<th title="Sonneborn-Berger tiebreak">SB</th>'}</tr></thead><tbody>${rows}</tbody></table></div>
    ${ko ? '' : '<p class="t-muted t-small">Pts: win 1, draw ½ · SB: Sonneborn-Berger tiebreak</p>'}</div>`;
}
function bracketSec() {
  const s = T;
  // show every round, future rounds as empty boxes
  let size = 1; while (size < s.players.length) size *= 2;
  const R = s.totalRounds, cols = [];
  for (let ri = 0; ri < R; ri++) {
    const ms = s.rounds[ri] || Array.from({ length: Math.max(1, size >> (ri + 1)) }, () => null);
    const name = ri === R - 1 ? 'Final' : ri === R - 2 ? 'Semi-finals' : ri === R - 3 ? 'Quarter-finals' : `Round ${ri + 1}`;
    cols.push(`<div class="t-bcol"><div class="t-bname">${name}</div><div class="t-bms">${ms.map((m) => {
      if (!m) return '<div class="t-bm empty"><div class="t-bp">—</div><div class="t-bp">—</div></div>';
      const sc = (id) => { if (!m.games.length || !id) return ''; return m.games.map((g) => !g.res ? '' : g.res === 'd' ? '½' : g[g.res] === id ? '1' : '0').join(' '); };
      const line = (id) => `<div class="t-bp${m.winner && m.winner === id ? ' win' : ''}${m.done && m.winner && m.winner !== id ? ' lose' : ''}">${id ? esc(nameOf(id)) : '<span class="t-bye">bye</span>'}<b>${sc(id)}</b></div>`;
      const live = !m.done && m.games.length && ri === s.round ? ' live' : '';
      return `<div class="t-bm${live}">${line(m.a)}${line(m.b)}${m.games.some((g) => g.arma) ? '<i class="t-arma">Armageddon</i>' : ''}</div>`;
    }).join('')}</div></div>`);
  }
  if (s.status === 'done' && s.champion) cols.push(`<div class="t-bcol t-bchamp"><div class="t-bname">Champion</div><div class="t-bms"><div class="t-bm win">🏆 ${esc(nameOf(s.champion))}</div></div></div>`);
  return `<div class="t-card"><span class="label">Bracket</span><div class="t-bracket">${cols.join('')}</div></div>`;
}
function adminRunning() {
  const s = T;
  return `<div class="t-card t-admin"><span class="label">Organizer tools</span>
    <p class="t-muted">If a game breaks, use <b>Set result</b> on it above. Removing a player gives their open game to the opponent.</p>
    <ul class="t-players t-kick">${s.players.filter((p) => !p.kicked).map((p) => `<li><span>${esc(p.name)}</span><button class="btn btn-ghost btn-sm" data-act="kick" data-pid="${p.id}">Remove</button></li>`).join('')}</ul>
    <button class="btn btn-danger btn-sm" data-act="end">End tournament now</button></div>`;
}
function champSec() {
  const s = T;
  const share = `<div class="invite-row"><a class="btn btn-wa" href="${waHref(resultsText())}" target="_blank" rel="noopener">Share results on WhatsApp</a></div>
    <div class="invite-row"><button class="btn btn-ghost" data-act="copy">Copy results link</button>${navigator.share ? '<button class="btn btn-ghost" data-act="shareres">More…</button>' : ''}</div>`;
  if (!s.champion) return `<div class="t-card t-champ"><h2>Tournament ${s.endedEarly ? 'ended' : 'over'}</h2><p class="t-muted">${s.endedEarly ? 'The organizer ended it early.' : ''}</p>${s.players.length ? share : ''}</div>`;
  const ch = s.standings.find((x) => x.id === s.champion);
  const sub = s.format === 'rr' ? `${half(ch.pts)} / ${ch.played} points · ${ch.w}W ${ch.d}D ${ch.l}L` : `Won the knockout · ${ch.w}W ${ch.d}D ${ch.l}L`;
  return `<div class="t-card t-champ"><div class="t-cup" aria-hidden="true">🏆</div><div class="t-cl">Champion</div><h2>${esc(ch.name)}</h2><p>${sub}</p>
    ${s.me === s.champion ? '<p class="t-you">That’s you! 🎉</p>' : ''}${s.endedEarly ? '<p class="t-muted t-small">Ended early by the organizer; leader at that point.</p>' : ''}${share}</div>`;
}
function resultsText() {
  const s = T;
  const lines = s.standings.slice(0, 16).map((x) => `${x.id === s.champion ? '🏆' : x.place + '.'} ${x.name}${s.format === 'rr' ? ' ' + half(x.pts) : ''}`);
  return `🏆 ${s.name}: final standings\n${lines.join('\n')}\n\nFull results: ${tLink(s.code)}`;
}

let leaders = null;
async function loadLeaders() {
  leaders = null; render();
  try { const r = await call('leaders?tok=' + deviceTok()); leaders = r.leaders; }
  catch (e) { leaders = e.http ? [] : 'offline'; }
  if (view === 'leaders') render();
}
function leaderSecs() {
  let body;
  if (leaders === null) body = '<p><span class="spin"></span> Loading…</p>';
  else if (leaders === 'offline') body = '<p>No connection. The leaderboard needs internet.</p>';
  else if (!leaders.length) body = '<p class="t-muted">No rated games yet. Play a tournament and your rating shows up here.</p>';
  else body = `<div class="t-tablewrap"><table class="t-table t-lb"><thead><tr><th>#</th><th class="t-nm">Player</th><th>Rating</th><th>Games</th><th>W-D-L</th></tr></thead><tbody>${leaders.map((x) => `<tr class="${x.you ? 'me' : ''}"><td>${x.rank}</td><td class="t-nm">${esc(x.name)}${x.you ? ' <small>(you)</small>' : ''}</td><td class="t-pts">${x.rating}</td><td>${x.games}</td><td>${x.w}-${x.d}-${x.l}</td></tr>`).join('')}</tbody></table></div>`;
  return [['lb', `<div class="t-card"><span class="label">All-time ratings</span>${body}<p class="t-muted t-small">Every tournament game counts. Ratings start at 1200 and move with each result (Elo, K = 32). Your rating belongs to this phone and browser.</p></div>`],
    ['lbback', `<div class="t-center"><button class="btn btn-ghost" data-act="home">Back</button></div>`]];
}

/* ---------------- actions ---------------- */
async function act(el) {
  const a = el.dataset.act;
  if (a === 'new') { code = null; T = null; stopPoll(); go('create'); return; }
  if (a === 'home') { stopPoll(); code = null; T = null; go('home'); return; }
  if (a === 'leaders') { stopPoll(); go('leaders'); return; }
  if (a === 'openT') { open(el.dataset.code); return; }
  if (a === 'copy') {
    const link = tLink(T.code);
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { prompt('Copy this link', link); }
    return;
  }
  if (a === 'share') { try { await navigator.share({ title: T.name, text: inviteText().replace(/ Tap to join: .*/, ''), url: tLink(T.code) }); } catch (e) {} return; }
  if (a === 'shareres') { try { await navigator.share({ title: T.name, text: resultsText() }); } catch (e) {} return; }
  if (a === 'play') { Net.rememberSeat(el.dataset.room, deviceTok()); location.href = '/?room=' + el.dataset.room; return; }
  if (a === 'quit') { await doCall(() => post('quit', { code, tok: deviceTok() })); return; }
  if (a === 'start') { el.disabled = true; await doCall(() => post('admin', { code, adm: admFor(code), tok: deviceTok(), action: 'start' })); return; }
  if (a === 'kick') {
    const n = nameOf(el.dataset.pid);
    confirmSheet(`Remove ${n}?`, T.status === 'lobby' ? 'They can join again with the link.' : 'Their open game is given to the opponent, and later games count as forfeits.', 'Remove',
      () => doCall(() => post('admin', { code, adm: admFor(code), tok: deviceTok(), action: 'kick', pid: el.dataset.pid })));
    return;
  }
  if (a === 'end') {
    confirmSheet(T.status === 'lobby' ? 'Cancel this tournament?' : 'End the tournament now?', T.status === 'lobby' ? 'Nobody will be able to join.' : 'Games still going are stopped. The current leader is shown as the result.', T.status === 'lobby' ? 'Cancel it' : 'End it',
      () => doCall(() => post('admin', { code, adm: admFor(code), tok: deviceTok(), action: 'end' })));
    return;
  }
  if (a === 'setres') {
    const m = T.rounds[T.round][+el.dataset.m], g = m.games[m.games.length - 1];
    const W = nameOf(g.w), B = nameOf(g.b);
    sheet(`<h2>Set result</h2><p class="t-muted">${esc(W)} (White) vs ${esc(B)} (Black)${g.arma ? '<br>Armageddon: a draw sends Black through.' : T.format === 'ko' ? '<br>A draw starts an Armageddon decider.' : ''}</p>
      <div class="t-resbtns"><button class="btn btn-ghost" data-res="w">${esc(W)} won</button><button class="btn btn-ghost" data-res="d">Draw</button><button class="btn btn-ghost" data-res="b">${esc(B)} won</button></div>
      <div class="sheet-actions"><button class="btn btn-ghost" data-close>Cancel</button></div>`, (b) => {
      if (b.dataset.res) { closeTSheet(); doCall(() => post('admin', { code, adm: admFor(code), tok: deviceTok(), action: 'result', r: T.round, m: +el.dataset.m, res: b.dataset.res })); }
    });
  }
}
async function doCall(fn) {
  try { const st = await fn(); apply(st); kick(); }
  catch (e) { toast(e.http ? e.message : 'No connection. Tournaments need internet.'); render(); }
}

function sheet(html, onClick) {
  const sh = $('t-sheet');
  sh.querySelector('.sheet').innerHTML = html;
  sh.hidden = false;
  sh.onclick = (e) => {
    if (e.target === sh || e.target.closest('[data-close]')) { closeTSheet(); return; }
    const b = e.target.closest('button'); if (b) onClick(b);
  };
}
function closeTSheet() { $('t-sheet').hidden = true; }
function confirmSheet(title, text, yes, onYes) {
  sheet(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="sheet-actions"><button class="btn btn-ghost" data-close>Keep</button><button class="btn btn-danger" data-yes>${esc(yes)}</button></div>`,
    (b) => { if (b.hasAttribute('data-yes')) { closeTSheet(); onYes(); } });
}

async function submit(form) {
  const f = form.dataset.form;
  if (f === 'code') {
    const c = Net.cleanCode($('t-code-in').value);
    if (c.length < 4) { toast('Type the 6-letter tournament code'); return; }
    open(c); return;
  }
  if (f === 'join') {
    const n = $('t-join-name').value.trim().slice(0, 20);
    if (!n) { toast('Type your name first'); $('t-join-name').focus(); return; }
    saveName(n);
    await doCall(() => post('join', { code, tok: deviceTok(), name: n }));
    return;
  }
  if (f === 'create') {
    const name = $('t-name').value.trim() || 'Chess Tournament';
    const playing = $('t-playing').checked;
    const me = playing ? $('t-myname').value.trim().slice(0, 20) : '';
    if (playing && !me) { toast('Type your name, or untick “I’m playing too”'); $('t-myname').focus(); return; }
    if (me) saveName(me);
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const st = await post('create', { name, format: draft.format, tc: draft.tc });
      saveAdm(st.code, st.adm); remember(st.code, st.name);
      code = st.code; T = null;
      if (playing) { try { await post('join', { code, tok: deviceTok(), name: me }); } catch (e) { toast(e.message); } }
      lastMyRoom = null; go('t'); startPoll();
    } catch (e) { toast(e.http ? e.message : 'No connection. Tournaments need internet.'); btn.disabled = false; }
  }
}

function wire() {
  const scr = $('tscreen');
  scr.addEventListener('click', (e) => {
    const sg = e.target.closest('[data-tseg] button');
    if (sg) {
      const name = sg.parentElement.dataset.tseg; draft[name] = sg.dataset.v;
      sg.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === sg)));
      if (name === 'format') $('t-rule').innerHTML = draft.format === 'ko' ? RULE_KO + ' Byes are given automatically when the number of players isn’t 2, 4, 8 or 16.' : RULE_RR;
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A' && el.dataset.act === 'wa') return; // let the WhatsApp link open
    e.preventDefault(); act(el);
  });
  scr.addEventListener('change', (e) => { if (e.target.id === 't-playing') { draft.playing = e.target.checked; $('t-myname-wrap').hidden = !draft.playing; } });
  scr.addEventListener('submit', (e) => { e.preventDefault(); submit(e.target); });
  $('t-back').onclick = () => { if (view === 'home') close(); else back(); };
  $('t-lbtop').onclick = () => { stopPoll(); go('leaders'); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  window.addEventListener('online', kick);
  window.__kingsideTBack = back;
}

/* ---------------- confetti ---------------- */
let confettiRaf = 0;
function stopConfetti() { cancelAnimationFrame(confettiRaf); const c = $('confetti'); if (c) c.hidden = true; }
export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti'); const ctx = c.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; c.hidden = false;
  const colors = ['#d6ad5b', '#ecc77a', '#6cc58a', '#e0645a', '#5aa9ff', '#ece8e1', '#b98cff'];
  const N = 160, parts = [];
  for (let i = 0; i < N; i++) parts.push({ x: Math.random() * c.width, y: -Math.random() * c.height * 0.6, vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 3) * dpr,
    r: (4 + Math.random() * 5) * dpr, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.3, col: colors[i % colors.length], shape: i % 3 });
  const t0 = performance.now();
  cancelAnimationFrame(confettiRaf);
  const step = (t) => {
    const el = t - t0;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalAlpha = el > 4200 ? Math.max(0, 1 - (el - 4200) / 800) : 1;
    for (const p of parts) {
      p.x += p.vx + Math.sin((el / 400) + p.a) * 0.6 * dpr; p.y += p.vy; p.a += p.va; p.vy += 0.02 * dpr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col;
      if (p.shape === 0) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.r / 2.4, 0, 6.28); ctx.fill(); }
      else { ctx.fillRect(-p.r / 4, -p.r / 2, p.r / 2, p.r); }
      ctx.restore();
    }
    if (el < 5000) confettiRaf = requestAnimationFrame(step); else c.hidden = true;
  };
  confettiRaf = requestAnimationFrame(step);
}
