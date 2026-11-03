// v1.8 Crowns 👑: balance in the top bar, "+N 👑" when you earn, the Shop, the Crown history, locks on premium items.
// Every reward and purchase is decided by the server (/api/c/...); this file only asks and shows.
// Guests earn on this phone (by its device id); signing in moves those Crowns into the account.
import { ITEMS, EARN, FREE_REVIEWS_PER_DAY, FREEZE_MAX, PACKS, itemById, itemOf, isPremium } from './crowns-data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'kingside-crowns-v1', LEGACY = 'kingside-legacy-v1';
const hi = () => window.__i18n && window.__i18n.lang && window.__i18n.lang() === 'hi';
const nm = (it) => (hi() ? it.name[1] : it.name[0]);
let opts = { api: null, session: () => null, dev: () => null, toast: () => {}, openView: () => {}, onChange: () => {}, signIn: () => {} };
let S = load();   // { who, bal, own, tickets, freeze, cos, reviews, today, streak, at }

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { who: null, bal: 0, own: {} }; } catch (e) { return { who: null, bal: 0, own: {} }; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
const who = () => { const s = opts.session(); return s ? 's:' + s.slice(0, 8) : 'd:' + (opts.dev() || '').slice(0, 8); };
const idq = () => { const s = opts.session(); return s ? { s } : { dev: opts.dev() }; };
const qs = () => { const p = idq(); return p.s ? 's=' + p.s : 'dev=' + p.dev; };
export const signedIn = () => !!opts.session();
export const balance = () => (S.who === who() ? S.bal || 0 : 0);
export const state = () => S;

// players who had Kingside before Crowns keep everything that was free then, on this phone, even as guests
// (accounts get the same from the server, together with a welcome gift)
function markLegacy() {
  try {
    if (localStorage.getItem(LEGACY) != null) return;
    const before = ['kingside-progress-v1', 'kingside-saved-v1', 'kingside-history-v1', 'kingside-learn-v1', 'kingside-session-v1'].some((k) => localStorage.getItem(k) != null)
      || Object.keys(localStorage).some((k) => k.startsWith('kingside-') && k !== KEY && k !== 'kingside-device-v1' && k !== 'kingside-lang');
    localStorage.setItem(LEGACY, before ? '1' : '0');
  } catch (e) {}
}
const legacy = () => { try { return localStorage.getItem(LEGACY) === '1'; } catch (e) { return false; } };
export function owns(type, v) {
  if (!isPremium(type, v)) return true;
  const it = itemOf(type, v);
  if (!it) return true;
  if (it.legacy && legacy()) return true;
  return S.who === who() && !!(S.own && S.own[it.id]);
}
export const priceOf = (type, v) => { const it = itemOf(type, v); return it ? it.price : 0; };

function setState(d) {
  if (!d || !d.ok) return;
  const prev = S.who === who() ? S.bal : null;
  S = { who: who(), bal: d.bal, own: d.own || {}, tickets: d.tickets || 0, freeze: d.freeze || 0, cos: d.cos || {}, reviews: d.reviews, today: d.today, streak: d.streak, at: Date.now() };
  save(); renderChip(prev); opts.onChange(S);
  if (d.streak && d.streak.frozen && d.streak.frozen.length) try { window.dispatchEvent(new CustomEvent('kingside-frozen', { detail: d.streak.frozen })); } catch (e) {}
  if (curView) rerender();
}
export async function refresh() { try { setState(await opts.api('c/state?' + qs())); } catch (e) { renderChip(); } return S; }
// app opened / player changed: daily login bonus, streak freezes, streak milestones
export async function checkin() {
  try { const d = await opts.api('c/checkin', { body: idq() }); setState(d); celebrate(d.earned); if (d.frozenNow && d.frozenNow.length) opts.toast(`❄️ Streak Freeze used: your streak is safe`); }
  catch (e) { renderChip(); }
}
async function earn(path, body) {
  try { const d = await opts.api('c/' + path, { body: { ...idq(), ...body } }); celebrate(d.earned); refresh(); return d; }
  catch (e) { return null; }
}
// hooks the game calls
export const gameFinished = (g) => earn('game', g);
export const lessonDone = (id) => earn('lesson', { id });
export const dailySolved = (date, moves) => earn('daily', { date, moves });
export const shared = (id) => earn('shared', { id });
export const onlineDone = () => setTimeout(async () => { const before = balance(); await refresh(); const d = balance() - before; if (d > 0) floatUp(d, 'Online game'); }, 1500);

/* ---------------- top bar chip + "+N 👑" ---------------- */
function renderChip(prev) {
  const b = balance();
  document.querySelectorAll('[data-crowns]').forEach((el) => { el.textContent = String(b); });
  const chip = $('btn-crowns');
  if (chip) chip.setAttribute('aria-label', `${b} Crowns, open the Crown Shop`);
  if (prev != null && b > prev && chip) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
}
const KIND = { login: 'Daily login bonus', bot: 'Bot win', online: 'Online game', daily: 'Daily Puzzle', lesson: 'Lesson finished', streak: 'Streak milestone', ach: 'Achievement', welcome: 'Welcome gift', guest: 'From this phone' };
function celebrate(list) {
  if (!list || !list.length) return;
  list.forEach((e, i) => setTimeout(() => floatUp(e.amt, e.note || KIND[e.kind] || ''), 350 + i * 1300));
}
export function floatUp(n, label) {
  const el = document.createElement('div');
  el.className = 'crown-float'; el.setAttribute('role', 'status');
  el.innerHTML = `<b>+${n} 👑</b>${label ? `<small>${esc(label)}</small>` : ''}`;
  const chip = $('btn-crowns'); const r = chip && chip.offsetParent ? chip.getBoundingClientRect() : null;
  if (r) { el.style.top = r.bottom + 6 + 'px'; el.style.left = Math.max(8, Math.min(window.innerWidth - 168, r.left + r.width / 2 - 80)) + 'px'; }
  else { el.style.top = '64px'; el.style.left = 'calc(50% - 80px)'; }
  document.body.appendChild(el);
  try { navigator.vibrate && navigator.vibrate(15); } catch (e) {}
  setTimeout(() => el.remove(), 2600);
}

/* ---------------- views (drawn inside the account screen: 'shop' and 'crowns') ---------------- */
let curView = null, curBody = null, busy = false, filter = 'all';
const SECTIONS = [['theme', 'Boards'], ['pieces', 'Piece sets'], ['avatar', 'Avatars'], ['frame', 'Profile frames'], ['bot', 'Bots'], ['extra', 'Extras']];
function preview(it) {
  if (it.type === 'theme') return `<span class="cs-pv sw sw-${it.v}"></span>`;
  if (it.type === 'pieces') return `<span class="cs-pv cs-pv-pc"><img src="pieces/${it.v}/wN.svg" alt=""><img src="pieces/${it.v}/bQ.svg" alt=""></span>`;
  if (it.type === 'avatar') return `<span class="cs-pv cs-pv-av">${it.v}</span>`;
  if (it.type === 'frame') return `<span class="cs-pv cs-pv-fr"><span class="av-frame fr-${it.v}">K</span></span>`;
  if (it.type === 'bot') return `<span class="cs-pv cs-pv-bot"><img src="bots/${it.v}.svg" alt=""></span>`;
  if (it.type === 'review') return `<span class="cs-pv cs-pv-ic">🔍</span>`;
  return `<span class="cs-pv cs-pv-ic">❄️</span>`;
}
function card(it) {
  const own = !it.use && owns(it.type, it.v);
  const worn = (it.type === 'frame' || it.type === 'avatar') && S.cos && S.cos[it.type] === it.v;
  // v1.8.1: the board / piece set on right now, or the frame / avatar being worn, is marked active
  const active = own && (worn || (it.type === 'theme' && document.body.classList.contains('theme-' + it.v)) || (it.type === 'pieces' && document.body.dataset.pieces === it.v));
  let btn;
  if (it.use) {
    const have = it.type === 'review' ? S.tickets || 0 : S.freeze || 0;
    const full = it.type === 'freeze' && have + it.n > FREEZE_MAX;
    btn = `<button type="button" class="btn btn-gold cs-buy" data-buy="${it.id}" ${full ? 'disabled' : ''}>${full ? 'Max ' + FREEZE_MAX : `👑 ${it.price}`}</button>${have ? `<small class="cs-have">You have ${have}</small>` : ''}`;
  } else if (own) {
    if (it.type === 'frame' || it.type === 'avatar') btn = signedIn() ? `<button type="button" class="btn ${worn ? 'btn-ghost' : 'btn-green'} cs-buy" data-wear="${it.id}">${worn ? 'Take off' : 'Wear'}</button>` : `<span class="cs-owned">Owned ✓</span>`;
    else if (it.type === 'bot') btn = `<button type="button" class="btn btn-green cs-buy" data-play="${it.v}">Play</button>`;
    else btn = active ? `<span class="cs-owned cs-inuse">✓ In use</span>` : `<button type="button" class="btn btn-green cs-buy" data-use="${it.id}">Use</button>`;
  } else btn = `<button type="button" class="btn btn-gold cs-buy" data-buy="${it.id}">👑 ${it.price}</button>`;
  return `<li class="cs-item${own ? ' owned' : ''}${active ? ' active' : ''}${it.id === hlId ? ' cs-hl' : ''}" data-item="${esc(it.id)}">${active && worn ? '<em class="cs-act">✓ Wearing</em>' : ''}${preview(it)}<span class="cs-t"><b data-i18n-skip>${esc(nm(it))}</b>${it.isNew ? '<em class="cs-new">NEW</em>' : ''}</span>${btn}</li>`;
}
function shopHtml() {
  const b = balance();
  const guest = !signedIn();
  const sec = SECTIONS.map(([k, title]) => {
    const list = ITEMS.filter((it) => (k === 'extra' ? it.use : it.type === k));
    return `<h3 class="cs-h">${title}</h3><ul class="cs-grid">${list.map(card).join('')}</ul>`;
  }).join('');
  return `<div class="cs-top"><div class="cs-bal"><span class="cs-crown">👑</span><b data-crowns>${b}</b><small>Crowns</small></div>
      <div class="cs-acts"><button type="button" class="btn btn-ghost" data-cgo="crowns">History</button><button type="button" class="btn btn-ghost" data-cgo="earn">How to earn</button></div></div>
    ${guest ? `<p class="cs-note">Playing as a guest: your Crowns are saved on this phone. <button type="button" class="a-link" data-cgo="auth">Sign in</button> to keep them on any phone.</p>` : ''}
    <p class="cs-note cs-fair">Crowns buy looks and extras only, never playing strength.</p>
    ${sec}
    <h3 class="cs-h">Get more Crowns</h3>
    <div class="cs-packs"><button type="button" class="btn btn-ghost" disabled>Buy Crowns · coming soon</button><small>For now, earn them free by playing every day.</small></div>`;
}
function earnHtml() {
  const t = S.today || {};
  const row = (a, b, c) => `<tr><td>${a}</td><td class="ce-n">${b}</td><td class="ce-cap">${c}</td></tr>`;
  const bw = EARN.botWin;
  return `<div class="a-card"><h3 class="cs-h">How to earn Crowns</h3><table class="ce-tab"><tbody>
    ${row('Daily login', `+${EARN.login}`, t.login ? 'Done today ✅' : 'Once a day')}
    ${row('Beat a bot (checkmate)', `+${bw[3][1]} to +${bw[0][1]}`, `Stronger bots pay more · ${t.botWins || 0}/${EARN.botWinsPerDay} today`)}
    ${row('Rated online game', `+${EARN.online.loss} / +${EARN.online.draw} / +${EARN.online.win}`, `Loss / draw / win · ${t.online || 0}/${EARN.onlinePerDay} today`)}
    ${row('Daily Puzzle', `+${EARN.daily}`, t.daily ? 'Done today ✅' : 'Solve it first try')}
    ${row('Learn lesson', `+${EARN.lesson}`, 'Each lesson, the first time')}
    ${row('3-day streak', `+${EARN.streak[3]}`, '')}${row('7-day streak', `+${EARN.streak[7]}`, '')}${row('30-day streak', `+${EARN.streak[30]}`, '')}
    ${row('First win', `+${EARN.ach.first_win}`, 'Once')}${row('First online game', `+${EARN.ach.first_online}`, 'Once')}${row('First share', `+${EARN.ach.first_share}`, 'Once')}
    </tbody></table><p class="a-small a-muted">Bot wins: under 800 → +${bw[3][1]}, 800+ → +${bw[2][1]}, 1400+ → +${bw[1][1]}, 2000+ → +${bw[0][1]}. ${FREE_REVIEWS_PER_DAY} full Game Reviews a day are free; more cost a review ticket.</p></div>`;
}
const when = (t) => new Date(t).toLocaleString(hi() ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function histHtml(list) {
  if (!list) return '<div class="a-card a-center a-muted">Loading…</div>';
  const rows = list.map((x) => `<li class="ch-row ${x.amt > 0 ? 'in' : 'out'}"><span class="ch-ic">${x.amt > 0 ? '👑' : '🛍️'}</span><span class="ch-t"><b data-i18n-skip>${esc(niceNote(x))}</b><small>${esc(when(x.t))}</small></span><b class="ch-n">${x.amt > 0 ? '+' : ''}${x.amt}</b></li>`).join('');
  return `<div class="cs-top"><div class="cs-bal"><span class="cs-crown">👑</span><b data-crowns>${balance()}</b><small>Crowns</small></div>
    <div class="cs-acts"><button type="button" class="btn btn-gold" data-cgo="shop">Shop</button></div></div>
    ${list.length ? `<ul class="ch-list">${rows}</ul>` : '<div class="a-card a-center a-muted">No Crowns yet. Win a game or solve the Daily Puzzle to earn your first!</div>'}`;
}
function niceNote(x) {
  if (x.kind === 'buy') { const it = ITEMS.find((i) => i.name[0] === x.note); return (hi() ? 'खरीदा: ' : 'Bought: ') + (it ? nm(it) : x.note); }
  if (x.kind === 'lesson') return hi() ? 'पाठ पूरा किया' : 'Lesson finished';
  const H = { 'Daily login bonus': 'डेली लॉगिन बोनस', 'Welcome gift': 'वेलकम गिफ़्ट', 'Welcome gift for existing players': 'पुराने खिलाड़ियों के लिए वेलकम गिफ़्ट', 'First win': 'पहली जीत',
    'First online game': 'पहला ऑनलाइन गेम', 'First share': 'पहला शेयर', 'Crowns earned on this phone before signing in': 'साइन-इन से पहले इस फ़ोन पर कमाए क्राउन', 'Moved to your account': 'आपके अकाउंट में भेजे गए' };
  if (hi() && H[x.note]) return H[x.note];
  if (hi() && /^Daily Puzzle/.test(x.note || '')) return 'डेली पज़ल';
  if (hi() && /-day streak$/.test(x.note || '')) return parseInt(x.note, 10) + ' दिन की स्ट्रीक';
  if (hi() && /^Win vs /.test(x.note || '')) return x.note.replace(/^Win vs computer level/, 'कंप्यूटर लेवल').replace(/^Win vs /, '') + ' से जीत';
  if (hi() && /^Rated game/.test(x.note || '')) return 'रेटेड ऑनलाइन गेम';
  return x.note || KIND[x.kind] || x.kind;
}
let histList = null;
export function render(view, body) {
  curView = view; curBody = body;
  if (view === 'shop') body.innerHTML = shopHtml();
  else if (view === 'crowns') { body.innerHTML = histHtml(histList); loadHist(); }
  else if (view === 'earn') body.innerHTML = earnHtml();
  body.onclick = onClick;
  if (view === 'shop' || view === 'earn') refresh();
}
export const title = (v) => ({ shop: 'Crown Shop', crowns: 'Crown history', earn: 'Earn Crowns' }[v]);
export function leave() { curView = null; curBody = null; }
function rerender() { if (!curBody || !curBody.isConnected) { curView = null; return; } const y = curBody.scrollTop; if (curView === 'shop') curBody.innerHTML = shopHtml(); else if (curView === 'earn') curBody.innerHTML = earnHtml(); else if (curView === 'crowns') curBody.innerHTML = histHtml(histList); curBody.scrollTop = y; }
async function loadHist() {
  try { const d = await opts.api('c/history?' + qs()); histList = d.list; if (curView === 'crowns') rerender(); } catch (e) { if (curView === 'crowns') curBody.innerHTML = '<div class="a-card a-center a-muted">No connection. Check your internet.</div>'; }
}
async function onClick(e) {
  const go = e.target.closest('[data-cgo]'); if (go) { const v = go.dataset.cgo; if (v === 'auth') opts.signIn(); else opts.openView(v); return; }
  const b = e.target.closest('[data-buy]'); if (b) return buy(b.dataset.buy, b);
  const w = e.target.closest('[data-wear]'); if (w) return wear(w.dataset.wear);
  const u = e.target.closest('[data-use]'); if (u) { const it = itemById(u.dataset.use); opts.use && opts.use(it); rerender(); return; }
  const p = e.target.closest('[data-play]'); if (p) { opts.playBot && opts.playBot(p.dataset.play); }
}
export async function buy(id, btn) {
  const it = itemById(id); if (!it || busy) return false;
  if (balance() < it.price) { opts.toast(`You need ${it.price - balance()} more Crowns 👑`); return false; }
  busy = true; if (btn) btn.disabled = true;
  try {
    const d = await opts.api('c/buy', { body: { ...idq(), item: id } });
    setState(d); opts.toast(`${nm(it)} unlocked 🎉`);
    try { navigator.vibrate && navigator.vibrate([20, 40, 20]); } catch (e) {}
    histList = null;
    return true;
  } catch (er) { opts.toast(er.message); return false; }
  finally { busy = false; if (btn && btn.isConnected) btn.disabled = false; }
}
async function wear(id) {
  const it = itemById(id); const off = S.cos && S.cos[it.type] === it.v;
  try { setState(await opts.api('c/equip', { body: { ...idq(), slot: it.type, item: off ? null : id } })); opts.onCos && opts.onCos(S.cos); }
  catch (er) {
    // not bought yet: refresh what this player owns and offer that exact item, then wear it once bought
    if (er.code === 'not_owned') { await refresh(); return offer(id, () => wear(id)); }
    opts.toast(er.message);
  }
}
// open the Shop scrolled to one item, highlighted
let hlId = null, hlTimer;
export function showInShop(id) {
  hlId = id; clearTimeout(hlTimer); hlTimer = setTimeout(() => { hlId = null; document.querySelectorAll('.cs-item.cs-hl').forEach((x) => x.classList.remove('cs-hl')); }, 4000);
  opts.openView('shop');
  setTimeout(() => { const li = document.querySelector(`.cs-item[data-item="${CSS.escape(id)}"]`); if (li) li.scrollIntoView({ block: 'center' }); }, 250);
}

/* ---------------- a locked item was tapped: offer it ---------------- */
export function offer(id, after) {
  const it = itemById(id); if (!it) return;
  let el = $('sheet-crown-offer');
  if (!el) { el = document.createElement('div'); el.className = 'sheet-backdrop'; el.id = 'sheet-crown-offer'; document.body.appendChild(el); }
  const b = balance(); const enough = b >= it.price;
  el.innerHTML = `<div class="sheet cs-offer" role="dialog" aria-modal="true"><div class="cs-offer-pv">${preview(it)}</div><h2 data-i18n-skip>${esc(nm(it))}</h2>
    <p class="a-muted">${enough ? `Unlock it for ${it.price} Crowns. You have ${b}.` : `It costs ${it.price} Crowns. You have ${b}: win games, solve the Daily Puzzle and finish lessons to earn more.`}</p>
    <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-x>Not now</button>${enough ? `<button type="button" class="btn btn-gold" data-ok>👑 Unlock for ${it.price}</button>` : `<button type="button" class="btn btn-gold" data-shop>Open the Shop</button>`}</div></div>`;
  el.hidden = false;
  el.onclick = async (e) => {
    if (e.target === el || e.target.closest('[data-x]')) { el.hidden = true; return; }
    if (e.target.closest('[data-shop]')) { el.hidden = true; showInShop(id); return; }
    if (e.target.closest('[data-ok]')) { const ok = await buy(id, e.target.closest('[data-ok]')); if (ok) { el.hidden = true; after && after(); } }
  };
}

/* ---------------- Game Review limit ---------------- */
// true = go ahead with a full review. Offline: always yes (nothing is counted).
export async function reviewGate(raw) {
  const key = 'g' + String(raw).length + '_' + [...String(raw)].reduce((a, ch) => (Math.imul(a ^ ch.charCodeAt(0), 16777619)) >>> 0, 2166136261).toString(36);
  let d;
  try { d = await opts.api('c/review', { body: { ...idq(), key } }); } catch (e) { return true; }
  setState(d);
  if (d.allowed) { if (d.how === 'free' && d.reviews) { const left = d.reviews.free - d.reviews.used; opts.toast(left > 0 ? `Free review · ${left} more free today` : 'Last free review today'); } return true; }
  return new Promise((resolve) => {
    let el = $('sheet-review-limit');
    if (!el) { el = document.createElement('div'); el.className = 'sheet-backdrop'; el.id = 'sheet-review-limit'; document.body.appendChild(el); }
    const draw = () => {
      const t = S.tickets || 0;
      el.innerHTML = `<div class="sheet cs-offer" role="dialog" aria-modal="true"><div class="cs-offer-pv"><span class="cs-pv cs-pv-ic">🔍</span></div><h2>Free reviews used up today</h2>
        <p class="a-muted">You get ${FREE_REVIEWS_PER_DAY} full Game Reviews free every day. Use a review ticket for this one, or come back tomorrow. Reviews you already ran stay free to open.</p>
        <div class="cs-offer-acts">${t ? `<button type="button" class="btn btn-gold" data-t>Use a ticket (you have ${t})</button>` : `<button type="button" class="btn btn-gold" data-b="review:1">1 review · 👑 15</button><button type="button" class="btn btn-gold" data-b="review:5">5 reviews · 👑 60</button>`}
        <button type="button" class="btn btn-ghost" data-x>Not now</button></div><p class="a-small a-muted">You have ${balance()} Crowns.</p></div>`;
    };
    draw(); el.hidden = false;
    el.onclick = async (e) => {
      if (e.target === el || e.target.closest('[data-x]')) { el.hidden = true; resolve(false); return; }
      const bb = e.target.closest('[data-b]'); if (bb) { if (await buy(bb.dataset.b, bb)) draw(); return; }
      if (e.target.closest('[data-t]')) {
        try { const r = await opts.api('c/review', { body: { ...idq(), key, useTicket: true } }); setState(r); if (r.allowed) { el.hidden = true; resolve(true); } else draw(); }
        catch (er) { el.hidden = true; resolve(true); }
      }
    };
  });
}

/* ---------------- frames + avatars ---------------- */
export function avatarHtml(cos, letter) {
  const c = cos || {};
  return `<span class="av-frame${c.frame ? ' fr-' + esc(c.frame) : ''}">${c.avatar ? `<span class="av-emoji">${esc(c.avatar)}</span>` : esc(letter)}</span>`;
}

export function setup(o) {
  opts = { ...opts, ...o };
  markLegacy();
  renderChip();
  window.addEventListener('kingside-lang', () => { if (curView) rerender(); });
}
if (typeof window !== 'undefined') window.__kingsideCrowns = { state, refresh, owns, balance, floatUp };
