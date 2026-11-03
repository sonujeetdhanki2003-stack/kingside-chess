// Kingside Chess — Copyright (C) 2026 Sonujeet Dhanki. Licensed under the GNU GPL v3 (see LICENSE).
// Kingside Chess online rooms: a tiny authoritative game server on the site's own Worker.
// State lives in D1 (one row per room). Clients long-poll /api/poll; every move is validated with chess.js here.
import { Chess } from '../site/vendor/chess.js';
import { uApi, qApi, fApi, rApi, recordRoomGame, sessUser, uSchema, roomRatings } from './accounts.src.js';
import { shareApi, sharePage } from './share.src.js';
import { cApi } from './crowns.src.js';

const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TCS = { none: null, '1+0': [1, 0], '2+1': [2, 1], '3+2': [3, 2], '5+0': [5, 0], '10+0': [10, 0], '15+10': [15, 10] };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ONLINE_MS = 12000;      // a seat polled within this window counts as connected
const POLL_MS = 8000;         // long-poll hold
const STEP_MS = 300;          // how often a held poll re-reads the room
const ROOM_TTL = 1000 * 60 * 60 * 24 * 14;

let schemaReady = false;
let seenNow = { w: 0, b: 0 };
let joinedSeat = null; // a seat claimed inside this write counts as seen now
async function schema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, data TEXT NOT NULL, ver INTEGER NOT NULL, seen_w INTEGER NOT NULL DEFAULT 0, seen_b INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS tourneys (code TEXT PRIMARY KEY, data TEXT NOT NULL, ver INTEGER NOT NULL, seen TEXT NOT NULL DEFAULT \'{}\', created INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS ratings (tok TEXT PRIMARY KEY, name TEXT NOT NULL, rating REAL NOT NULL, games INTEGER NOT NULL, w INTEGER NOT NULL, d INTEGER NOT NULL, l INTEGER NOT NULL, updated INTEGER NOT NULL)').run();
  // one-off: remove the four test players a QA run left on the leaderboard on 2026-10-25 11:56 UTC
  await db.prepare("DELETE FROM ratings WHERE updated BETWEEN 1792929300000 AND 1792929660000 AND games = 3 AND name IN ('Priya', 'Sonujeet', 'Amit', 'Rahul')").run();
  schemaReady = true;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
});
const err = (code, words, status = 400) => json({ ok: false, code, error: words }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const other = (c) => (c === 'w' ? 'b' : 'w');
function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPH[x % ALPH.length]).join('');
}
function token() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const cleanName = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

function freshGame(d) {
  d.fen = START; d.moves = []; d.sans = []; d.reps = { [posKey(START)]: 1 };
  d.result = null; d.drawOffer = null; d.rematch = { w: false, b: false };
  d.status = d.seats.w.tok && d.seats.b.tok ? 'active' : 'waiting';
  d.clock = d.tc ? { w: d.tc[0] * 60000, b: d.tc[0] * 60000, inc: d.tc[1] * 1000, turnStart: 0, running: false } : null;
}

function seatOf(d, tok) {
  if (!tok) return null;
  if (d.seats.w.tok === tok) return 'w';
  if (d.seats.b.tok === tok) return 'b';
  return null;
}

function hasMatingMaterial(chess, color) {
  let minors = 0;
  for (const rank of chess.board()) for (const p of rank) {
    if (!p || p.color !== color) continue;
    if (p.type === 'p' || p.type === 'q' || p.type === 'r') return true;
    if (p.type === 'n' || p.type === 'b') minors++;
  }
  return minors >= 2;
}

// end the game on time if the side to move has run out (server clock is the authority)
function checkFlag(d, now) {
  if (d.status !== 'active' || !d.clock || !d.clock.running) return false;
  const turn = d.fen.split(' ')[1];
  const left = d.clock[turn] - (now - d.clock.turnStart);
  if (left > 0) return false;
  d.clock[turn] = 0; d.clock.running = false;
  const chess = new Chess(d.fen);
  const opp = other(turn);
  d.result = hasMatingMaterial(chess, opp) ? { winner: opp, loser: turn, reason: 'timeout' } : { winner: null, reason: 'timeout' };
  d.status = 'over'; d.drawOffer = null;
  return true;
}

function publicState(row, d, me, now) {
  const seen = { w: row.seen_w, b: row.seen_b };
  return {
    ok: true, code: d.code, ver: row.ver, now, you: me,
    names: { w: d.seats.w.name || '', b: d.seats.b.name || '' },
    joined: { w: !!d.seats.w.tok, b: !!d.seats.b.tok },
    online: { w: !!d.seats.w.tok && now - seen.w < ONLINE_MS, b: !!d.seats.b.tok && now - seen.b < ONLINE_MS },
    tc: d.tcName, status: d.status, fen: d.fen, moves: d.moves, sans: d.sans,
    clock: d.clock, result: d.result, drawOffer: d.drawOffer, rematch: d.rematch, game: d.game,
    t: d.t ? { code: d.t.code, name: d.t.name, label: d.t.label, arma: !!d.t.arma } : null,
    quick: !!d.quick, chat: (d.chat || []).slice(-40), uids: { w: d.seats.w.uid || null, b: d.seats.b.uid || null },
    rated: !!((d.quick || d.rated) && !d.t && d.tc), rt: d.rt || null,
  };
}

async function readRoom(db, code) {
  const row = await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();
  if (!row) return null;
  return { row, d: JSON.parse(row.data) };
}

// optimistic write: only lands if nobody else wrote since we read
async function writeRoom(db, row, d, now, me) {
  const seenCol = me === 'w' ? ', seen_w = ?4' : me === 'b' ? ', seen_b = ?4' : '';
  const stmt = db.prepare(`UPDATE rooms SET data = ?1, ver = ver + 1, updated = ?2${seenCol} WHERE code = ?3 AND ver = ?5`);
  const res = await stmt.bind(JSON.stringify(d), now, d.code, now, row.ver).run();
  if (!res.meta || res.meta.changes !== 1) return null;
  const nrow = { ...row, ver: row.ver + 1, updated: now };
  if (me === 'w') nrow.seen_w = now; if (me === 'b') nrow.seen_b = now;
  return nrow;
}

// read-modify-write with a couple of retries on a concurrent write
async function mutate(db, code, tok, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await readRoom(db, code);
    if (!room) return err('no_room', 'That game was not found. Check the code.', 404);
    const now = Date.now();
    const me = seatOf(room.d, tok);
    seenNow = { w: room.row.seen_w, b: room.row.seen_b };
    joinedSeat = null;
    const out = fn(room.d, me, now);
    if (out instanceof Response) return out;
    const nrow = await writeRoom(db, room.row, room.d, now, me || joinedSeat);
    if (nrow) {
      if (room.d.status === 'over') await afterOver(db, room.d);
      return json(publicState(nrow, room.d, seatOf(room.d, tok), now)); // seats swap on a rematch
    }
  }
  return err('busy', 'The game was busy, try again.', 409);
}


// a room whose two seats are already filled (quick match, friend challenge)
async function makeRoom(db, tcName, seats, extra = {}) {
  const now = Date.now();
  const d = { code: '', tcName, tc: TCS[tcName] || null, game: 1, created: now, seats, ...extra };
  freshGame(d);
  for (let i = 0; i < 8; i++) {
    d.code = rand(6);
    const res = await db.prepare('INSERT OR IGNORE INTO rooms (code, data, ver, seen_w, seen_b, created, updated) VALUES (?, ?, 1, ?, ?, ?, ?)')
      .bind(d.code, JSON.stringify(d), now, now, now, now).run();
    if (res.meta && res.meta.changes === 1) return d.code;
  }
  throw new Error('could not make a room');
}
async function afterOver(db, d) {
  if (d.status !== 'over') return;
  if (d.t) await tSyncSafe(db, d.t.code);
  try {
    await uSchema(db);
    const nr = await recordRoomGame(db, d, d.code);
    // fresh ratings beside the names for a rematch (best-effort; a concurrent write just keeps the old ones)
    if (nr) { const room = await readRoom(db, d.code); if (room) { room.d.rt = nr; await writeRoom(db, room.row, room.d, Date.now(), null); d.rt = nr; } }
  } catch (e) { /* history is best-effort; the game itself is safe */ }
}

async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

async function api(req, env, url) {
  const db = env.DB;
  if (!db) return err('no_db', 'Online play is not configured on this site.', 500);
  await schema(db);
  const path = url.pathname.replace(/^\/api\//, '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' } });

  if (path.startsWith('t/')) return tApi(req, db, url, path.slice(2));
  const ctx = { json, err, body, makeRoom, TCS };
  if (path.startsWith('u/')) return (await uApi(req, env, url, path.slice(2), ctx)) || err('not_found', 'No such endpoint.', 404);
  if (path.startsWith('q/')) return qApi(req, env, url, path.slice(2), ctx);
  if (path.startsWith('f/')) return fApi(req, env, url, path.slice(2), ctx);
  if (path.startsWith('r/')) return rApi(req, env, url, path.slice(2), ctx);
  if (path.startsWith('c/')) { await uSchema(db); return (await cApi(req, env, url, path.slice(2), { ...ctx, sessUser })) || err('not_found', 'No such endpoint.', 404); }
  if (path === 'share') { await uSchema(db); return (await shareApi(req, env, url, path, ctx)) || err('not_found', 'No such endpoint.', 404); }

  if (path === 'create' && req.method === 'POST') {
    const b = await body(req);
    const tcName = Object.prototype.hasOwnProperty.call(TCS, b.tc) ? b.tc : 'none';
    let color = b.color === 'w' || b.color === 'b' ? b.color : (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'w' : 'b');
    const tok = token();
    const now = Date.now();
    const d = { code: '', tcName, tc: TCS[tcName], game: 1, created: now,
      seats: { w: { tok: null, name: '' }, b: { tok: null, name: '' } } };
    const cu = b.s ? await sessUser(db, b.s).catch(() => null) : null;
    d.seats[color] = { tok, name: cleanName(b.name) || (cu ? cu.display : ''), uid: cu ? cu.id : null };
    if (b.rated && cu && d.tc) d.rated = true; // v1.7: rated friend game (counts only if the friend is signed in too)
    freshGame(d);
    // opportunistic cleanup of long-dead rooms
    if (Math.random() < 0.05) await db.prepare('DELETE FROM rooms WHERE updated < ?').bind(now - ROOM_TTL).run();
    for (let i = 0; i < 6; i++) {
      d.code = rand(6);
      const res = await db.prepare(`INSERT OR IGNORE INTO rooms (code, data, ver, seen_${color}, created, updated) VALUES (?, ?, 1, ?, ?, ?)`)
        .bind(d.code, JSON.stringify(d), now, now, now).run();
      if (res.meta && res.meta.changes === 1) {
        const row = { ver: 1, seen_w: color === 'w' ? now : 0, seen_b: color === 'b' ? now : 0 };
        return json({ ...publicState(row, d, color, now), tok });
      }
    }
    return err('busy', 'Could not make a room, try again.', 500);
  }

  const b = req.method === 'POST' ? await body(req) : {};
  const code = String(b.code || url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const tok = String(b.tok || url.searchParams.get('tok') || '');
  if (!code) return err('no_code', 'No game code.');

  if (path === 'join' && req.method === 'POST') {
    let newTok = null;
    const ju = b.s ? await sessUser(db, b.s).catch(() => null) : null;
    const jname = cleanName(b.name) || (ju ? ju.display : '');
    const res = await mutate(db, code, tok, (d, me, now) => {
      if (me) { if (b.name) d.seats[me].name = cleanName(b.name); return; }
      let free = !d.seats.w.tok ? 'w' : !d.seats.b.tok ? 'b' : null;
      if (!free && d.t) return err('full', 'This is a tournament game between two other players.', 409);
      if (!free) {
        // both seats taken: someone reopening the link in another browser (say, WhatsApp's own
        // browser, then Chrome) takes back the seat that is offline while the other player is online
        const off = (c) => now - (c === 'w' ? seenNow.w : seenNow.b) >= ONLINE_MS;
        if (off('w') && !off('b')) free = 'w';
        else if (off('b') && !off('w')) free = 'b';
        if (!free) return err('full', 'This game already has two players.', 409);
        newTok = token();
        d.seats[free] = { tok: newTok, name: jname || d.seats[free].name, uid: ju ? ju.id : d.seats[free].uid || null };
        joinedSeat = free;
        return undefined;
      }
      newTok = token();
      d.seats[free] = { tok: newTok, name: jname, uid: ju ? ju.id : null };
      joinedSeat = free;
      if (d.status === 'waiting') d.status = 'active';
      // the joiner's seat becomes "me" for this write
      return undefined;
    });
    if (!newTok || res.status !== 200) return res;
    // v1.7: a rated friend room shows both ratings once the second signed-in player sits down
    try {
      const r0 = await readRoom(db, code);
      if (r0 && r0.d.rated && !r0.d.rt && r0.d.seats.w.uid && r0.d.seats.b.uid) {
        await uSchema(db);
        const rt = await roomRatings(db, r0.d.tcName, r0.d.seats);
        if (rt) { r0.d.rt = rt; await writeRoom(db, r0.row, r0.d, Date.now(), null); }
      }
    } catch (e) { /* ratings beside names are cosmetic */ }
    // the joiner did not hold a token when mutate ran: re-shape the answer with their seat
    const room = await readRoom(db, code);
    const me = seatOf(room.d, newTok);
    const now = Date.now();
    await db.prepare(`UPDATE rooms SET seen_${me} = ? WHERE code = ?`).bind(now, code).run();
    room.row[`seen_${me}`] = now;
    return json({ ...publicState(room.row, room.d, me, now), tok: newTok });
  }

  if (path === 'poll' && req.method === 'GET') {
    const since = +url.searchParams.get('ver') || 0;
    let room = await readRoom(db, code);
    if (!room) return err('no_room', 'That game was not found.', 404);
    const me = seatOf(room.d, tok);
    let now = Date.now();
    if (me) {
      // presence: mark me seen; if I was away, bump the version so my opponent hears I'm back
      const wasAway = now - room.row[`seen_${me}`] >= ONLINE_MS;
      await db.prepare(`UPDATE rooms SET seen_${me} = ?1${wasAway ? ', ver = ver + 1' : ''} WHERE code = ?2`).bind(now, code).run();
      room.row[`seen_${me}`] = now; if (wasAway) room.row.ver += 1;
    }
    if (checkFlag(room.d, now)) {
      const nrow = await writeRoom(db, room.row, room.d, now, null);
      if (nrow) await afterOver(db, room.d);
      if (nrow) return json(publicState(nrow, room.d, me, now));
      room = await readRoom(db, code);
    }
    const deadline = now + POLL_MS;
    let lastSeenWrite = now;
    while (room.row.ver === since && Date.now() < deadline) {
      await sleep(STEP_MS);
      const r = await db.prepare('SELECT ver, seen_w, seen_b FROM rooms WHERE code = ?').bind(code).first();
      if (!r) break;
      if (r.ver !== since) { room = await readRoom(db, code); break; }
      room.row.seen_w = r.seen_w; room.row.seen_b = r.seen_b;
      // opponent's clock may run out while we wait
      if (room.d.clock && room.d.clock.running && room.d.status === 'active') {
        const t = Date.now();
        if (checkFlag(room.d, t)) { const nrow = await writeRoom(db, room.row, room.d, t, null); if (nrow) await afterOver(db, room.d); if (nrow) return json(publicState(nrow, room.d, seatOf(room.d, tok), t)); room = await readRoom(db, code); break; }
      }
      if (me && Date.now() - lastSeenWrite > 4000) {
        lastSeenWrite = Date.now();
        await db.prepare(`UPDATE rooms SET seen_${me} = ? WHERE code = ?`).bind(lastSeenWrite, code).run();
        room.row[`seen_${me}`] = lastSeenWrite;
      }
    }
    return json(publicState(room.row, room.d, seatOf(room.d, tok), Date.now()));
  }

  if (path === 'leave' && req.method === 'POST') {
    const room = await readRoom(db, code);
    if (!room) return json({ ok: true });
    const me = seatOf(room.d, tok);
    if (me) await db.prepare(`UPDATE rooms SET seen_${me} = 0, ver = ver + 1 WHERE code = ?`).bind(code).run();
    return json({ ok: true });
  }

  if (path === 'move' && req.method === 'POST') {
    return mutate(db, code, tok, (d, me, now) => {
      if (!me) return err('not_player', 'You are not a player in this game.', 403);
      if (checkFlag(d, now)) return undefined;
      if (d.status !== 'active') return err('not_active', d.status === 'waiting' ? 'Waiting for your friend to join.' : 'The game is over.', 409);
      if (typeof b.ply === 'number' && b.ply !== d.moves.length) return err('stale', 'The position changed. Syncing.', 409);
      const chess = new Chess(d.fen);
      if (chess.turn() !== me) return err('not_your_turn', 'It is not your turn.', 409);
      const uci = String(b.uci || '');
      let mv;
      try { mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch (e) { mv = null; }
      if (!mv) return err('illegal', 'Illegal move.', 422);
      d.fen = chess.fen();
      d.moves.push(mv.from + mv.to + (mv.promotion || ''));
      d.sans.push(mv.san);
      const k = posKey(d.fen);
      d.reps[k] = (d.reps[k] || 0) + 1;
      if (d.drawOffer && d.drawOffer !== me) d.drawOffer = null; // moving declines the opponent's offer
      if (d.clock) {
        if (d.clock.running) d.clock[me] = d.clock[me] - (now - d.clock.turnStart) + d.clock.inc;
        // clocks start once both sides have made a move
        d.clock.running = d.moves.length >= 2;
        d.clock.turnStart = now;
      }
      let res = null;
      if (chess.isCheckmate()) res = { winner: me, loser: other(me), reason: 'checkmate' };
      else if (chess.isStalemate()) res = { winner: null, reason: 'stalemate' };
      else if (chess.isInsufficientMaterial()) res = { winner: null, reason: 'material' };
      else if (d.reps[k] >= 3) res = { winner: null, reason: 'threefold' };
      else if (chess.isDrawByFiftyMoves()) res = { winner: null, reason: 'fifty' };
      if (res) { d.result = res; d.status = 'over'; d.drawOffer = null; if (d.clock) d.clock.running = false; }
      return undefined;
    });
  }

  if (path === 'action' && req.method === 'POST') {
    const type = String(b.type || '');
    return mutate(db, code, tok, (d, me, now) => {
      if (!me) return err('not_player', 'You are not a player in this game.', 403);
      if (type === 'flag') { checkFlag(d, now); return undefined; }
      if (type === 'chat') {
        const msg = String(b.msg || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 160);
        if (!msg) return err('empty', 'Type a message.');
        d.chat = d.chat || [];
        const mine = d.chat.filter((m) => m.c === me);
        if (mine.length && now - mine[mine.length - 1].t < 700) return err('slow_down', 'Slow down a little.', 429);
        if (d.chat.length >= 300) d.chat = d.chat.slice(-200);
        d.chat.push({ c: me, m: msg, t: now, g: d.game || 1 });
        return undefined;
      }
      if (type === 'resign') {
        if (d.status !== 'active') return err('not_active', 'The game is not running.', 409);
        if (d.clock && d.clock.running) { const t = d.fen.split(' ')[1]; d.clock[t] -= now - d.clock.turnStart; d.clock.turnStart = now; d.clock.running = false; }
        d.result = { winner: other(me), loser: me, reason: 'resign' }; d.status = 'over'; d.drawOffer = null;
        return undefined;
      }
      // v1.8.3: a Quick Match player can decline a match before it begins (before both sides have moved).
      // The game ends as "aborted": nothing is rated, recorded or paid, and the other player's app searches again.
      if (type === 'abort') {
        if (d.status !== 'active') return err('not_active', 'The game is not running.', 409);
        if (!d.quick || d.t) return err('no_abort', 'Only a Quick Match can be declined.', 409);
        if ((d.moves || []).length >= 2) return err('started', 'The game has already started.', 409);
        if (d.clock) d.clock.running = false;
        d.result = { winner: null, reason: 'aborted', by: me }; d.status = 'over'; d.drawOffer = null;
        return undefined;
      }
      if (type === 'offer_draw') {
        if (d.status !== 'active') return err('not_active', 'The game is not running.', 409);
        if (d.drawOffer === other(me)) type_accept(d, now); else d.drawOffer = me;
        return undefined;
      }
      if (type === 'accept_draw') {
        if (d.status !== 'active' || d.drawOffer !== other(me)) return err('no_offer', 'There is no draw offer to accept.', 409);
        type_accept(d, now); return undefined;
      }
      if (type === 'decline_draw' || type === 'cancel_draw') { d.drawOffer = null; return undefined; }
      if (type === 'rematch' || type === 'cancel_rematch') {
        if (d.status !== 'over') return err('not_over', 'Finish this game first.', 409);
        if (d.t) return err('tournament', 'Tournament games have no rematch. Head back to the tournament.', 409);
        d.rematch[me] = type === 'rematch';
        if (d.rematch.w && d.rematch.b) {
          // swap colours for the new game
          const w = d.seats.w; d.seats.w = d.seats.b; d.seats.b = w;
          d.game = (d.game || 1) + 1;
          freshGame(d);
        }
        return undefined;
      }
      return err('bad_action', 'Unknown action.');
    });
  }
  return err('not_found', 'No such endpoint.', 404);
}
function type_accept(d, now) {
  if (d.clock && d.clock.running) { const t = d.fen.split(' ')[1]; d.clock[t] -= now - d.clock.turnStart; d.clock.turnStart = now; d.clock.running = false; }
  d.result = { winner: null, reason: 'agreement' }; d.status = 'over'; d.drawOffer = null;
}

// ---------------------------------------------------------------- tournaments
// One row per tournament (JSON + optimistic version, like rooms). Tournament games are ordinary rooms
// whose seats are pre-filled with the two players' device tokens and tagged with d.t, so the normal
// game screen plays them; when a room ends (move/resign/draw/flag) its result is pulled into the tournament.
const ASSETLINKS = '[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app", "package_name": "com.sonujeet.kingside", "sha256_cert_fingerprints": ["A0:0E:8E:E3:50:A3:30:B5:DA:25:B1:07:D3:B9:A2:69:D0:68:28:2B:9C:1E:7C:19:D1:B5:23:10:6B:37:52:FF"]}}]';
const T_LIMITS = { rr: [3, 8], ko: [2, 16] };
const T_POLL_MS = 8000, T_STEP_MS = 400, T_SYNC_MS = 2000;
const ELO_START = 1200, ELO_K = 32;
const SKIP = Symbol('skip');
const isTok = (s) => /^[a-f0-9]{32}$/.test(String(s || ''));
const cleanTName = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40);

async function tRead(db, code) {
  const row = await db.prepare('SELECT * FROM tourneys WHERE code = ?').bind(code).first();
  if (!row) return null;
  return { row, t: JSON.parse(row.data) };
}

// read-modify-write a tournament. fn may be async, return a Response (error), SKIP (no write) or nothing.
// ctx.rates (Elo updates) and ctx.ends (rooms to close) run only after the write lands, so a retry never doubles them.
async function tMutate(db, code, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await tRead(db, code);
    if (!cur) return err('no_tourney', 'That tournament was not found. Check the link.', 404);
    const now = Date.now();
    const ctx = { rates: [], ends: [] };
    const out = await fn(cur.t, now, ctx);
    if (out instanceof Response) return out;
    if (out === SKIP) return cur;
    const res = await db.prepare('UPDATE tourneys SET data = ?1, ver = ver + 1, updated = ?2 WHERE code = ?3 AND ver = ?4')
      .bind(JSON.stringify(cur.t), now, code, cur.row.ver).run();
    if (res.meta && res.meta.changes === 1) {
      cur.row = { ...cur.row, ver: cur.row.ver + 1, updated: now };
      for (const r of ctx.rates) { try { await applyRating(db, r); } catch (e) {} }
      for (const e of ctx.ends) { try { await endRoom(db, e.room, e.result); } catch (x) {} }
      return cur;
    }
  }
  return err('busy', 'The tournament was busy, try again.', 409);
}

const pl = (t, id) => t.players.find((p) => p.id === id);
const mkMatch = (a, b) => ({ a, b, bye: !a || !b, games: [], winner: null, done: false });

async function makeTRoom(db, t, ri, mi, wId, bId, arma, now) {
  const W = pl(t, wId), B = pl(t, bId);
  const label = t.format === 'ko' ? koRoundName(t, ri) : `Round ${ri + 1}`;
  const d = { code: '', tcName: t.tcName, tc: t.tc, game: 1, created: now,
    seats: { w: { tok: W.tok, name: W.name }, b: { tok: B.tok, name: B.name } },
    t: { code: t.code, name: t.name, r: ri, m: mi, arma: !!arma, label: label + (arma ? ' · Armageddon' : '') } };
  freshGame(d);
  for (let i = 0; i < 8; i++) {
    d.code = rand(6);
    const res = await db.prepare('INSERT OR IGNORE INTO rooms (code, data, ver, created, updated) VALUES (?, ?, 1, ?, ?)')
      .bind(d.code, JSON.stringify(d), now, now).run();
    if (res.meta && res.meta.changes === 1) return d.code;
  }
  throw new Error('could not create a game room');
}

function koRounds(n) { let s = 1, r = 0; while (s < n) { s *= 2; r++; } return Math.max(1, r); }
function koRoundName(t, ri) {
  const left = koRounds(t.size || t.players.length) - ri;
  return left === 1 ? 'Final' : left === 2 ? 'Semi-finals' : left === 3 ? 'Quarter-finals' : `Round ${ri + 1}`;
}
function seedOrder(size) { let o = [1]; while (o.length < size) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); } return o; }
function shuffle(a) {
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// round-robin by the circle method; a null is the bye
function rrSchedule(ids) {
  const p = ids.slice(); if (p.length % 2) p.push(null);
  const n = p.length, rounds = [];
  let cur = p.slice();
  for (let r = 0; r < n - 1; r++) {
    const ms = [];
    for (let i = 0; i < n / 2; i++) {
      let a = cur[i], b = cur[n - 1 - i];
      const swap = i === 0 ? r % 2 === 1 : (i + r) % 2 === 1;
      if (swap) [a, b] = [b, a];
      if (!a || !b) ms.push(mkMatch(a || b, null)); else ms.push(mkMatch(a, b)); // a plays White
    }
    // byes last so the list reads nicely
    ms.sort((x, y) => (x.bye ? 1 : 0) - (y.bye ? 1 : 0));
    rounds.push(ms);
    cur = [cur[0], cur[n - 1], ...cur.slice(1, n - 1)];
  }
  return rounds;
}

const gameRes = (result) => (result && result.winner) || 'd';

// a game finished: store it, queue the rating, settle the match (knockout draws go to armageddon)
async function recordGame(db, t, ri, mi, g, res, reason, rated, ctx, now) {
  const m = t.rounds[ri][mi];
  g.res = res; g.reason = reason;
  if (rated) {
    const W = pl(t, g.w), B = pl(t, g.b);
    ctx.rates.push({ w: W.tok, b: B.tok, wn: W.name, bn: B.name, s: res === 'w' ? 1 : res === 'b' ? 0 : 0.5 });
  }
  if (t.format === 'rr') { m.done = true; return; }
  if (res === 'w' || res === 'b') { m.winner = g[res]; m.done = true; return; }
  if (g.arma) { m.winner = g.b; m.done = true; g.reason = (reason || 'draw') + '+arma'; return; } // draw in armageddon: Black goes through
  // first game drawn: armageddon, colours swapped, a draw counts as a Black win
  const ng = { room: null, w: g.b, b: g.w, res: null, reason: null, arma: true };
  m.games.push(ng);
  const wK = pl(t, ng.w).kicked, bK = pl(t, ng.b).kicked;
  if (wK || bK) { await recordGame(db, t, ri, mi, ng, wK ? 'b' : 'w', 'forfeit', false, ctx, now); return; }
  ng.room = await makeTRoom(db, t, ri, mi, ng.w, ng.b, true, now);
}

async function startRound(db, t, now, ctx) {
  const ri = t.round;
  const ms = t.rounds[ri];
  for (let mi = 0; mi < ms.length; mi++) {
    const m = ms[mi];
    if (m.done || m.games.length) continue;
    if (m.bye) { m.done = true; if (t.format === 'ko') m.winner = m.a; continue; }
    let w = m.a, b = m.b;
    if (t.format === 'ko' && (crypto.getRandomValues(new Uint8Array(1))[0] & 1)) [w, b] = [b, w];
    const g = { room: null, w, b, res: null, reason: null, arma: false };
    m.games.push(g);
    const wK = pl(t, w).kicked, bK = pl(t, b).kicked;
    if (wK || bK) await recordGame(db, t, ri, mi, g, wK && bK ? 'd' : wK ? 'b' : 'w', 'forfeit', false, ctx, now);
    else g.room = await makeTRoom(db, t, ri, mi, w, b, false, now);
  }
  await advance(db, t, now, ctx);
}

async function advance(db, t, now, ctx) {
  if (t.status !== 'running') return;
  const ms = t.rounds[t.round];
  if (!ms.every((m) => m.done)) return;
  if (t.format === 'rr') {
    if (t.round + 1 < t.rounds.length) { t.round++; await startRound(db, t, now, ctx); }
    else finishT(t, now);
    return;
  }
  const winners = ms.map((m) => m.winner);
  if (winners.length <= 1) { finishT(t, now); return; }
  const next = [];
  for (let i = 0; i < winners.length; i += 2) next.push(mkMatch(winners[i], winners[i + 1]));
  t.rounds.push(next); t.round++;
  await startRound(db, t, now, ctx);
}

function finishT(t, now) {
  t.status = 'done'; t.finished = now;
  if (t.format === 'ko') {
    const last = t.rounds[t.rounds.length - 1];
    t.champion = last && last.length === 1 && last[0].done ? last[0].winner : null;
  } else {
    const st = standings(t);
    t.champion = st.length && st[0].played > 0 ? st[0].id : null;
  }
}

// pull finished room results into the tournament; returns true when something changed
async function tSync(db, t, now, ctx) {
  if (t.status !== 'running') return false;
  let changed = false;
  const ms = t.rounds[t.round];
  for (let mi = 0; mi < ms.length; mi++) {
    const m = ms[mi];
    if (m.done) continue;
    const g = m.games[m.games.length - 1];
    if (!g || g.res || !g.room) continue;
    const room = await readRoom(db, g.room);
    if (!room) continue;
    if (room.d.status === 'active' && checkFlag(room.d, now)) await writeRoom(db, room.row, room.d, now, null);
    if (room.d.status === 'over' && room.d.result) {
      await recordGame(db, t, t.round, mi, g, gameRes(room.d.result), room.d.result.reason, true, ctx, now);
      changed = true;
    }
  }
  if (changed) await advance(db, t, now, ctx);
  return changed;
}
async function tSyncSafe(db, code) {
  try { await tMutate(db, code, async (t, now, ctx) => ((await tSync(db, t, now, ctx)) ? undefined : SKIP)); } catch (e) {}
}

// close a room from outside (admin result, forfeit) so both phones see it end
async function endRoom(db, code, result) {
  for (let i = 0; i < 3; i++) {
    const room = await readRoom(db, code);
    if (!room || room.d.status === 'over') return;
    const d = room.d, now = Date.now();
    if (d.clock && d.clock.running) { const c = d.fen.split(' ')[1]; d.clock[c] -= now - d.clock.turnStart; d.clock.turnStart = now; d.clock.running = false; }
    d.result = result; d.status = 'over'; d.drawOffer = null;
    if (await writeRoom(db, room.row, d, now, null)) return;
  }
}

async function applyRating(db, r) {
  const get = async (tok, name) => (await db.prepare('SELECT * FROM ratings WHERE tok = ?').bind(tok).first()) || { tok, name, rating: ELO_START, games: 0, w: 0, d: 0, l: 0 };
  const A = await get(r.w, r.wn), B = await get(r.b, r.bn);
  const ea = 1 / (1 + 10 ** ((B.rating - A.rating) / 400));
  const da = ELO_K * (r.s - ea);
  const now = Date.now();
  const stmt = 'INSERT INTO ratings (tok, name, rating, games, w, d, l, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ' +
    'ON CONFLICT(tok) DO UPDATE SET name = ?2, rating = ?3, games = ?4, w = ?5, d = ?6, l = ?7, updated = ?8';
  const row = (P, name, delta, score) => db.prepare(stmt).bind(P.tok, name, P.rating + delta, P.games + 1,
    P.w + (score === 1 ? 1 : 0), P.d + (score === 0.5 ? 1 : 0), P.l + (score === 0 ? 1 : 0), now);
  await db.batch([row(A, r.wn, da, r.s), row(B, r.bn, -da, 1 - r.s)]);
}

// standings: round-robin = points, then Sonneborn-Berger, then wins; knockout = how far each got
function standings(t) {
  const S = {};
  for (const p of t.players) S[p.id] = { id: p.id, name: p.name, kicked: !!p.kicked, pts: 0, w: 0, d: 0, l: 0, sb: 0, played: 0, out: null };
  const games = [];
  t.rounds.forEach((ms, ri) => ms.forEach((m) => {
    for (const g of m.games) {
      if (!g.res) continue;
      const sw = g.res === 'w' ? 1 : g.res === 'b' ? 0 : 0.5;
      // in a knockout armageddon a draw is a Black win for the bracket, but stays a draw in the W/D/L record
      games.push([g.w, g.b, sw]);
    }
    if (t.format === 'ko' && m.done && !m.bye && m.winner) {
      const loser = m.winner === m.a ? m.b : m.a;
      if (S[loser]) S[loser].out = ri;
    }
  }));
  for (const [w, b, sw] of games) {
    const A = S[w], B = S[b]; if (!A || !B) continue;
    A.pts += sw; B.pts += 1 - sw; A.played++; B.played++;
    if (sw === 1) { A.w++; B.l++; } else if (sw === 0) { B.w++; A.l++; } else { A.d++; B.d++; }
  }
  for (const [w, b, sw] of games) {
    const A = S[w], B = S[b]; if (!A || !B) continue;
    A.sb += sw * B.pts; B.sb += (1 - sw) * A.pts;
  }
  const list = Object.values(S);
  if (t.format === 'ko') {
    const depth = (x) => (x.id === t.champion ? 1e6 : x.out === null ? 1e5 + (x.kicked ? -1 : 0) : x.out);
    list.sort((a, b) => depth(b) - depth(a) || b.w - a.w || b.pts - a.pts || a.name.localeCompare(b.name));
    // places: champion 1, finalist 2, semi losers 3–4, ...
    const R = koRounds(t.size || t.players.length);
    for (const x of list) {
      if (x.id === t.champion) x.place = '1';
      else if (x.out === null) x.place = t.status === 'done' && t.champion ? '2' : '–';
      else { const lo = 2 ** (R - x.out - 1) + 1, hi = 2 ** (R - x.out); x.place = lo === hi ? String(lo) : `${lo}–${hi}`; }
    }
  } else {
    list.sort((a, b) => (a.kicked - b.kicked) || b.pts - a.pts || b.sb - a.sb || b.w - a.w || a.name.localeCompare(b.name));
    let place = 0, prev = null;
    list.forEach((x, i) => { const key = x.pts + '|' + x.sb; if (key !== prev) place = i + 1; prev = key; x.place = String(place); });
  }
  return list;
}

async function liveInfo(db, t) {
  const live = {};
  if (t.status !== 'running') return live;
  for (const m of t.rounds[t.round] || []) {
    const g = m.games[m.games.length - 1];
    if (!g || g.res || !g.room) continue;
    const room = await readRoom(db, g.room);
    if (room) live[g.room] = { ply: room.d.moves.length, turn: room.d.fen.split(' ')[1], status: room.d.status, started: room.d.moves.length > 0 };
  }
  return live;
}

function tPublic(row, t, tok, adm, live, seen) {
  const now = Date.now();
  const me = tok ? t.players.find((p) => p.tok === tok) : null;
  const isAdmin = !!adm && adm === t.admin;
  let myGame = null;
  if (me && t.status === 'running') {
    const ms = t.rounds[t.round] || [];
    const mi = ms.findIndex((m) => m.a === me.id || m.b === me.id);
    if (mi >= 0) {
      const m = ms[mi], g = m.games[m.games.length - 1];
      if (m.bye) myGame = { bye: true };
      else if (g) {
        const color = g.w === me.id ? 'w' : 'b';
        myGame = { room: g.room, color, opp: pl(t, color === 'w' ? g.b : g.w).name, res: g.res, arma: g.arma, done: m.done, round: t.round };
      }
    } else if (t.format === 'ko') myGame = { out: true };
  }
  return {
    ok: true, ver: row.ver, code: t.code, name: t.name, format: t.format, tc: t.tcName, status: t.status,
    round: t.round, totalRounds: t.format === 'rr' ? (t.rounds.length || Math.max(1, t.players.length - (t.players.length % 2 ? 0 : 1))) : koRounds(t.size || t.players.length),
    limits: T_LIMITS[t.format], created: t.created, finished: t.finished || null, endedEarly: !!t.endedEarly,
    players: t.players.map((p) => ({ id: p.id, name: p.name, kicked: !!p.kicked, online: now - ((seen || {})[p.id] || 0) < 15000 })),
    rounds: t.rounds.map((ms, ri) => ms.map((m) => ({ a: m.a, b: m.b, bye: m.bye, winner: m.winner, done: m.done,
      games: m.games.map((g) => ({ room: g.room, w: g.w, b: g.b, res: g.res, reason: g.reason, arma: g.arma, live: g.room ? live[g.room] || null : null })) }))),
    roundNames: t.format === 'ko' ? t.rounds.map((_, ri) => koRoundName(t, ri)) : null,
    standings: t.status === 'lobby' ? [] : standings(t), champion: t.champion || null,
    me: me ? me.id : null, kicked: !!(me && me.kicked), admin: isAdmin, myGame,
  };
}

async function tApi(req, db, url, path) {
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => b[k] !== undefined ? b[k] : url.searchParams.get(k);

  if (path === 'leaders' && req.method === 'GET') {
    const rows = await db.prepare('SELECT tok, name, rating, games, w, d, l FROM ratings WHERE games > 0 ORDER BY rating DESC LIMIT 50').all();
    const tok = String(q('tok') || '');
    const list = (rows.results || []).map((r, i) => ({ rank: i + 1, name: r.name, rating: Math.round(r.rating), games: r.games, w: r.w, d: r.d, l: r.l, you: !!tok && r.tok === tok }));
    return json({ ok: true, leaders: list });
  }

  if (path === 'qa-cleanup' && req.method === 'POST') {
    // maintenance: remove test players added after `since` (names listed) from the leaderboards; needs the operator key
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(b.key || ''))))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (h !== '95424e3d7c8f3d994b0f38e633991030731901c4f95864f9ff0510d3416a9e4d') return err('forbidden', 'No.', 403);
    const names = (Array.isArray(b.names) ? b.names : []).map(String).slice(0, 40), since = +b.since || Date.now();
    let n = 0;
    for (const nm of names) {
      const r1 = await db.prepare('DELETE FROM ratings WHERE name = ? AND updated >= ?').bind(nm, since).run(); n += (r1.meta && r1.meta.changes) || 0;
      try { const r2 = await db.prepare('DELETE FROM rush WHERE name = ? AND t >= ?').bind(nm, since).run(); n += (r2.meta && r2.meta.changes) || 0; } catch (e) { /* no rush table yet */ }
    }
    return json({ ok: true, removed: n });
  }
  if (path === 'forget' && req.method === 'POST') {
    // a device can wipe its own rating (only the holder of the token can)
    if (!isTok(b.tok)) return err('no_tok', 'No player id.');
    await db.prepare('DELETE FROM ratings WHERE tok = ?').bind(String(b.tok)).run();
    return json({ ok: true });
  }

  if (path === 'create' && req.method === 'POST') {
    const format = b.format === 'ko' ? 'ko' : 'rr';
    const tcName = Object.prototype.hasOwnProperty.call(TCS, b.tc) ? b.tc : '5+0';
    const now = Date.now();
    const t = { code: '', name: cleanTName(b.name) || 'Chess Tournament', format, tcName, tc: TCS[tcName], created: now,
      admin: token(), status: 'lobby', players: [], rounds: [], round: -1, champion: null, nextId: 1 };
    for (let i = 0; i < 6; i++) {
      t.code = rand(6);
      const res = await db.prepare('INSERT OR IGNORE INTO tourneys (code, data, ver, created, updated) VALUES (?, ?, 1, ?, ?)')
        .bind(t.code, JSON.stringify(t), now, now).run();
      if (res.meta && res.meta.changes === 1) return json({ ...tPublic({ ver: 1 }, t, null, t.admin, {}, {}), adm: t.admin });
    }
    return err('busy', 'Could not create the tournament, try again.', 500);
  }

  const code = String(q('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!code) return err('no_code', 'No tournament code.');
  const tok = isTok(q('tok')) ? String(q('tok')) : '';
  const adm = String(q('adm') || '');
  const answer = async (cur) => {
    if (cur instanceof Response) return cur;
    const seenRow = await db.prepare('SELECT seen FROM tourneys WHERE code = ?').bind(code).first();
    return json(tPublic(cur.row, cur.t, tok, adm, await liveInfo(db, cur.t), seenRow ? JSON.parse(seenRow.seen || '{}') : {}));
  };

  if (path === 'join' && req.method === 'POST') {
    if (!tok) return err('no_tok', 'This browser has no player id. Reload and try again.');
    const name = cleanName(b.name);
    if (!name) return err('no_name', 'Type your name to join.');
    return answer(await tMutate(db, code, (t) => {
      const mine = t.players.find((p) => p.tok === tok);
      if (mine) {
        if (t.status === 'lobby' && mine.name !== name) mine.name = uniqName(t, name, mine.id); else return SKIP;
        return undefined;
      }
      if (t.status !== 'lobby') return err('started', t.status === 'done' ? 'This tournament is over.' : 'This tournament has already started.', 409);
      if (t.players.length >= T_LIMITS[t.format][1]) return err('full', `This tournament is full (${T_LIMITS[t.format][1]} players).`, 409);
      const id = 'p' + (t.nextId++);
      t.players.push({ id, tok, name: uniqName(t, name, id), kicked: false, joined: Date.now() });
      return undefined;
    }));
  }

  if (path === 'quit' && req.method === 'POST') {
    return answer(await tMutate(db, code, (t) => {
      const i = t.players.findIndex((p) => p.tok === tok);
      if (i < 0 || t.status !== 'lobby') return SKIP;
      t.players.splice(i, 1);
      return undefined;
    }));
  }

  if (path === 'poll' && req.method === 'GET') {
    const since = +url.searchParams.get('ver') || 0;
    let cur = await tRead(db, code);
    if (!cur) return err('no_tourney', 'That tournament was not found. Check the link.', 404);
    const me = tok ? cur.t.players.find((p) => p.tok === tok) : null;
    const markSeen = async () => { if (me) await db.prepare("UPDATE tourneys SET seen = json_set(seen, '$.' || ?1, ?2) WHERE code = ?3").bind(me.id, Date.now(), code).run(); };
    await markSeen();
    let lastSync = 0, lastSeen = Date.now();
    const deadline = Date.now() + T_POLL_MS;
    while (true) {
      if (cur.t.status === 'running' && Date.now() - lastSync >= T_SYNC_MS) {
        lastSync = Date.now();
        const r = await tMutate(db, code, async (t, now, ctx) => ((await tSync(db, t, now, ctx)) ? undefined : SKIP));
        if (!(r instanceof Response)) cur = r;
      }
      if (cur.row.ver !== since || Date.now() >= deadline) break;
      await sleep(T_STEP_MS);
      const r = await db.prepare('SELECT ver FROM tourneys WHERE code = ?').bind(code).first();
      if (r && r.ver !== cur.row.ver) cur = await tRead(db, code);
      if (Date.now() - lastSeen > 5000) { lastSeen = Date.now(); await markSeen(); }
    }
    return answer(cur);
  }

  if (path === 'admin' && req.method === 'POST') {
    const action = String(b.action || '');
    return answer(await tMutate(db, code, async (t, now, ctx) => {
      if (!adm || adm !== t.admin) return err('not_admin', 'Only the organizer can do that.', 403);
      if (action === 'start') {
        if (t.status !== 'lobby') return err('started', 'Already started.', 409);
        const [lo, hi] = T_LIMITS[t.format];
        if (t.players.length < lo) return err('few', `Need at least ${lo} players to start.`, 409);
        if (t.players.length > hi) return err('many', `At most ${hi} players.`, 409);
        const ids = shuffle(t.players.map((p) => p.id));
        t.status = 'running'; t.started = now; t.round = 0;
        if (t.format === 'rr') t.rounds = rrSchedule(ids);
        else {
          let size = 1; while (size < ids.length) size *= 2; size = Math.max(2, size);
          t.size = size;
          const order = seedOrder(size), r0 = [];
          for (let i = 0; i < size; i += 2) r0.push(mkMatch(ids[order[i] - 1] || null, ids[order[i + 1] - 1] || null));
          t.rounds = [r0];
        }
        await startRound(db, t, now, ctx);
        return undefined;
      }
      if (action === 'kick') {
        const p = pl(t, String(b.pid || ''));
        if (!p) return err('no_player', 'No such player.', 404);
        if (t.status === 'lobby') { t.players = t.players.filter((x) => x !== p); return undefined; }
        if (t.status !== 'running' || p.kicked) return SKIP;
        p.kicked = true;
        const ms = t.rounds[t.round];
        for (let mi = 0; mi < ms.length; mi++) {
          const m = ms[mi];
          if (m.done || (m.a !== p.id && m.b !== p.id)) continue;
          const g = m.games[m.games.length - 1];
          if (!g || g.res) continue;
          const res = g.w === p.id ? 'b' : 'w';
          if (g.room) ctx.ends.push({ room: g.room, result: { winner: res, loser: res === 'w' ? 'b' : 'w', reason: 'forfeit' } });
          await recordGame(db, t, t.round, mi, g, res, 'forfeit', false, ctx, now);
        }
        await advance(db, t, now, ctx);
        return undefined;
      }
      if (action === 'result') {
        if (t.status !== 'running') return err('not_running', 'The tournament is not running.', 409);
        const ri = +b.r, mi = +b.m, res = String(b.res || '');
        if (ri !== t.round || !t.rounds[ri] || !t.rounds[ri][mi]) return err('bad_game', 'That game is not in the current round.', 409);
        if (!['w', 'b', 'd'].includes(res)) return err('bad_res', 'Pick a result.');
        const m = t.rounds[ri][mi];
        const g = m.games[m.games.length - 1];
        if (m.done || !g || g.res) return err('done', 'That game already has a result.', 409);
        if (g.room) ctx.ends.push({ room: g.room, result: res === 'd' ? { winner: null, reason: 'admin' } : { winner: res, loser: res === 'w' ? 'b' : 'w', reason: 'admin' } });
        await recordGame(db, t, ri, mi, g, res, 'admin', true, ctx, now);
        await advance(db, t, now, ctx);
        return undefined;
      }
      if (action === 'end') {
        if (t.status === 'done') return SKIP;
        const wasRunning = t.status === 'running';
        t.endedEarly = true;
        if (wasRunning) {
          // close the open games so nobody keeps playing for nothing
          for (const m of t.rounds[t.round]) { const g = m.games[m.games.length - 1]; if (g && !g.res && g.room) ctx.ends.push({ room: g.room, result: { winner: null, reason: 'ended' } }); }
          finishT(t, now);
        } else { t.status = 'done'; t.finished = now; }
        t.endedEarly = true;
        return undefined;
      }
      return err('bad_action', 'Unknown action.');
    }));
  }
  return err('not_found', 'No such endpoint.', 404);
}

function uniqName(t, name, selfId) {
  const taken = new Set(t.players.filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 50; i++) { const n = `${name.slice(0, 17)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return name;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/.well-known/assetlinks.json') return new Response(ASSETLINKS, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return err('server', 'Server error: ' + (e && e.message ? e.message : String(e)), 500); }
    }
    if (url.pathname.startsWith('/g/') && env.DB) {
      try { await schema(env.DB); await uSchema(env.DB); const r = await sharePage(req, env, url); if (r) return r; }
      catch (e) { return new Response('Server error', { status: 500 }); }
    }
    return env.ASSETS.fetch(req);
  },
};
