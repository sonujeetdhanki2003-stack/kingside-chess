// Kingside Chess online play: talks to the site's own game server (/api/*).
// The server holds the game, checks every move and runs the clocks, so a refresh or a dropped
// connection just rejoins the same room.
const API = '/api/';
const ROOMS = 'kingside-rooms-v1';   // room code -> seat token, so a link reopens your own seat
const CURRENT = 'kingside-online-v1'; // the room you are in right now

async function call(path, opts = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(API + path, { ...opts, signal: ctl.signal, cache: 'no-store',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok || !data || data.ok === false) {
      const e = new Error((data && data.error) || `Server answered ${res.status}`);
      e.code = (data && data.code) || 'http_' + res.status; e.status = res.status; e.http = true;
      throw e;
    }
    return data;
  } finally { clearTimeout(t); }
}
const post = (path, body, timeoutMs) => call(path, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);

const sess = () => { try { return JSON.parse(localStorage.getItem('kingside-session-v1') || 'null'); } catch (e) { return null; } };
export function createRoom({ color, tc, name, rated }) { return post('create', { color, tc, name, rated: !!rated, s: sess() }); }
export function joinRoom(code, tok, name) { return post('join', { code, tok, name, s: sess() }); }
export function sendChat(code, tok, msg) { return post('action', { code, tok, type: 'chat', msg }); }
export function sendMove(code, tok, uci, ply) { return post('move', { code, tok, uci, ply }); }
export function sendAction(code, tok, type) { return post('action', { code, tok, type }); }
export function poll(code, tok, ver, signal) {
  const q = new URLSearchParams({ code, tok: tok || '', ver: String(ver || 0) });
  return call('poll?' + q, { signal }, 20000);
}
export function leave(code, tok) {
  try {
    const blob = new Blob([JSON.stringify({ code, tok })], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon(API + 'leave', blob)) return;
  } catch (e) {}
  fetch(API + 'leave', { method: 'POST', body: JSON.stringify({ code, tok }), keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
}

export function rememberSeat(code, tok) {
  try {
    const m = JSON.parse(localStorage.getItem(ROOMS) || '{}');
    m[code] = { tok, at: Date.now() };
    // keep the 20 newest rooms
    const keep = Object.entries(m).sort((a, b) => b[1].at - a[1].at).slice(0, 20);
    localStorage.setItem(ROOMS, JSON.stringify(Object.fromEntries(keep)));
    localStorage.setItem(CURRENT, JSON.stringify({ code, tok }));
  } catch (e) {}
}
export function seatFor(code) {
  try { const m = JSON.parse(localStorage.getItem(ROOMS) || '{}'); return m[code] ? m[code].tok : null; } catch (e) { return null; }
}
export function currentRoom() {
  try { return JSON.parse(localStorage.getItem(CURRENT) || 'null'); } catch (e) { return null; }
}
export function forgetCurrent() { try { localStorage.removeItem(CURRENT); } catch (e) {} }

export function roomLink(code) { return `${location.origin}/?room=${code}`; }
export function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
