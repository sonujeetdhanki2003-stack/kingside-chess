// Kingside Chess — Copyright (C) 2026 Sonujeet Dhanki. Licensed under the GNU GPL v3 (see LICENSE).
// Accounts, profiles, game history, quick match, friends and chat for Kingside Chess.
// Passwords: PBKDF2-SHA256 with a per-user salt. Sessions: random tokens in D1. Login is rate-limited.
import { Chess } from '../site/vendor/chess.js';
import { G2, game as glickoGame, isProv, PROV_SQL, poolOf, POOLS } from './glicko2.js';
import { mergeGuest, onlineGameCrowns, deleteOwner } from './crowns.src.js';

export const GOOGLE_CLIENT_ID = ''; // set to the OAuth client id to switch Google sign-in on
const PBKDF2_ITER = 60000;
const SESSION_TTL = 1000 * 60 * 60 * 24 * 180;
const ONLINE_WINDOW = 70000;      // a user who pinged within this window counts as online
const SEEK_ALIVE = 7000;          // a seek that has not polled within this window is dropped
const RATING_START = 1500; // v1.7: Glicko-2 start (was Elo 1200)

let ready = false;
export async function uSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, uname TEXT UNIQUE NOT NULL, display TEXT NOT NULL,
      pw TEXT, email TEXT, google_sub TEXT UNIQUE, rating REAL NOT NULL DEFAULT ${RATING_START}, rd REAL NOT NULL DEFAULT 250,
      games INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0,
      puzzle TEXT, recov TEXT, created INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '', room TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS sessions (tok TEXT PRIMARY KEY, uid INTEGER NOT NULL, created INTEGER NOT NULL, last INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS devices (tok TEXT PRIMARY KEY, uid INTEGER NOT NULL, at INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, rk TEXT UNIQUE, wuid INTEGER, buid INTEGER, wname TEXT, bname TEXT,
      moves TEXT NOT NULL, result TEXT NOT NULL, reason TEXT, tc TEXT, source TEXT NOT NULL, rated INTEGER NOT NULL DEFAULT 0,
      wr0 REAL, br0 REAL, wr1 REAL, br1 REAL, ended INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS games_w ON games (wuid, ended)'),
    db.prepare('CREATE INDEX IF NOT EXISTS games_b ON games (buid, ended)'),
    db.prepare('CREATE TABLE IF NOT EXISTS throttle (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS seeks (id TEXT PRIMARY KEY, uid INTEGER, name TEXT, rating REAL NOT NULL, tc TEXT NOT NULL,
      created INTEGER NOT NULL, seen INTEGER NOT NULL, room TEXT, seat TEXT, color TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS friends (a INTEGER NOT NULL, b INTEGER NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b))'),
    db.prepare(`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, from_uid INTEGER NOT NULL, to_uid INTEGER NOT NULL, tc TEXT NOT NULL,
      color TEXT NOT NULL, state TEXT NOT NULL, room TEXT, from_seat TEXT, to_seat TEXT, created INTEGER NOT NULL)`),
    db.prepare('CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, seat TEXT NOT NULL, name TEXT, msg TEXT NOT NULL, t INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS chat_room ON chat (room, id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS pulse (uid INTEGER PRIMARY KEY, v INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS rush (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER, dev TEXT, name TEXT NOT NULL, score INTEGER NOT NULL, day TEXT NOT NULL, t INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS rush_day ON rush (day, score)'),
    db.prepare('CREATE INDEX IF NOT EXISTS rush_score ON rush (score)'),
  ]);
  // v1.4: streaks + achievements live in one JSON column (added once; the error on later runs is expected)
  try { await db.prepare('ALTER TABLE users ADD COLUMN prog TEXT').run(); } catch (e) { /* already there */ }
  // v1.7: Glicko-2 ratings per pool (blitz, rapid) + history, shared game replays. New tables/columns only; nothing is dropped.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS glicko (uid INTEGER NOT NULL, pool TEXT NOT NULL, r REAL NOT NULL, rd REAL NOT NULL, vol REAL NOT NULL,
      n INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0, d INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL DEFAULT 0, peak REAL, PRIMARY KEY (uid, pool))`),
    db.prepare('CREATE INDEX IF NOT EXISTS glicko_pool ON glicko (pool, r)'),
    db.prepare('CREATE TABLE IF NOT EXISTS glicko_hist (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, pool TEXT NOT NULL, r REAL NOT NULL, rd REAL NOT NULL, t INTEGER NOT NULL, gid INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS glicko_hist_u ON glicko_hist (uid, pool, t)'),
    db.prepare('CREATE TABLE IF NOT EXISTS kmeta (k TEXT PRIMARY KEY, v TEXT, t INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, data TEXT NOT NULL, img BLOB, ip TEXT, t INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE INDEX IF NOT EXISTS shares_ip ON shares (ip, t)'),
  ]);
  for (const sql of ['ALTER TABLE challenges ADD COLUMN rated INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE games ADD COLUMN pool TEXT',
    'ALTER TABLE games ADD COLUMN wrd1 REAL', 'ALTER TABLE games ADD COLUMN brd1 REAL',
    // v1.9: the RD before the game, so the result screen knows when a placement finished (provisional -> ranked)
    'ALTER TABLE games ADD COLUMN wrd0 REAL', 'ALTER TABLE games ADD COLUMN brd0 REAL']) {
    try { await db.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  await migrateGlicko(db);
  await backfillHist(db);
  ready = true;
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const randHex = (n = 16) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function pbkdf2(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function hashPw(pw) { const salt = randHex(16); return `pbkdf2$${PBKDF2_ITER}$${salt}$${await pbkdf2(pw, salt, PBKDF2_ITER)}`; }
async function checkPw(pw, stored) {
  if (!stored) return false;
  const [kind, iter, salt, h] = stored.split('$');
  if (kind !== 'pbkdf2') return false;
  const got = await pbkdf2(pw, salt, +iter);
  let diff = got.length ^ h.length; for (let i = 0; i < got.length && i < h.length; i++) diff |= got.charCodeAt(i) ^ h.charCodeAt(i);
  return diff === 0;
}
async function sha(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

const unameOk = (s) => /^[a-zA-Z0-9_]{3,20}$/.test(s);
const cleanDisplay = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20);
const cleanMsg = (s) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);

export async function sessUser(db, s) {
  if (!/^[a-f0-9]{48}$/.test(String(s || ''))) return null;
  const row = await db.prepare('SELECT u.*, s.last AS slast FROM sessions s JOIN users u ON u.id = s.uid WHERE s.tok = ?').bind(s).first();
  if (!row) return null;
  const now = Date.now();
  if (now - row.slast > SESSION_TTL) { await db.prepare('DELETE FROM sessions WHERE tok = ?').bind(s).run(); return null; }
  if (now - row.slast > 3600e3) await db.prepare('UPDATE sessions SET last = ? WHERE tok = ?').bind(now, s).run();
  return row;
}
async function newSession(db, uid) {
  const tok = randHex(24); const now = Date.now();
  await db.prepare('INSERT INTO sessions (tok, uid, created, last) VALUES (?, ?, ?, ?)').bind(tok, uid, now, now).run();
  return tok;
}
// tournaments and old games were tied to this device: they now belong to the account too
async function attachDevice(db, uid, dev) {
  if (!/^[a-f0-9]{32}$/.test(String(dev || ''))) return;
  await db.prepare('INSERT INTO devices (tok, uid, at) VALUES (?, ?, ?) ON CONFLICT(tok) DO UPDATE SET uid = excluded.uid, at = excluded.at').bind(dev, uid, Date.now()).run();
  // v1.8: Crowns earned on this phone as a guest move into the account
  try { await mergeGuest(db, uid, dev); } catch (e) { /* never block a sign-in */ }
}
export async function uidForDevice(db, tok) {
  if (!tok) return null;
  const r = await db.prepare('SELECT uid FROM devices WHERE tok = ?').bind(tok).first();
  return r ? r.uid : null;
}
const cosOf = (u) => { try { return u && u.cos ? JSON.parse(u.cos) : {}; } catch (e) { return {}; } };
function me(u) {
  return { id: u.id, uname: u.uname, display: u.display, email: u.email || '', google: !!u.google_sub, hasPw: !!u.pw,
    rating: Math.round(u.rating), games: u.games, w: u.w, d: u.d, l: u.l, puzzle: u.puzzle ? JSON.parse(u.puzzle) : null, created: u.created, cos: cosOf(u) };
}
async function throttled(db, key, limit, windowMs) {
  const r = await db.prepare('SELECT n, t FROM throttle WHERE k = ?').bind(key).first();
  const now = Date.now();
  if (!r || now - r.t > windowMs) return 0;
  return r.n >= limit ? Math.ceil((r.t + windowMs - now) / 60000) : 0;
}
async function bump(db, key, windowMs) {
  const now = Date.now();
  await db.prepare('INSERT INTO throttle (k, n, t) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN ?2 - t > ?3 THEN 1 ELSE n + 1 END, t = CASE WHEN ?2 - t > ?3 THEN ?2 ELSE t END')
    .bind(key, now, windowMs).run();
}
// per-user change counter: friends/challenge long-polls wake the moment it moves
export async function pulse(db, ...uids) {
  const ids = [...new Set(uids.filter((x) => x))];
  if (!ids.length) return;
  await db.batch(ids.map((id) => db.prepare('INSERT INTO pulse (uid, v) VALUES (?1, 1) ON CONFLICT(uid) DO UPDATE SET v = v + 1').bind(id)));
}
async function pulseFriends(db, uid) {
  const r = await db.prepare("SELECT CASE WHEN a = ?1 THEN b ELSE a END AS o FROM friends WHERE (a = ?1 OR b = ?1) AND state = 'friends'").bind(uid).all();
  await pulse(db, ...(r.results || []).map((x) => x.o));
}
const pulseOf = async (db, uid) => { const r = await db.prepare('SELECT v FROM pulse WHERE uid = ?').bind(uid).first(); return r ? r.v : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function makeRecovery(db, uid) {
  const codes = []; const hashed = [];
  for (let i = 0; i < 6; i++) {
    const c = randHex(5).toUpperCase().replace(/(.{5})/, '$1-');
    codes.push(c); hashed.push(await sha(c.replace('-', '')));
  }
  await db.prepare('UPDATE users SET recov = ? WHERE id = ?').bind(JSON.stringify(hashed), uid).run();
  return codes;
}

/* ---------------- game records + ratings (Glicko-2, v1.7) ---------------- */
const blankR = (uid, pool) => ({ uid, pool, r: G2.r0, rd: G2.rd0, vol: G2.vol0, n: 0, w: 0, d: 0, l: 0, last: 0, peak: null, fresh: true });
export async function getRating(db, uid, pool) {
  if (!uid || !pool) return null;
  return (await db.prepare('SELECT * FROM glicko WHERE uid = ? AND pool = ?').bind(uid, pool).first()) || blankR(uid, pool);
}
export const rOut = (g) => (g ? { r: Math.round(g.r), rd: Math.round(g.rd), p: isProv(g.rd, g.n || 0), n: g.n || 0, pk: g.peak ? Math.round(g.peak) : null } : null);
export async function ratingsOf(db, uid) {
  const rows = await db.prepare('SELECT * FROM glicko WHERE uid = ?').bind(uid).all();
  const out = {};
  for (const p of POOLS) out[p] = rOut((rows.results || []).find((x) => x.pool === p) || blankR(uid, p));
  return out;
}
// the room's rating snapshot shown beside the names (rated games only)
export async function roomRatings(db, tcName, seats) {
  const pool = poolOf(tcName);
  if (!pool || !seats.w.uid || !seats.b.uid || seats.w.uid === seats.b.uid) return null;
  return { pool, u: { [seats.w.uid]: rOut(await getRating(db, seats.w.uid, pool)), [seats.b.uid]: rOut(await getRating(db, seats.b.uid, pool)) } };
}
function ratingWrites(db, A, nr, s, now, gid) {
  const res = s === 1 ? 'w' : s === 0 ? 'l' : 'd';
  const peak = isProv(nr.rd, (A.n || 0) + 1) ? A.peak : Math.max(A.peak || 0, nr.r);
  return [
    db.prepare(`INSERT INTO glicko (uid, pool, r, rd, vol, n, w, d, l, last, peak) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(uid, pool) DO UPDATE SET r = ?3, rd = ?4, vol = ?5, n = n + 1, w = w + ?6, d = d + ?7, l = l + ?8, last = ?9, peak = ?10`)
      .bind(A.uid, A.pool, nr.r, nr.rd, nr.vol, res === 'w' ? 1 : 0, res === 'd' ? 1 : 0, res === 'l' ? 1 : 0, now, peak),
    db.prepare('INSERT INTO glicko_hist (uid, pool, r, rd, t, gid) VALUES (?, ?, ?, ?, ?, ?)').bind(A.uid, A.pool, nr.r, nr.rd, now, gid),
    // users.rating mirrors the latest rated game's pool so older screens (friends list, search) show a sensible number
    db.prepare('UPDATE users SET rating = ?, rd = ? WHERE id = ?').bind(nr.r, nr.rd, A.uid),
  ];
}
// v1.9 one-time backfill: every rated game should have one rating-history point per player (the graph reads them).
// Adds only the missing points, from the game's own after-game rating; nothing existing is changed or removed.
async function backfillHist(db) {
  const got = await db.prepare("INSERT OR IGNORE INTO kmeta (k, v, t) VALUES ('hist_v19', 'running', ?)").bind(Date.now()).run();
  if (!got.meta || got.meta.changes !== 1) return;
  try {
    const side = (c) => db.prepare(`INSERT INTO glicko_hist (uid, pool, r, rd, t, gid) SELECT g.${c}uid, g.pool, g.${c}r1, COALESCE(g.${c}rd1, ${G2.rd0}), g.ended, g.id FROM games g
      WHERE g.rated = 1 AND g.pool IS NOT NULL AND g.${c}uid IS NOT NULL AND g.${c}r1 IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM glicko_hist h WHERE h.uid = g.${c}uid AND h.pool = g.pool AND (h.gid = g.id OR (h.gid IS NULL AND h.t = g.ended)))`).run();
    const a = await side('w'), b = await side('b');
    await db.prepare("UPDATE kmeta SET v = ?, t = ? WHERE k = 'hist_v19'").bind('done:' + (((a.meta && a.meta.changes) || 0) + ((b.meta && b.meta.changes) || 0)), Date.now()).run();
  } catch (e) {
    await db.prepare("UPDATE kmeta SET v = ? WHERE k = 'hist_v19'").bind('error:' + String(e && e.message).slice(0, 200)).run();
  }
}
// v1.7 one-time migration: replay the old Elo-rated Quick Match games through Glicko-2 so nobody's history is lost
async function migrateGlicko(db) {
  const got = await db.prepare("INSERT OR IGNORE INTO kmeta (k, v, t) VALUES ('glicko_v1', 'running', ?)").bind(Date.now()).run();
  if (!got.meta || got.meta.changes !== 1) return;
  try {
    const rows = await db.prepare("SELECT id, wuid, buid, result, tc, ended, moves FROM games WHERE rated = 1 AND wuid IS NOT NULL AND buid IS NOT NULL ORDER BY ended ASC LIMIT 5000").all();
    const st = new Map(); const stmts = [];
    const cur = (uid, pool) => { const k = uid + ':' + pool; if (!st.has(k)) st.set(k, blankR(uid, pool)); return st.get(k); };
    for (const g of rows.results || []) {
      const pool = poolOf(g.tc); if (!pool || g.wuid === g.buid || String(g.moves).split(' ').length < 4) continue;
      const s = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
      const A = cur(g.wuid, pool), B = cur(g.buid, pool);
      const ar0 = A.r, br0 = B.r;
      const [na, nb] = glickoGame(A, B, s, g.ended);
      for (const [P, N, sc] of [[A, na, s], [B, nb, 1 - s]]) {
        P.r = N.r; P.rd = N.rd; P.vol = N.vol; P.n++; P[sc === 1 ? 'w' : sc === 0 ? 'l' : 'd']++; P.last = g.ended;
        if (!isProv(N.rd, P.n)) P.peak = Math.max(P.peak || 0, N.r);
        stmts.push(db.prepare('INSERT INTO glicko_hist (uid, pool, r, rd, t, gid) VALUES (?, ?, ?, ?, ?, ?)').bind(P.uid, pool, N.r, N.rd, g.ended, g.id));
      }
      stmts.push(db.prepare('UPDATE games SET pool = ?, wr0 = ?, br0 = ?, wr1 = ?, br1 = ?, wrd1 = ?, brd1 = ? WHERE id = ?')
        .bind(pool, ar0, br0, na.r, nb.r, na.rd, nb.rd, g.id));
    }
    for (const P of st.values()) {
      stmts.push(db.prepare('INSERT OR REPLACE INTO glicko (uid, pool, r, rd, vol, n, w, d, l, last, peak) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(P.uid, P.pool, P.r, P.rd, P.vol, P.n, P.w, P.d, P.l, P.last, P.peak));
      stmts.push(db.prepare('UPDATE users SET rating = ?, rd = ? WHERE id = ?').bind(P.r, P.rd, P.uid));
    }
    stmts.push(db.prepare('UPDATE users SET rating = ?, rd = ? WHERE id NOT IN (SELECT uid FROM glicko)').bind(G2.r0, G2.rd0));
    for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
    await db.prepare("UPDATE kmeta SET v = ?, t = ? WHERE k = 'glicko_v1'").bind('done:' + (rows.results || []).length, Date.now()).run();
  } catch (e) {
    await db.prepare("UPDATE kmeta SET v = ? WHERE k = 'glicko_v1'").bind('error:' + String(e && e.message).slice(0, 200)).run();
  }
}

// rated = Quick Match, or a friend game marked rated; both signed in, two different accounts, a clock,
// not a tournament, and each side made at least 2 moves (a game aborted earlier changes nothing)
export function isRatedGame(d, uid) {
  return !!((d.quick || d.rated) && !d.t && uid.w && uid.b && uid.w !== uid.b && poolOf(d.tcName) && d.moves && d.moves.length >= 4);
}
export async function recordRoomGame(db, d, code) {
  if (d.status !== 'over' || !d.result) return;
  const seats = { w: d.seats.w, b: d.seats.b };
  const uid = {};
  for (const c of ['w', 'b']) uid[c] = seats[c].uid || (d.t ? await uidForDevice(db, seats[c].tok) : null) || null;
  if (!uid.w && !uid.b) return;
  if (!d.moves || !d.moves.length) return;
  if (d.result.reason === 'aborted') return; // v1.8.3: a declined Quick Match is not a game
  const res = d.result.winner === 'w' ? '1-0' : d.result.winner === 'b' ? '0-1' : '1/2-1/2';
  const rated = isRatedGame(d, uid);
  const pool = rated ? poolOf(d.tcName) : null;
  const rk = `room:${code}:${d.game || 1}`;
  const now = Date.now();
  const R = rated ? { w: await getRating(db, uid.w, pool), b: await getRating(db, uid.b, pool) } : null;
  let nw = null, nb = null;
  const s = d.result.winner === 'w' ? 1 : d.result.winner === 'b' ? 0 : 0.5;
  if (rated) [nw, nb] = glickoGame(R.w, R.b, s, now);
  const ins = await db.prepare(`INSERT OR IGNORE INTO games (rk, wuid, buid, wname, bname, moves, result, reason, tc, source, rated, wr0, br0, wr1, br1, ended, pool, wrd1, brd1, wrd0, brd0)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(rk, uid.w, uid.b, seats.w.name || 'White', seats.b.name || 'Black', d.moves.join(' '), res, d.result.reason || '',
    d.tcName || 'none', d.t ? 'tournament' : d.quick ? 'quick' : 'online', rated ? 1 : 0,
    R ? R.w.r : null, R ? R.b.r : null, nw ? nw.r : null, nb ? nb.r : null, now, pool, nw ? nw.rd : null, nb ? nb.rd : null, R ? R.w.rd : null, R ? R.b.rd : null).run();
  if (!ins.meta || ins.meta.changes !== 1) return; // already recorded
  const gid = ins.meta.last_row_id || null;
  const upd = [];
  for (const c of ['w', 'b']) {
    if (!uid[c]) continue;
    const score = d.result.winner === c ? 'w' : d.result.winner ? 'l' : 'd';
    upd.push(db.prepare(`UPDATE users SET games = games + 1, ${score} = ${score} + 1 WHERE id = ?`).bind(uid[c]));
  }
  if (rated) { upd.push(...ratingWrites(db, R.w, nw, s, now, gid), ...ratingWrites(db, R.b, nb, 1 - s, now, gid)); }
  if (upd.length) await db.batch(upd);
  // v1.8 Crowns: rated games pay (capped per day), first online game / first win achievements
  for (const c of ['w', 'b']) if (uid[c]) await onlineGameCrowns(db, uid[c], d.result.winner === c ? 'w' : d.result.winner ? 'l' : 'd', rated, gid, now);
  if (rated) return { pool, u: { [uid.w]: rOut({ ...nw, n: R.w.n + 1 }), [uid.b]: rOut({ ...nb, n: R.b.n + 1 }) } };
}

/* ---------------- API ---------------- */
export async function uApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body, makeRoom, TCS } = ctx;
  await uSchema(db);
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => (b[k] !== undefined ? b[k] : url.searchParams.get(k));
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const now = Date.now();

  if (path === 'config') return json({ ok: true, google: GOOGLE_CLIENT_ID || null });

  if (path === 'signup' && req.method === 'POST') {
    const uname = String(b.username || '').trim();
    if (!unameOk(uname)) return err('bad_username', 'Usernames are 3–20 letters, numbers or _.');
    const pw = String(b.password || '');
    if (pw.length < 4) return err('bad_password', 'Use at least 4 characters (a PIN is fine).');
    // generous per-network limits: a whole club on one WiFi can sign up together; bots still hit a wall
    if ((await throttled(db, 'su:' + ip, 60, 3600e3)) || (await throttled(db, 'sud:' + ip, 300, 24 * 3600e3))) return err('slow_down', 'Too many new accounts from this network. Try again in a while.', 429);
    await bump(db, 'su:' + ip, 3600e3); await bump(db, 'sud:' + ip, 24 * 3600e3);
    const email = String(b.email || '').trim().slice(0, 120);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('bad_email', 'That email does not look right.');
    const display = cleanDisplay(b.display) || uname;
    const res = await db.prepare('INSERT OR IGNORE INTO users (uname, display, pw, email, created, seen, rating, rd) VALUES (?, ?, ?, ?, ?, ?, 1500, 350)')
      .bind(uname.toLowerCase(), display, await hashPw(pw), email || null, now, now).run();
    if (!res.meta || res.meta.changes !== 1) return err('taken', 'That username is taken. Try another.', 409);
    const u = await db.prepare('SELECT * FROM users WHERE uname = ?').bind(uname.toLowerCase()).first();
    await attachDevice(db, u.id, b.dev);
    if (b.puzzle && typeof b.puzzle === 'object') await db.prepare('UPDATE users SET puzzle = ? WHERE id = ?').bind(JSON.stringify(b.puzzle).slice(0, 60000), u.id).run();
    const recovery = await makeRecovery(db, u.id);
    return json({ ok: true, session: await newSession(db, u.id), user: me(await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first()), recovery });
  }

  if (path === 'login' && req.method === 'POST') {
    const uname = String(b.username || '').trim().toLowerCase();
    const wait = (await throttled(db, 'li:' + uname, 8, 15 * 60e3)) || (await throttled(db, 'lip:' + ip, 30, 15 * 60e3));
    if (wait) return err('slow_down', `Too many wrong tries. Wait ${wait} min and try again.`, 429);
    const u = await db.prepare('SELECT * FROM users WHERE uname = ?').bind(uname).first();
    if (!u || !(await checkPw(String(b.password || ''), u.pw))) {
      await bump(db, 'li:' + uname, 15 * 60e3); await bump(db, 'lip:' + ip, 15 * 60e3);
      return err('bad_login', 'Wrong username or password.', 401);
    }
    await db.prepare('DELETE FROM throttle WHERE k = ?').bind('li:' + uname).run();
    await attachDevice(db, u.id, b.dev);
    return json({ ok: true, session: await newSession(db, u.id), user: me(u) });
  }

  if (path === 'recover' && req.method === 'POST') {
    const uname = String(b.username || '').trim().toLowerCase();
    const wait = (await throttled(db, 'rc:' + uname, 6, 30 * 60e3)) || (await throttled(db, 'lip:' + ip, 30, 15 * 60e3));
    if (wait) return err('slow_down', `Too many tries. Wait ${wait} min.`, 429);
    const u = await db.prepare('SELECT * FROM users WHERE uname = ?').bind(uname).first();
    const code = String(b.code || '').toUpperCase().replace(/[^A-F0-9]/g, '');
    const list = u && u.recov ? JSON.parse(u.recov) : [];
    const h = await sha(code);
    const i = list.indexOf(h);
    if (!u || i < 0) { await bump(db, 'rc:' + uname, 30 * 60e3); await bump(db, 'lip:' + ip, 15 * 60e3); return err('bad_code', 'That recovery code is not right for this username.', 401); }
    const pw = String(b.password || '');
    if (pw.length < 4) return err('bad_password', 'Use at least 4 characters for the new password.');
    list.splice(i, 1);
    await db.batch([
      db.prepare('UPDATE users SET pw = ?, recov = ? WHERE id = ?').bind(await hashPw(pw), JSON.stringify(list), u.id),
      db.prepare('DELETE FROM sessions WHERE uid = ?').bind(u.id),
    ]);
    return json({ ok: true, session: await newSession(db, u.id), user: me(u), codesLeft: list.length });
  }

  if (path === 'google' && req.method === 'POST') {
    if (!GOOGLE_CLIENT_ID) return err('off', 'Google sign-in is not switched on yet.', 400);
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(b.credential || '')));
    const t = r.ok ? await r.json() : null;
    if (!t || t.aud !== GOOGLE_CLIENT_ID || !t.sub || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) return err('bad_google', 'Google sign-in failed. Try again.', 401);
    let u = await db.prepare('SELECT * FROM users WHERE google_sub = ?').bind(t.sub).first();
    if (!u) {
      const base = String(t.email || t.name || 'player').split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 14) || 'player';
      for (let i = 0; i < 6 && !u; i++) {
        const uname = (i ? base + Math.floor(Math.random() * 9000 + 1000) : base).toLowerCase().padEnd(3, '0');
        const res = await db.prepare('INSERT OR IGNORE INTO users (uname, display, email, google_sub, created, seen, rating, rd) VALUES (?, ?, ?, ?, ?, ?, 1500, 350)')
          .bind(uname, cleanDisplay(t.given_name || t.name) || uname, t.email_verified === 'true' || t.email_verified === true ? t.email : null, t.sub, now, now).run();
        if (res.meta && res.meta.changes === 1) u = await db.prepare('SELECT * FROM users WHERE uname = ?').bind(uname).first();
      }
      if (!u) return err('busy', 'Could not create the account, try again.', 500);
    }
    await attachDevice(db, u.id, b.dev);
    return json({ ok: true, session: await newSession(db, u.id), user: me(u) });
  }

  // public profile
  if (path === 'profile' && req.method === 'GET') {
    const name = String(q('name') || '').toLowerCase();
    const u = await db.prepare('SELECT * FROM users WHERE uname = ?').bind(name).first();
    if (!u) return err('no_user', 'No player with that username.', 404);
    return json({ ok: true, profile: await profileOf(db, u) });
  }
  if (path === 'game' && req.method === 'GET') {
    const g = await db.prepare('SELECT * FROM games WHERE id = ?').bind(+q('id') || 0).first();
    if (!g) return err('no_game', 'Game not found.', 404);
    return json({ ok: true, game: gameOut(g, null) });
  }
  if (path === 'search' && req.method === 'GET') {
    const s = String(q('q') || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (s.length < 2) return json({ ok: true, users: [] });
    const rows = await db.prepare("SELECT id, uname, display, rating, seen FROM users WHERE uname LIKE ? ORDER BY uname LIMIT 10").bind(s + '%').all();
    return json({ ok: true, users: (rows.results || []).map((r) => ({ id: r.id, uname: r.uname, display: r.display, rating: Math.round(r.rating), online: now - r.seen < ONLINE_WINDOW })) });
  }

  // v1.7 leaderboard: established players (RD <= 110) first, then provisional ones, by rating; plus "your rank"
  if (path === 'leaderboard' && req.method === 'GET') {
    const pool = POOLS.includes(q('pool')) ? q('pool') : 'blitz';
    const order = `ORDER BY ${PROV_SQL('g.rd', 'g.n')} ASC, g.r DESC, g.n DESC`;
    const rows = await db.prepare(`SELECT g.uid, g.r, g.rd, g.n, g.w, g.d, g.l, g.peak, u.uname, u.display, u.seen, u.cos FROM glicko g JOIN users u ON u.id = g.uid
      WHERE g.pool = ? AND g.n > 0 ${order} LIMIT 50`).bind(pool).all();
    const row = (x, rank) => ({ rank, uname: x.uname, display: x.display, r: Math.round(x.r), p: isProv(x.rd, x.n), n: x.n, w: x.w, d: x.d, l: x.l, online: now - x.seen < ONLINE_WINDOW, cos: cosOf(x) });
    const list = (rows.results || []).map((x, i) => row(x, i + 1));
    const tot = await db.prepare('SELECT COUNT(*) AS n FROM glicko WHERE pool = ? AND n > 0').bind(pool).first();
    let mine = null;
    const su = q('s') ? await sessUser(db, q('s')) : null;
    if (su) {
      const g = await db.prepare('SELECT * FROM glicko WHERE uid = ? AND pool = ?').bind(su.id, pool).first();
      if (g && g.n > 0) {
        const prov = isProv(g.rd, g.n) ? 1 : 0;
        const ahead = await db.prepare(`SELECT COUNT(*) AS n FROM glicko WHERE pool = ?1 AND n > 0 AND (${PROV_SQL()} < ?2 OR (${PROV_SQL()} = ?2 AND (r > ?3 OR (r = ?3 AND n > ?4))))`)
          .bind(pool, prov, g.r, g.n).first();
        mine = row({ ...g, uname: su.uname, display: su.display, seen: now, cos: su.cos }, (ahead ? ahead.n : 0) + 1);
      } else mine = { rank: null, uname: su.uname, display: su.display, r: G2.r0, p: true, n: 0, cos: cosOf(su) }; // v1.8.2: your worn avatar in "Your rank" too
    }
    return json({ ok: true, pool, pools: POOLS, list, total: tot ? tot.n : 0, me: mine });
  }
  // the rating change of a finished online game (the result screen asks for it)
  if (path === 'rres' && req.method === 'GET') {
    const code = String(q('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const g = await db.prepare('SELECT * FROM games WHERE rk = ?').bind(`room:${code}:${+q('game') || 1}`).first();
    if (!g) return json({ ok: true, found: false });
    // v1.9: p0 = provisional before the game (null for games recorded before v1.9), n = rated games in the pool so far
    const side = async (uid, r0, r1, rd1, rd0) => {
      if (r1 == null) return null;
      const n = uid ? await db.prepare('SELECT COUNT(*) AS n FROM glicko_hist WHERE uid = ? AND pool = ? AND t <= ?').bind(uid, g.pool, g.ended).first() : null;
      return { r0: Math.round(r0), r1: Math.round(r1), d: Math.round(r1) - Math.round(r0), p: isProv(rd1 || 999, n ? n.n : 0), p0: rd0 == null ? null : isProv(rd0, n ? n.n - 1 : 0), n: n ? n.n : null };
    };
    return json({ ok: true, found: true, id: g.id, rated: !!g.rated, pool: g.pool, w: await side(g.wuid, g.wr0, g.wr1, g.wrd1, g.wrd0), b: await side(g.buid, g.br0, g.br1, g.brd1, g.brd0) });
  }

  // everything below needs a signed-in user
  const u = await sessUser(db, q('s'));
  if (!u) return err('signed_out', 'Please sign in again.', 401);

  if (path === 'me') {
    await db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now, u.id).run();
    if (q('lite')) return json({ ok: true, user: { ...me(u), ratings: await ratingsOf(db, u.id) } });
    await attachDevice(db, u.id, q('dev'));
    return json({ ok: true, user: { ...me(u), ratings: await ratingsOf(db, u.id) }, profile: await profileOf(db, u, true) });
  }
  if (path === 'logout' && req.method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE tok = ?').bind(String(b.s)).run();
    return json({ ok: true });
  }
  if (path === 'update' && req.method === 'POST') {
    const sets = [], vals = [];
    if (b.display !== undefined) { const d = cleanDisplay(b.display); if (!d) return err('bad_display', 'Type a name to show.'); sets.push('display = ?'); vals.push(d); }
    if (b.email !== undefined) { const e = String(b.email || '').trim().slice(0, 120); if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return err('bad_email', 'That email does not look right.'); sets.push('email = ?'); vals.push(e || null); }
    if (b.newPassword !== undefined) {
      if (u.pw && !(await checkPw(String(b.oldPassword || ''), u.pw))) return err('bad_login', 'Your current password is not right.', 401);
      if (String(b.newPassword).length < 4) return err('bad_password', 'Use at least 4 characters.');
      sets.push('pw = ?'); vals.push(await hashPw(String(b.newPassword)));
    }
    if (b.puzzle && typeof b.puzzle === 'object') { sets.push('puzzle = ?'); vals.push(JSON.stringify(b.puzzle).slice(0, 60000)); }
    if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, u.id).run();
    const nu = await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
    return json({ ok: true, user: me(nu) });
  }
  if (path === 'recovery' && req.method === 'POST') {
    return json({ ok: true, recovery: await makeRecovery(db, u.id) });
  }
  if (path === 'games' && req.method === 'GET') {
    const before = +q('before') || 9e15;
    const rows = await db.prepare('SELECT * FROM games WHERE (wuid = ?1 OR buid = ?1) AND ended < ?2 ORDER BY ended DESC LIMIT 30').bind(u.id, before).all();
    return json({ ok: true, games: (rows.results || []).map((g) => gameOut(g, u.id)) });
  }
  // a finished game played on this phone (vs computer / 2 players): kept in the account's history, unrated
  if (path === 'savegame' && req.method === 'POST') {
    const moves = String(b.moves || '').trim();
    if (!/^([a-h][1-8][a-h][1-8][qrbn]?)( [a-h][1-8][a-h][1-8][qrbn]?)*$/.test(moves) || moves.length > 4000) return err('bad_game', 'That game could not be saved.');
    const c = new Chess(); for (const m of moves.split(' ')) { try { if (!c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined })) return err('bad_game', 'Illegal move in game.'); } catch (e) { return err('bad_game', 'Illegal move in game.'); } }
    const color = b.color === 'b' ? 'b' : 'w';
    const res = ['1-0', '0-1', '1/2-1/2', '*'].includes(b.result) ? b.result : '*';
    const rk = 'local:' + u.id + ':' + String(b.key || '').slice(0, 40);
    const opp = cleanDisplay(b.opp) || 'Opponent';
    const source = b.source === 'pvp' ? 'pvp' : 'ai';
    await db.prepare(`INSERT OR IGNORE INTO games (rk, wuid, buid, wname, bname, moves, result, reason, tc, source, rated, ended) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .bind(rk, color === 'w' ? u.id : null, color === 'b' ? u.id : null, color === 'w' ? u.display : opp, color === 'b' ? u.display : opp, moves, res, String(b.reason || '').slice(0, 20), String(b.tc || 'none').slice(0, 8), source, now).run();
    return json({ ok: true });
  }
  if (path === 'progress' && req.method === 'POST') {
    // streaks + achievements: merge what this device has with what the account has, store and return the union
    const cur = u.prog ? JSON.parse(u.prog) : null;
    const merged = mergeProg(cur, b.prog && typeof b.prog === 'object' ? b.prog : null);
    const out = JSON.stringify(merged);
    if (out.length < 30000) await db.prepare('UPDATE users SET prog = ? WHERE id = ?').bind(out, u.id).run();
    return json({ ok: true, prog: merged });
  }
  if (path === 'delete' && req.method === 'POST') {
    if (u.pw && !(await checkPw(String(b.password || ''), u.pw))) return err('bad_login', 'Your password is not right.', 401);
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE uid = ?').bind(u.id), db.prepare('DELETE FROM devices WHERE uid = ?').bind(u.id),
      db.prepare('DELETE FROM friends WHERE a = ?1 OR b = ?1').bind(u.id), db.prepare('DELETE FROM challenges WHERE from_uid = ?1 OR to_uid = ?1').bind(u.id),
      db.prepare('DELETE FROM seeks WHERE uid = ?').bind(u.id), db.prepare('DELETE FROM games WHERE wuid = ?1 OR buid = ?1').bind(u.id),
      db.prepare('DELETE FROM rush WHERE uid = ?').bind(u.id), db.prepare('DELETE FROM pulse WHERE uid = ?').bind(u.id),
      db.prepare('DELETE FROM glicko WHERE uid = ?').bind(u.id), db.prepare('DELETE FROM glicko_hist WHERE uid = ?').bind(u.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(u.id),
    ]);
    await deleteOwner(db, u.id);
    return json({ ok: true });
  }
  return null; // handled by friends/quick
}

// union of two progress records: days (IST dates), achievements (earliest unlock), counters (max)
export function mergeProg(a, b) {
  const A = a || {}, B = b || {};
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const days = [...new Set([...(Array.isArray(A.days) ? A.days : []), ...(Array.isArray(B.days) ? B.days : [])].filter((d) => day.test(String(d))))].sort().slice(-400);
  const ach = {};
  for (const src of [A.ach, B.ach]) if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) {
    if (!/^[a-z0-9_]{1,24}$/.test(k) || !(+v > 0)) continue;
    ach[k] = ach[k] ? Math.min(ach[k], +v) : +v;
  }
  const c = {};
  for (const src of [A.c, B.c]) if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) {
    if (!/^[a-zA-Z0-9_]{1,24}$/.test(k) || !Number.isFinite(+v)) continue;
    c[k] = Math.max(c[k] || 0, Math.min(1e6, +v));
  }
  return { v: 1, days, ach, c, best: Math.max(+A.best || 0, +B.best || 0) };
}

/* ================= Puzzle Rush leaderboard ================= */
export async function rApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body } = ctx;
  await uSchema(db);
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => (b[k] !== undefined ? b[k] : url.searchParams.get(k));
  const now = Date.now();
  const dev = /^[a-f0-9]{32}$/.test(String(q('dev') || '')) ? String(q('dev')) : null;
  const u = await sessUser(db, q('s'));
  const today = new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (path === 'submit' && req.method === 'POST') {
    const score = Math.floor(+b.score);
    if (!Number.isFinite(score) || score < 0 || score > 120) return err('bad_score', 'That score does not look right.');
    if (!u && !dev) return err('no_dev', 'No player id.');
    const key = 'rs:' + (u ? 'u' + u.id : dev);
    if (await throttled(db, key, 40, 3600e3)) return err('slow_down', 'Take a breather and try again later.', 429);
    await bump(db, key, 3600e3);
    if (score > 0) {
      const name = u ? u.display : (cleanDisplay(b.name) || 'Guest');
      await db.prepare('INSERT INTO rush (uid, dev, name, score, day, t) VALUES (?, ?, ?, ?, ?, ?)').bind(u ? u.id : null, u ? null : dev, name, score, today, now).run();
    }
  }
  if (path === 'forget' && req.method === 'POST') {
    // a device can wipe its own guest scores (only the holder of the token can)
    if (dev) await db.prepare('DELETE FROM rush WHERE dev = ?').bind(dev).run();
    return json({ ok: true });
  }
  if (path === 'submit' || path === 'top') {
    const who = 'COALESCE(\'u\' || uid, dev)';
    const top = async (where, args) => {
      const r = await db.prepare(`SELECT ${who} AS who, MAX(score) AS score, MAX(name) AS name, MIN(t) AS t FROM rush WHERE ${where} GROUP BY who ORDER BY score DESC, t ASC LIMIT 20`).bind(...args).all();
      const me = u ? 'u' + u.id : dev;
      return (r.results || []).map((x, i) => ({ rank: i + 1, name: x.name, score: x.score, you: !!me && x.who === me }));
    };
    const mine = u ? await db.prepare('SELECT MAX(score) AS s FROM rush WHERE uid = ?').bind(u.id).first()
      : dev ? await db.prepare('SELECT MAX(score) AS s FROM rush WHERE dev = ?').bind(dev).first() : null;
    return json({ ok: true, day: today, today: await top('day = ?', [today]), all: await top('1 = 1', []), best: mine && mine.s ? mine.s : 0 });
  }
  return err('not_found', 'No such endpoint.', 404);
}

function gameOut(g, uid) {
  const color = uid ? (g.wuid === uid ? 'w' : 'b') : null;
  return { id: g.id, white: g.wname, black: g.bname, wuid: g.wuid, buid: g.buid, moves: g.moves, result: g.result, reason: g.reason, tc: g.tc,
    source: g.source, rated: !!g.rated, wr: g.wr1 != null ? Math.round(g.wr1) : null, br: g.br1 != null ? Math.round(g.br1) : null,
    dw: g.wr1 != null ? Math.round(g.wr1 - g.wr0) : null, db: g.br1 != null ? Math.round(g.br1 - g.br0) : null, ended: g.ended, color };
}

async function profileOf(db, u, mine = false) {
  // v1.9: the newest 3000 points (it read the oldest 1200 before), up to 1000 per pool; each point carries p = provisional
  const hist = await db.prepare('SELECT pool, r, rd, t FROM glicko_hist WHERE uid = ? ORDER BY t DESC, id DESC LIMIT 3000').bind(u.id).all();
  const rowsAsc = (hist.results || []).slice().reverse();
  const ratings = await ratingsOf(db, u.id);
  const graphs = {};
  for (const p of POOLS) graphs[p] = [{ t: u.created, r: G2.r0, p: 1 }, ...rowsAsc.filter((x) => x.pool === p).map((x, i) => ({ t: x.t, r: Math.round(x.r), p: isProv(x.rd, i + 1) ? 1 : 0 })).slice(-1000)];
  // the main pool: most rated games; Blitz first on a tie (it was the default before Bullet existed)
  const main = ['blitz', 'rapid', 'bullet'].filter((p) => POOLS.includes(p)).sort((x, y) => ratings[y].n - ratings[x].n)[0];
  const recent = await db.prepare('SELECT * FROM games WHERE wuid = ?1 OR buid = ?1 ORDER BY ended DESC LIMIT 12').bind(u.id).all();
  const all = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN (wuid = ?1 AND result = '1-0') OR (buid = ?1 AND result = '0-1') THEN 1 ELSE 0 END) AS w,
    SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) AS d FROM games WHERE (wuid = ?1 OR buid = ?1) AND result != '*'`).bind(u.id).first();
  const tour = await db.prepare('SELECT MAX(r.rating) AS rating, SUM(r.games) AS games, SUM(r.w) AS w, SUM(r.d) AS d, SUM(r.l) AS l FROM ratings r JOIN devices v ON v.tok = r.tok WHERE v.uid = ?').bind(u.id).first().catch(() => null);
  const n = all ? all.n || 0 : 0, w = all ? all.w || 0 : 0, d = all ? all.d || 0 : 0;
  const pz = u.puzzle ? JSON.parse(u.puzzle) : null;
  return {
    uname: u.uname, display: u.display, created: u.created, online: Date.now() - u.seen < ONLINE_WINDOW, cos: cosOf(u),
    rating: ratings[main].r, ratingP: ratings[main].p, main, ratings, graphs, rated: { games: POOLS.reduce((s, p) => s + ratings[p].n, 0), w: u.w, d: u.d, l: u.l },
    graph: graphs[main],
    totals: { games: n, w, d, l: n - w - d, winPct: n ? Math.round((w / n) * 100) : 0 },
    puzzle: pz ? { r: Math.round(pz.r), n: pz.n || 0, won: pz.won || 0, streak: pz.streak || 0, best: Math.round(pz.best || pz.r) } : null,
    tournament: tour && tour.games ? { rating: Math.round(tour.rating), games: tour.games, w: tour.w, d: tour.d, l: tour.l } : null,
    recent: (recent.results || []).map((g) => gameOut(g, u.id)),
    prog: (() => { try { const p = u.prog ? JSON.parse(u.prog) : null; return p ? { ach: p.ach || {}, days: (p.days || []).slice(-60), best: p.best || 0, c: { rushBest: (p.c || {}).rushBest || 0 } } : null; } catch (e) { return null; } })(),
  };
}


/* ================= quick match ================= */
async function tryPair(db, seek, makeRoom, now) {
  const waited = (now - seek.created) / 1000;
  const myWin = waited > 25 ? 9999 : 120 + waited * 18;
  const rows = await db.prepare('SELECT * FROM seeks WHERE room IS NULL AND id != ?1 AND tc = ?2 AND seen > ?3 ORDER BY created LIMIT 30')
    .bind(seek.id, seek.tc, now - SEEK_ALIVE).all();
  for (const o of rows.results || []) {
    if (seek.uid && o.uid === seek.uid) continue;
    const ow = (now - o.created) / 1000; const oWin = ow > 25 ? 9999 : 120 + ow * 18;
    if (Math.abs(o.rating - seek.rating) > Math.max(myWin, oWin)) continue;
    const claim = 'pending:' + seek.id;
    const c = await db.prepare('UPDATE seeks SET room = ?1 WHERE id IN (?2, ?3) AND room IS NULL').bind(claim, seek.id, o.id).run();
    if (!c.meta || c.meta.changes !== 2) { await db.prepare('UPDATE seeks SET room = NULL WHERE room = ?').bind(claim).run(); return null; }
    const meW = crypto.getRandomValues(new Uint8Array(1))[0] & 1;
    const A = { tok: randHex(16), name: seek.name || 'Guest', uid: seek.uid || null };
    const B = { tok: randHex(16), name: o.name || 'Guest', uid: o.uid || null };
    const seats = meW ? { w: A, b: B } : { w: B, b: A };
    const code = await makeRoom(db, seek.tc, seats, { quick: true, rt: await roomRatings(db, seek.tc, seats) });
    await db.batch([
      db.prepare('UPDATE seeks SET room = ?, seat = ?, color = ? WHERE id = ?').bind(code, A.tok, meW ? 'w' : 'b', seek.id),
      db.prepare('UPDATE seeks SET room = ?, seat = ?, color = ? WHERE id = ?').bind(code, B.tok, meW ? 'b' : 'w', o.id),
    ]);
    return { code, seat: A.tok, color: meW ? 'w' : 'b' };
  }
  return null;
}
async function onlineCount(db, now) {
  const a = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE seen > ?').bind(now - ONLINE_WINDOW).first();
  const b = await db.prepare('SELECT COUNT(*) AS n FROM seeks WHERE uid IS NULL AND seen > ?').bind(now - SEEK_ALIVE).first();
  return (a ? a.n : 0) + (b ? b.n : 0);
}
export async function qApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body, makeRoom, TCS } = ctx;
  await uSchema(db);
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => (b[k] !== undefined ? b[k] : url.searchParams.get(k));
  const now = Date.now();
  if (Math.random() < 0.05) await db.prepare('DELETE FROM seeks WHERE seen < ?').bind(now - 3600e3).run();
  if (path === 'seek' && req.method === 'POST') {
    const tc = Object.prototype.hasOwnProperty.call(TCS, b.tc) && b.tc !== 'none' ? b.tc : '5+0';
    const u = await sessUser(db, b.s);
    if (u) await db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now, u.id).run();
    const id = randHex(12);
    const name = u ? u.display : (cleanDisplay(b.name) || 'Guest');
    const myR = u ? await getRating(db, u.id, poolOf(tc)) : null;
    const seek = { id, uid: u ? u.id : null, name, rating: myR ? myR.r : RATING_START, tc, created: now, seen: now };
    if (u) await db.prepare('DELETE FROM seeks WHERE uid = ? AND room IS NULL').bind(u.id).run();
    await db.prepare('INSERT INTO seeks (id, uid, name, rating, tc, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, seek.uid, name, seek.rating, tc, now, now).run();
    const m = await tryPair(db, seek, makeRoom, now);
    return json({ ok: true, id, tc, rated: !!u, rating: Math.round(seek.rating), prov: myR ? isProv(myR.rd, myR.n) : true, matched: m, online: await onlineCount(db, now) });
  }
  if (path === 'poll' && req.method === 'GET') {
    // long-poll: held up to `hold` ms (max 8 s), re-reading the seek every 350 ms and trying to pair every ~2 s,
    // so both players hear about a match within a fraction of a second
    const id = String(q('id') || '');
    const hold = Math.max(0, Math.min(8000, +q('hold') || 0));
    const deadline = now + hold;
    let lastPair = 0, lastSeen = 0, first = true;
    for (;;) {
      const t = Date.now();
      const seek = await db.prepare('SELECT * FROM seeks WHERE id = ?').bind(id).first();
      if (!seek) return hold ? json({ ok: true, gone: true }) : err('no_seek', 'The search ended. Tap Play again.', 404); // cancelled while held: not an error
      if (seek.room && !seek.room.startsWith('pending:')) return json({ ok: true, matched: { code: seek.room, seat: seek.seat, color: seek.color } });
      if (t - lastSeen > 2500) {
        lastSeen = t;
        await db.prepare('UPDATE seeks SET seen = ? WHERE id = ?').bind(t, id).run();
        if (seek.uid) await db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(t, seek.uid).run();
      }
      if (!seek.room && t - lastPair > 1800) {
        lastPair = t;
        const m = await tryPair(db, seek, makeRoom, t);
        if (m) return json({ ok: true, matched: m });
      }
      if (!first && Date.now() >= deadline) return json({ ok: true, matched: null, waited: Math.round((Date.now() - seek.created) / 1000), online: await onlineCount(db, Date.now()) });
      first = false;
      if (Date.now() >= deadline) return json({ ok: true, matched: null, waited: Math.round((Date.now() - seek.created) / 1000), online: await onlineCount(db, Date.now()) });
      await sleep(350);
    }
  }
  if (path === 'cancel' && req.method === 'POST') {
    await db.prepare('DELETE FROM seeks WHERE id = ? AND room IS NULL').bind(String(b.id || '')).run();
    return json({ ok: true });
  }
  return err('not_found', 'No such endpoint.', 404);
}

/* ================= friends + challenges ================= */
export async function fApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body, makeRoom, TCS } = ctx;
  await uSchema(db);
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => (b[k] !== undefined ? b[k] : url.searchParams.get(k));
  const now = Date.now();
  const u = await sessUser(db, q('s'));
  if (!u) return err('signed_out', 'Sign in to use friends.', 401);
  const wasAway = now - (u.seen || 0) >= ONLINE_WINDOW;
  await db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now, u.id).run();
  if (wasAway) await pulseFriends(db, u.id); // friends see the green dot right away
  const otherId = async () => {
    if (b.uid) return +b.uid;
    const o = await db.prepare('SELECT id FROM users WHERE uname = ?').bind(String(b.uname || '').toLowerCase()).first();
    return o ? o.id : null;
  };
  const state = async (t) => {
    const rows = await db.prepare(`SELECT f.a, f.b, f.state, u.id, u.uname, u.display, u.rating, u.seen FROM friends f JOIN users u ON u.id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END
      WHERE f.a = ?1 OR f.b = ?1`).bind(u.id).all();
    const list = (rows.results || []).map((r) => ({ id: r.id, uname: r.uname, display: r.display, rating: Math.round(r.rating), online: Date.now() - r.seen < ONLINE_WINDOW,
      state: r.state === 'friends' ? 'friends' : r.a === u.id ? 'sent' : 'incoming' }));
    const ch = await db.prepare(`SELECT c.*, uf.display AS fname, ut.display AS tname FROM challenges c JOIN users uf ON uf.id = c.from_uid JOIN users ut ON ut.id = c.to_uid
      WHERE (c.to_uid = ?1 OR c.from_uid = ?1) AND c.created > ?2 AND c.state IN ('pending', 'accepted', 'declined') ORDER BY c.created DESC LIMIT 20`).bind(u.id, Date.now() - 10 * 60e3).all();
    const challenges = (ch.results || []).map((c) => ({ id: c.id, tc: c.tc, color: c.color, state: c.state, mine: c.from_uid === u.id, rated: !!c.rated,
      from: c.fname, to: c.tname, room: c.state === 'accepted' ? c.room : null, seat: c.state === 'accepted' ? (c.from_uid === u.id ? c.from_seat : c.to_seat) : null, created: c.created }));
    return { ok: true, friends: list, challenges, v: t };
  };
  if (path === 'list' || path === 'ping') return json(await state(await pulseOf(db, u.id)));
  if (path === 'wait') {
    // long-poll: returns the moment a friend request, challenge or friend's presence changes (or after `hold` ms)
    const since = +q('v') || 0;
    const hold = Math.max(0, Math.min(25000, +q('hold') || 20000));
    const deadline = now + hold;
    let v = await pulseOf(db, u.id), lastSeen = now;
    while (v === since && Date.now() < deadline) {
      await sleep(600);
      v = await pulseOf(db, u.id);
      if (Date.now() - lastSeen > 30000) { lastSeen = Date.now(); await db.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(lastSeen, u.id).run(); }
    }
    return json(await state(v));
  }
  if (path === 'request' && req.method === 'POST') {
    const o = await otherId();
    if (!o) return err('no_user', 'No player with that username.', 404);
    if (o === u.id) return err('self', 'That is you!');
    const rev = await db.prepare('SELECT * FROM friends WHERE a = ? AND b = ?').bind(o, u.id).first();
    if (rev) { await db.prepare("UPDATE friends SET state = 'friends', at = ? WHERE a = ? AND b = ?").bind(now, o, u.id).run(); await pulse(db, o, u.id); return json({ ok: true, state: 'friends' }); }
    const n = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE a = ? AND state = ? AND at > ?').bind(u.id, 'pending', now - 3600e3).first();
    if (n && n.n > 30) return err('slow_down', 'Too many friend requests. Try later.', 429);
    await db.prepare('INSERT OR IGNORE INTO friends (a, b, state, at) VALUES (?, ?, ?, ?)').bind(u.id, o, 'pending', now).run();
    await pulse(db, o, u.id);
    return json({ ok: true, state: 'sent' });
  }
  if (path === 'accept' && req.method === 'POST') {
    const o = await otherId();
    await db.prepare("UPDATE friends SET state = 'friends', at = ? WHERE a = ? AND b = ?").bind(now, o, u.id).run();
    await pulse(db, o, u.id);
    return json({ ok: true });
  }
  if (path === 'remove' && req.method === 'POST') {
    const o = await otherId();
    await db.prepare('DELETE FROM friends WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(u.id, o).run();
    await pulse(db, o, u.id);
    return json({ ok: true });
  }
  if (path === 'challenge' && req.method === 'POST') {
    const o = await otherId();
    const fr = await db.prepare("SELECT 1 FROM friends WHERE ((a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)) AND state = 'friends'").bind(u.id, o).first();
    if (!fr) return err('not_friends', 'You can challenge friends only.', 403);
    const tc = Object.prototype.hasOwnProperty.call(TCS, b.tc) ? b.tc : '10+0';
    const color = ['w', 'b'].includes(b.color) ? b.color : 'r';
    await db.prepare("UPDATE challenges SET state = 'cancelled' WHERE from_uid = ? AND to_uid = ? AND state = 'pending'").bind(u.id, o).run();
    const id = randHex(10);
    const rated = b.rated && poolOf(tc) ? 1 : 0;
    await db.prepare('INSERT INTO challenges (id, from_uid, to_uid, tc, color, state, created, rated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, u.id, o, tc, color, 'pending', now, rated).run();
    await pulse(db, o, u.id);
    return json({ ok: true, id });
  }
  if (path === 'answer' && req.method === 'POST') {
    const c = await db.prepare('SELECT * FROM challenges WHERE id = ?').bind(String(b.id || '')).first();
    if (!c || c.state !== 'pending') return err('gone', 'That challenge is no longer open.', 409);
    const cancel = c.from_uid === u.id;
    if (c.to_uid !== u.id && !cancel) return err('not_yours', 'Not your challenge.', 403);
    if (cancel || !b.accept) { await db.prepare('UPDATE challenges SET state = ? WHERE id = ?').bind(cancel ? 'cancelled' : 'declined', c.id).run(); await pulse(db, c.from_uid, c.to_uid); return json({ ok: true }); }
    const from = await db.prepare('SELECT id, display FROM users WHERE id = ?').bind(c.from_uid).first();
    const fw = c.color === 'w' ? true : c.color === 'b' ? false : !!(crypto.getRandomValues(new Uint8Array(1))[0] & 1);
    const F = { tok: randHex(16), name: from.display, uid: from.id }, T = { tok: randHex(16), name: u.display, uid: u.id };
    const seats = fw ? { w: F, b: T } : { w: T, b: F };
    const code = await makeRoom(db, c.tc, seats, c.rated ? { friendly: true, rated: true, rt: await roomRatings(db, c.tc, seats) } : { friendly: true });
    const r = await db.prepare("UPDATE challenges SET state = 'accepted', room = ?, from_seat = ?, to_seat = ? WHERE id = ? AND state = 'pending'").bind(code, F.tok, T.tok, c.id).run();
    if (!r.meta || r.meta.changes !== 1) return err('gone', 'That challenge is no longer open.', 409);
    await pulse(db, c.from_uid, c.to_uid);
    return json({ ok: true, room: code, seat: T.tok });
  }
  return err('not_found', 'No such endpoint.', 404);
}
