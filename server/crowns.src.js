// v1.8 Crowns 👑 wallet: a ledger of every earn and spend, per owner ('u:<account id>' or 'd:<guest phone id>').
// The balance is the sum of the owner's ledger rows. Every reward is decided here, never by the app:
// one reward per ref (UNIQUE owner+kind+ref), daily caps as numbered slots, rate limits, and checks against real games/lessons/puzzles.
import { Chess } from '../site/vendor/chess.js';
import { EARN, ITEMS, itemById, stockOf, PACKS, FREE_REVIEWS_PER_DAY, FREEZE_MAX, LEVEL_ELO, BOT_ELO, botWinCrowns, isPremium } from '../site/crowns-data.js';
import { CHAPTERS } from '../site/learn-data.js';

const LESSONS = new Set(CHAPTERS.flatMap((c) => c.lessons.map((l) => l.id)));
const DAY = 864e5;
export const istDay = (t = Date.now()) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const prevDay = (d, n = 1) => new Date(Date.parse(d + 'T12:00:00Z') - n * DAY).toISOString().slice(0, 10);
const DEV_RE = /^[a-f0-9]{32}$/;

let ready = false;
export async function cSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS crown_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, amt INTEGER NOT NULL, kind TEXT NOT NULL,
      ref TEXT NOT NULL, note TEXT, day TEXT NOT NULL, t INTEGER NOT NULL, UNIQUE (owner, kind, ref))`),
    db.prepare('CREATE INDEX IF NOT EXISTS crown_ledger_o ON crown_ledger (owner, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS crown_ledger_d ON crown_ledger (owner, kind, day)'),
    // owned items; n counts consumables (stock rows 'tickets', 'freeze')
    db.prepare('CREATE TABLE IF NOT EXISTS crown_items (owner TEXT NOT NULL, item TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, src TEXT, t INTEGER NOT NULL, PRIMARY KEY (owner, item))'),
    db.prepare('CREATE TABLE IF NOT EXISTS crown_init (owner TEXT PRIMARY KEY, t INTEGER NOT NULL, kind TEXT)'),
    // days with a checked activity (game, lesson, daily puzzle) or a used streak freeze ('freeze'); India days
    db.prepare('CREATE TABLE IF NOT EXISTS crown_days (owner TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (owner, day))'),
    db.prepare('CREATE TABLE IF NOT EXISTS crown_seen (owner TEXT NOT NULL, h TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (owner, h))'),
    db.prepare('CREATE TABLE IF NOT EXISTS crown_reviews (owner TEXT NOT NULL, day TEXT NOT NULL, k TEXT NOT NULL, how TEXT NOT NULL, PRIMARY KEY (owner, day, k))'),
    db.prepare('CREATE TABLE IF NOT EXISTS crown_rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, t INTEGER NOT NULL)'),
    // the moment Crowns went live on this database: accounts made before it are "existing players"
    db.prepare("INSERT OR IGNORE INTO kmeta (k, v, t) VALUES ('crowns_launch', ?1, ?1)").bind(String(Date.now())),
  ]);
  try { await db.prepare('ALTER TABLE users ADD COLUMN cos TEXT').run(); } catch (e) { /* already there */ }
  ready = true;
}
async function launchAt(db) {
  const r = await db.prepare("SELECT v FROM kmeta WHERE k = 'crowns_launch'").first();
  return r ? +r.v : Date.now();
}

/* ---------------- ledger primitives ---------------- */
export async function balance(db, owner) {
  const r = await db.prepare('SELECT COALESCE(SUM(amt), 0) AS b FROM crown_ledger WHERE owner = ?').bind(owner).first();
  return r ? r.b : 0;
}
// add one ledger row; false when that (kind, ref) was already paid to this owner
async function credit(db, owner, amt, kind, ref, note, now = Date.now()) {
  const r = await db.prepare('INSERT OR IGNORE INTO crown_ledger (owner, amt, kind, ref, note, day, t) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(owner, amt, kind, String(ref).slice(0, 80), note ? String(note).slice(0, 120) : null, istDay(now), now).run();
  return !!(r.meta && r.meta.changes === 1);
}
// a capped daily reward: refs are "<day>#<slot>", so parallel requests cannot pass the cap
async function creditCapped(db, owner, amt, kind, cap, note, now = Date.now()) {
  const day = istDay(now);
  const c = await db.prepare('SELECT COUNT(*) AS n FROM crown_ledger WHERE owner = ? AND kind = ? AND day = ?').bind(owner, kind, day).first();
  for (let slot = (c ? c.n : 0) + 1; slot <= cap; slot++) {
    if (await credit(db, owner, amt, kind, `${day}#${slot}`, note, now)) return true;
  }
  return false;
}
async function rate(db, key, limit, windowMs) {
  const now = Date.now();
  const r = await db.prepare('SELECT n, t FROM crown_rate WHERE k = ?').bind(key).first();
  if (r && now - r.t <= windowMs && r.n >= limit) return false;
  await db.prepare('INSERT INTO crown_rate (k, n, t) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN ?2 - t > ?3 THEN 1 ELSE n + 1 END, t = CASE WHEN ?2 - t > ?3 THEN ?2 ELSE t END')
    .bind(key, now, windowMs).run();
  return true;
}
async function markDay(db, owner, kind, now = Date.now()) {
  await db.prepare('INSERT OR IGNORE INTO crown_days (owner, day, kind) VALUES (?, ?, ?)').bind(owner, istDay(now), kind).run();
}
async function stock(db, owner, item) {
  const r = await db.prepare('SELECT n FROM crown_items WHERE owner = ? AND item = ?').bind(owner, item).first();
  return r ? r.n : 0;
}

/* ---------------- owners ---------------- */
// who is asking: a signed-in account (session) or a guest phone (dev id)
export async function ownerOf(db, sessUser, q) {
  const s = q('s');
  if (s) { const u = await sessUser(db, s); if (!u) return { error: 'signed_out' }; return { owner: 'u:' + u.id, u }; }
  const dev = String(q('dev') || '');
  if (DEV_RE.test(dev)) return { owner: 'd:' + dev, u: null, dev };
  return { error: 'no_owner' };
}
// first time we see an owner: the welcome gift (exactly once), and for accounts that existed before Crowns,
// everything that was free before v1.8 stays unlocked, and their streak days so far count.
export async function ensureOwner(db, owner, u) {
  const now = Date.now();
  const ins = await db.prepare('INSERT OR IGNORE INTO crown_init (owner, t, kind) VALUES (?, ?, ?)').bind(owner, now, u ? 'account' : 'guest').run();
  if (!ins.meta || ins.meta.changes !== 1) return false;
  if (!u) return true;
  const launch = await launchAt(db);
  const existing = u.created < launch;
  await credit(db, owner, existing ? EARN.welcomeExisting : EARN.welcomeNew, 'welcome', 'welcome', existing ? 'Welcome gift for existing players' : 'Welcome gift', now);
  if (existing) {
    const st = [];
    for (const it of ITEMS) if (it.legacy) st.push(db.prepare("INSERT OR IGNORE INTO crown_items (owner, item, n, src, t) VALUES (?, ?, 1, 'legacy', ?)").bind(owner, it.id, now));
    let days = [];
    try { const p = u.prog ? JSON.parse(u.prog) : null; days = (p && Array.isArray(p.days) ? p.days : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= istDay(launch)).slice(-60); } catch (e) {}
    for (const d of days) st.push(db.prepare("INSERT OR IGNORE INTO crown_days (owner, day, kind) VALUES (?, ?, 'old')").bind(owner, d));
    if (st.length) await db.batch(st);
  }
  return true;
}
// a guest phone signs in: its Crowns (up to a cap), items and one-time rewards move into the account, once per phone
export async function mergeGuest(db, uid, dev) {
  if (!DEV_RE.test(String(dev || ''))) return 0;
  await cSchema(db);
  const from = 'd:' + dev, to = 'u:' + uid;
  const has = await db.prepare('SELECT COUNT(*) AS n FROM crown_ledger WHERE owner = ?').bind(from).first();
  const items = await db.prepare('SELECT item, n FROM crown_items WHERE owner = ?').bind(from).all();
  if ((!has || !has.n) && !(items.results || []).length) return 0;
  const bal = await balance(db, from);
  const moved = Math.max(0, Math.min(bal, EARN.guestMergeMax));
  const now = Date.now();
  // the guest wallet goes to zero first (one row per account it moved into, so this cannot run twice for one account)
  if (bal > 0 && !(await credit(db, from, -bal, 'moved', to, 'Moved to your account', now))) return 0;
  if (moved > 0) await credit(db, to, moved, 'guest', dev, 'Crowns earned on this phone before signing in', now);
  const st = [];
  for (const r of items.results || []) {
    if (r.item === 'tickets' || r.item === 'freeze') st.push(db.prepare('INSERT INTO crown_items (owner, item, n, src, t) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner, item) DO UPDATE SET n = MIN(n + ?3, 99)').bind(to, r.item, r.n, 'guest', now));
    else st.push(db.prepare("INSERT OR IGNORE INTO crown_items (owner, item, n, src, t) VALUES (?, ?, 1, 'guest', ?)").bind(to, r.item, now));
  }
  st.push(db.prepare('DELETE FROM crown_items WHERE owner = ?').bind(from));
  // one-time rewards already paid on the phone are not paid again to the account (zero rows, hidden from history)
  st.push(db.prepare(`INSERT OR IGNORE INTO crown_ledger (owner, amt, kind, ref, note, day, t) SELECT ?1, 0, kind, ref, 'guest', day, t FROM crown_ledger
    WHERE owner = ?2 AND kind IN ('lesson', 'ach', 'daily', 'login', 'streak')`).bind(to, from));
  st.push(db.prepare("INSERT OR IGNORE INTO crown_days (owner, day, kind) SELECT ?1, day, kind FROM crown_days WHERE owner = ?2").bind(to, from));
  await db.batch(st);
  return moved;
}
export async function deleteOwner(db, uid) {
  await cSchema(db);
  const o = 'u:' + uid;
  await db.batch(['crown_ledger', 'crown_items', 'crown_init', 'crown_days', 'crown_seen', 'crown_reviews'].map((t) => db.prepare(`DELETE FROM ${t} WHERE owner = ?`).bind(o)));
}

/* ---------------- streaks ---------------- */
async function daysOf(db, owner) {
  const r = await db.prepare('SELECT day, kind FROM crown_days WHERE owner = ? ORDER BY day DESC LIMIT 400').bind(owner).all();
  return r.results || [];
}
// current run (ending today or yesterday) and the day it started
function runOf(days, today) {
  const set = new Set(days.map((x) => x.day));
  let d = set.has(today) ? today : set.has(prevDay(today)) ? prevDay(today) : null;
  let n = 0, start = null;
  while (d && set.has(d)) { n++; start = d; d = prevDay(d); }
  return { n, start };
}
// a missed day (or two, or three) is covered by streak freezes, if the player has enough; returns the days frozen
async function applyFreeze(db, owner, now = Date.now()) {
  const have = await stock(db, owner, 'freeze');
  if (have <= 0) return [];
  const days = await daysOf(db, owner);
  if (!days.length) return [];
  const today = istDay(now), set = new Set(days.map((x) => x.day));
  if (set.has(prevDay(today))) return [];
  let gap = 1; while (gap <= 3 && !set.has(prevDay(today, gap + 1))) gap++;
  if (gap > 3 || gap > have) return [];        // streak already broken for good, or not enough freezes
  const run = runOf(days, prevDay(today, gap));
  if (run.n < 1) return [];
  const fill = [...Array(gap)].map((_, i) => prevDay(today, i + 1));
  const r = await db.prepare('UPDATE crown_items SET n = n - ?1 WHERE owner = ?2 AND item = ?3 AND n >= ?1').bind(gap, owner, 'freeze').run();
  if (!r.meta || r.meta.changes !== 1) return [];
  await db.batch(fill.map((d) => db.prepare("INSERT OR IGNORE INTO crown_days (owner, day, kind) VALUES (?, ?, 'freeze')").bind(owner, d)));
  return fill;
}
async function streakRewards(db, owner, now = Date.now()) {
  const run = runOf(await daysOf(db, owner), istDay(now));
  const got = [];
  for (const [n, amt] of Object.entries(EARN.streak)) {
    if (run.n >= +n && (await credit(db, owner, amt, 'streak', `${n}:${run.start}`, `${n}-day streak`, now))) got.push({ amt, kind: 'streak', note: `${n}-day streak` });
  }
  return { got, run };
}
async function achieve(db, owner, id, now) {
  const amt = EARN.ach[id];
  const notes = { first_win: 'First win', first_online: 'First online game', first_share: 'First share' };
  return amt && (await credit(db, owner, amt, 'ach', id, notes[id], now)) ? [{ amt, kind: 'ach', note: notes[id] }] : [];
}

/* ---------------- rated online games (called by the game server when a room game is recorded) ---------------- */
export async function onlineGameCrowns(db, uid, score, rated, gid, now = Date.now()) {
  if (!uid) return;
  try {
    await cSchema(db);
    const owner = 'u:' + uid;
    await markDay(db, owner, 'online', now);
    if (rated) {
      const amt = EARN.online[score === 'w' ? 'win' : score === 'd' ? 'draw' : 'loss'];
      await creditCapped(db, owner, amt, 'online', EARN.onlinePerDay, `Rated game ${score === 'w' ? 'win' : score === 'd' ? 'draw' : 'played'} #${gid || ''}`, now);
    }
    await achieve(db, owner, 'first_online', now);
    if (score === 'w') await achieve(db, owner, 'first_win', now);
    await streakRewards(db, owner, now);
  } catch (e) { /* Crowns never break a game result */ }
}

/* ---------------- state for the app ---------------- */
async function stateOf(db, owner, u) {
  const day = istDay();
  const [bal, items, rev, today, days] = await Promise.all([
    balance(db, owner),
    db.prepare('SELECT item, n FROM crown_items WHERE owner = ?').bind(owner).all(),
    db.prepare("SELECT COUNT(*) AS n FROM crown_reviews WHERE owner = ? AND day = ? AND how = 'free'").bind(owner, day).first(),
    db.prepare("SELECT kind, COUNT(*) AS n, SUM(amt) AS a FROM crown_ledger WHERE owner = ? AND day = ? GROUP BY kind").bind(owner, day).all(),
    daysOf(db, owner),
  ]);
  const own = {}; let tickets = 0, freeze = 0;
  for (const r of items.results || []) { if (r.item === 'tickets') tickets = r.n; else if (r.item === 'freeze') freeze = r.n; else own[r.item] = 1; }
  const t = {}; for (const r of today.results || []) t[r.kind] = r.n;
  let cos = {}; try { cos = u && u.cos ? JSON.parse(u.cos) : {}; } catch (e) {}
  const run = runOf(days, day);
  return {
    ok: true, owner: owner[0] === 'u' ? 'account' : 'guest', bal, own, tickets, freeze, freezeMax: FREEZE_MAX, cos,
    reviews: { free: FREE_REVIEWS_PER_DAY, used: rev ? rev.n : 0 },
    today: { day, login: !!t.login, botWins: t.bot || 0, botWinsMax: EARN.botWinsPerDay, online: t.online || 0, onlineMax: EARN.onlinePerDay, lessons: t.lesson || 0, lessonsMax: EARN.lessonsPerDay, daily: !!t.daily },
    streak: { cur: run.n, frozen: days.filter((x) => x.kind === 'freeze').map((x) => x.day) },
    packs: PACKS, buy: PACKS.length > 0,
  };
}
const earnedOut = async (db, owner, got) => ({ ok: true, earned: got, bal: await balance(db, owner) });

/* ---------------- API: /api/c/... ---------------- */
export async function cApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body, sessUser } = ctx;
  await cSchema(db);
  const b = req.method === 'POST' ? await body(req) : {};
  const q = (k) => (b[k] !== undefined ? b[k] : url.searchParams.get(k));
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  const now = Date.now();

  if (path === 'catalog') return json({ ok: true, items: ITEMS, earn: EARN, freeReviews: FREE_REVIEWS_PER_DAY, packs: PACKS });

  const who = await ownerOf(db, sessUser, q);
  if (who.error === 'signed_out') return err('signed_out', 'Please sign in again.', 401);
  if (who.error) return err('no_owner', 'No player id.', 400);
  const { owner, u } = who;
  if (!(await rate(db, 'all:' + owner, 240, 60e3))) return err('slow_down', 'Too many requests. Wait a minute.', 429);
  if (!u && !(await rate(db, 'gnew:' + ip, 400, DAY))) return err('slow_down', 'Too many requests from this network.', 429);
  await ensureOwner(db, owner, u);
  // guest phones on one network share a daily earning cap, so making many phone ids does not mint Crowns
  const guestRoom = async () => !!u || (await rate(db, `gearn:${ip}:${istDay(now)}`, 30, DAY));

  if (path === 'state' && req.method === 'GET') return json(await stateOf(db, owner, u));

  if (path === 'history' && req.method === 'GET') {
    const before = +q('before') || 9e15;
    const r = await db.prepare('SELECT id, amt, kind, ref, note, t FROM crown_ledger WHERE owner = ? AND id < ? AND amt != 0 ORDER BY id DESC LIMIT 50').bind(owner, before).all();
    return json({ ok: true, bal: await balance(db, owner), list: r.results || [] });
  }

  // app opened: daily login bonus, streak freezes for missed days, streak milestones
  if (path === 'checkin' && req.method === 'POST') {
    const got = [];
    const frozen = await applyFreeze(db, owner, now);
    const had = await db.prepare("SELECT 1 FROM crown_ledger WHERE owner = ? AND kind = 'login' AND ref = ?").bind(owner, istDay(now)).first();
    if (!had && (await guestRoom()) && (await credit(db, owner, EARN.login, 'login', istDay(now), 'Daily login bonus', now))) got.push({ amt: EARN.login, kind: 'login', note: 'Daily login bonus' });
    const s = await streakRewards(db, owner, now); got.push(...s.got);
    return json({ ...(await stateOf(db, owner, u)), earned: got, frozenNow: frozen });
  }

  // a finished game on this phone (vs a bot / plain level, or 2 players): the server replays it
  if (path === 'game' && req.method === 'POST') {
    const moves = String(b.moves || '').trim();
    if (!/^([a-h][1-8][a-h][1-8][qrbn]?)( [a-h][1-8][a-h][1-8][qrbn]?)*$/.test(moves) || moves.length > 4000) return err('bad_game', 'That game could not be checked.');
    if (!(await rate(db, 'game:' + owner, 40, 3600e3))) return err('slow_down', 'Too many games sent. Wait a while.', 429);
    const c = new Chess(); const list = moves.split(' ');
    for (const m of list) { let ok = null; try { ok = c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined }); } catch (e) { ok = null; } if (!ok) return err('bad_game', 'Illegal move in game.'); }
    const h = moves.length + ':' + [...moves].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7).toString(36);
    const seen = await db.prepare('INSERT OR IGNORE INTO crown_seen (owner, h, t) VALUES (?, ?, ?)').bind(owner, h, now).run();
    if (!seen.meta || seen.meta.changes !== 1) return json({ ok: true, earned: [], dup: true, bal: await balance(db, owner) });
    const got = [];
    if (list.length >= 2) await markDay(db, owner, 'game', now);
    const color = b.color === 'b' ? 'b' : 'w';
    let why = null;
    if (b.mode === 'ai') {
      // a win counts when the game really ends in checkmate of the computer's king, after at least 5 moves of yours
      const mated = c.isCheckmate() && c.turn() !== color;
      const mine = Math.ceil(list.length / 2);
      let elo = 0;
      if (b.bot) { elo = BOT_ELO[b.bot] || 0; if (!elo) why = 'unknown_bot'; else if (isPremium('bot', b.bot) && !(await stock(db, owner, 'bot:' + b.bot))) why = 'locked_bot'; }
      else elo = LEVEL_ELO[Math.max(1, Math.min(10, Math.floor(+b.level) || 1))];
      if (!why && mated && mine >= 5) {
        if (!(await rate(db, 'botwin:' + owner, 1, 30e3))) why = 'too_fast';
        else if (!(await guestRoom())) why = 'guest_cap';
        else {
          const amt = botWinCrowns(elo);
          const label = b.bot ? `Win vs ${b.bot[0].toUpperCase() + b.bot.slice(1)}` : `Win vs computer level ${Math.floor(+b.level) || 1}`;
          if (await creditCapped(db, owner, amt, 'bot', EARN.botWinsPerDay, label, now)) got.push({ amt, kind: 'bot', note: label });
          else why = 'cap';
          got.push(...(await achieve(db, owner, 'first_win', now)));
        }
      } else if (!why) why = mated ? 'too_short' : 'not_mate';
    }
    got.push(...(await streakRewards(db, owner, now)).got);
    return json({ ...(await earnedOut(db, owner, got)), why });
  }

  // a Learn lesson finished the first time
  if (path === 'lesson' && req.method === 'POST') {
    const id = String(b.id || '');
    if (!LESSONS.has(id)) return err('bad_lesson', 'No such lesson.');
    const got = [];
    const done = await db.prepare("SELECT 1 FROM crown_ledger WHERE owner = ? AND kind = 'lesson' AND ref = ?").bind(owner, id).first();
    await markDay(db, owner, 'lesson', now);
    if (!done) {
      if (!(await rate(db, 'lesson:' + owner, 1, 15e3))) return err('slow_down', 'One lesson at a time 🙂', 429);
      const day = istDay(now);
      const c = await db.prepare("SELECT COUNT(*) AS n FROM crown_ledger WHERE owner = ? AND kind = 'lesson' AND day = ? AND amt > 0").bind(owner, day).first();
      if ((c ? c.n : 0) < EARN.lessonsPerDay && (await guestRoom()) && (await credit(db, owner, EARN.lesson, 'lesson', id, 'Lesson: ' + id, now))) got.push({ amt: EARN.lesson, kind: 'lesson', note: 'Lesson finished' });
    }
    got.push(...(await streakRewards(db, owner, now)).got);
    return json(await earnedOut(db, owner, got));
  }

  // today's Daily Puzzle, solved first try: the server checks the moves against the puzzle itself
  if (path === 'daily' && req.method === 'POST') {
    const date = String(b.date || '');
    const today = istDay(now);
    if (date !== today && !(date === prevDay(today) && now - Date.parse(today + 'T00:00:00+05:30') < 2 * 3600e3)) return err('bad_day', 'That is not today’s puzzle.');
    const pz = await dailyPuzzle(env, url, date);
    if (!pz) return err('busy', 'Could not check the puzzle, try again.', 503);
    const played = String(b.moves || '').trim().split(' ').filter(Boolean);
    if (!checkSolution(pz, played)) return err('bad_solution', 'That is not the solution.');
    const got = [];
    await markDay(db, owner, 'daily', now);
    if ((await guestRoom()) && (await credit(db, owner, EARN.daily, 'daily', date, 'Daily Puzzle ' + date, now))) got.push({ amt: EARN.daily, kind: 'daily', note: 'Daily Puzzle' });
    got.push(...(await streakRewards(db, owner, now)).got);
    return json(await earnedOut(db, owner, got));
  }

  // first share: the shared game must exist and come from this network in the last day
  if (path === 'shared' && req.method === 'POST') {
    const row = await db.prepare('SELECT ip, t FROM shares WHERE id = ?').bind(String(b.id || '').slice(0, 12)).first();
    if (!row || row.ip !== ip || now - row.t > DAY) return err('bad_share', 'Share not found.');
    return json(await earnedOut(db, owner, await achieve(db, owner, 'first_share', now)));
  }

  // buy an item: the price comes off in the same statement that checks the balance (no overspending, no double buy)
  if (path === 'buy' && req.method === 'POST') {
    const it = itemById(String(b.item || ''));
    if (!it) return err('no_item', 'That item is not in the shop.');
    if (!(await rate(db, 'buy:' + owner, 30, 3600e3))) return err('slow_down', 'Too many purchases. Wait a while.', 429);
    const st = stockOf(it);
    if (st === 'freeze' && (await stock(db, owner, 'freeze')) + it.n > FREEZE_MAX) return err('max', `You can hold up to ${FREEZE_MAX} streak freezes.`);
    if (!st && (await stock(db, owner, it.id))) return err('owned', 'You already own this.', 409);
    const ref = st ? it.id + ':' + now.toString(36) + Math.random().toString(36).slice(2, 7) : it.id;
    const res = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO crown_ledger (owner, amt, kind, ref, note, day, t) SELECT ?1, ?2, 'buy', ?3, ?4, ?5, ?6
        WHERE (SELECT COALESCE(SUM(amt), 0) FROM crown_ledger WHERE owner = ?1) >= ?7`).bind(owner, -it.price, ref, it.name[0], istDay(now), now, it.price),
      st ? db.prepare(`INSERT INTO crown_items (owner, item, n, src, t) SELECT ?1, ?2, ?3, 'buy', ?4 WHERE EXISTS (SELECT 1 FROM crown_ledger WHERE owner = ?1 AND kind = 'buy' AND ref = ?5)
             ON CONFLICT(owner, item) DO UPDATE SET n = n + ?3`).bind(owner, st, it.n, now, ref)
        : db.prepare(`INSERT OR IGNORE INTO crown_items (owner, item, n, src, t) SELECT ?1, ?2, 1, 'buy', ?3 WHERE EXISTS (SELECT 1 FROM crown_ledger WHERE owner = ?1 AND kind = 'buy' AND ref = ?4)`).bind(owner, it.id, now, ref),
    ]);
    if (!res[0].meta || res[0].meta.changes !== 1) {
      const bal = await balance(db, owner);
      return err('no_crowns', `Not enough Crowns: this costs ${it.price} 👑 and you have ${bal}.`, 402);
    }
    return json({ ...(await stateOf(db, owner, u)), bought: it.id });
  }

  // wear a frame / avatar (accounts: shown to others on the leaderboard and profile)
  if (path === 'equip' && req.method === 'POST') {
    if (!u) return err('signed_out', 'Sign in to wear a frame or avatar.', 401);
    const slot = b.slot === 'avatar' ? 'avatar' : b.slot === 'frame' ? 'frame' : null;
    if (!slot) return err('bad_slot', 'Nothing to wear there.');
    let cos = {}; try { cos = u.cos ? JSON.parse(u.cos) : {}; } catch (e) {}
    if (b.item) {
      const it = itemById(String(b.item));
      if (!it || it.type !== slot) return err('no_item', 'That item is not a ' + slot + '.');
      if (!(await stock(db, owner, it.id))) return err('not_owned', 'Buy it in the Shop first.', 403);
      cos[slot] = it.v;
    } else delete cos[slot];
    await db.prepare('UPDATE users SET cos = ? WHERE id = ?').bind(JSON.stringify(cos), u.id).run();
    return json({ ...(await stateOf(db, owner, { ...u, cos: JSON.stringify(cos) })) });
  }

  // a full Game Review: free ones per day, then review tickets; reopening a game already reviewed today is free
  if (path === 'review' && req.method === 'POST') {
    const k = String(b.key || '').replace(/[^A-Za-z0-9:_\-.|]/g, '').slice(0, 80);
    if (!k) return err('bad_key', 'Missing game.');
    const day = istDay(now);
    const again = await db.prepare('SELECT how FROM crown_reviews WHERE owner = ? AND day = ? AND k = ?').bind(owner, day, k).first();
    const out = async (allowed, how) => json({ ok: true, allowed, how, ...(await stateOf(db, owner, u)) });
    if (again) return out(true, 'again');
    const used = await db.prepare("SELECT COUNT(*) AS n FROM crown_reviews WHERE owner = ? AND day = ? AND how = 'free'").bind(owner, day).first();
    if ((used ? used.n : 0) < FREE_REVIEWS_PER_DAY) {
      const r = await db.prepare("INSERT OR IGNORE INTO crown_reviews (owner, day, k, how) SELECT ?1, ?2, ?3, 'free' WHERE (SELECT COUNT(*) FROM crown_reviews WHERE owner = ?1 AND day = ?2 AND how = 'free') < ?4")
        .bind(owner, day, k, FREE_REVIEWS_PER_DAY).run();
      if (r.meta && r.meta.changes === 1) return out(true, 'free');
    }
    if (!b.useTicket) return out(false, 'limit');
    const r = await db.prepare("UPDATE crown_items SET n = n - 1 WHERE owner = ? AND item = 'tickets' AND n >= 1").bind(owner).run();
    if (!r.meta || r.meta.changes !== 1) return out(false, 'no_ticket');
    await db.prepare("INSERT OR IGNORE INTO crown_reviews (owner, day, k, how) VALUES (?, ?, ?, 'ticket')").bind(owner, day, k).run();
    return out(true, 'ticket');
  }
  return null;
}

/* ---------------- daily puzzle check (same choice as the app's puzzles.js) ---------------- */
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const pzCache = {};
async function asset(env, url, p) {
  if (pzCache[p]) return pzCache[p];
  const r = await env.ASSETS.fetch(new Request(new URL(p, url.origin).toString()));
  if (!r.ok) return null;
  return (pzCache[p] = await r.json());
}
export async function dailyPuzzle(env, url, date) {
  try {
    const index = await asset(env, url, '/data/puzzles/index.json'); if (!index) return null;
    const bands = [2, 3, 4];
    const total = bands.reduce((a, x) => a + index.chunks[x].n, 0);
    let k = hash('kingside-daily-' + date) % total;
    for (const x of bands) {
      if (k < index.chunks[x].n) { const c = await asset(env, url, '/data/puzzles/' + index.chunks[x].f); const p = c && c[k]; return p ? { id: p[0], fen: p[1], moves: p[2].split(' ') } : null; }
      k -= index.chunks[x].n;
    }
  } catch (e) { return null; }
  return null;
}
// played = the player's own moves in order; each must be the puzzle's move, or a checkmate on the last one
export function checkSolution(pz, played) {
  const mine = pz.moves.filter((_, i) => i % 2 === 1);
  if (played.length !== mine.length) return false;
  const c = new Chess(pz.fen);
  try {
    for (let i = 0; i < pz.moves.length; i++) {
      const m = i % 2 === 1 ? played[(i - 1) / 2] : pz.moves[i];
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) return false;
      const ok = c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined });
      if (!ok) return false;
      if (i % 2 === 1 && m !== pz.moves[i] && !(i === pz.moves.length - 1 && c.isCheckmate())) return false;
    }
  } catch (e) { return false; }
  return true;
}
