// v1.7 Share your game: a stored copy of a finished game (any mode) behind a short link /g/<id>,
// with a replay page whose Open Graph tags + preview image make it look good in WhatsApp.
import { Chess } from '../site/vendor/chess.js';

const ID_ABC = 'abcdefghijkmnpqrstuvwxyz23456789';
const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((x) => ID_ABC[x % ID_ABC.length]).join('');
const clean = (s, n = 24) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexOk = (s) => (/^#[0-9a-fA-F]{6}$/.test(s || '') ? s : null);
const SETS = ['classic', 'merida', 'chessnut', 'fantasy', 'spatial'];
const REASONS = { checkmate: 'checkmate', resign: 'resignation', resigned: 'resignation', timeout: 'time', time: 'time', flag: 'time', stalemate: 'stalemate', material: 'insufficient material', threefold: 'repetition', fifty: 'the 50-move rule', agreed: 'agreement', draw: 'agreement', abandon: 'abandonment', admin: "the organizer's decision" };

function b64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function validShare(b) {
  const moves = String(b.moves || '').trim();
  if (!/^([a-h][1-8][a-h][1-8][qrbn]?)( [a-h][1-8][a-h][1-8][qrbn]?)*$/.test(moves) || moves.length > 4000) return null;
  const c = new Chess();
  for (const m of moves.split(' ')) { try { if (!c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined })) return null; } catch (e) { return null; } }
  return {
    v: 1, moves, white: clean(b.white) || 'White', black: clean(b.black) || 'Black',
    wr: clean(b.wr, 6), br: clean(b.br, 6),
    result: ['1-0', '0-1', '1/2-1/2', '*'].includes(b.result) ? b.result : '*',
    reason: Object.prototype.hasOwnProperty.call(REASONS, b.reason) ? b.reason : '',
    opening: clean(b.opening, 60), source: ['ai', 'pvp', 'online', 'quick', 'tournament', 'bot'].includes(b.source) ? b.source : 'online',
    tc: clean(b.tc, 8), light: hexOk(b.light), dark: hexOk(b.dark), set: SETS.includes(b.set) ? b.set : 'classic', t: Date.now(),
  };
}
export function shareTitle(d) {
  const nm = (n, r) => (r ? `${n} (${r})` : n);
  const res = d.result === '1/2-1/2' ? '½-½' : d.result;
  return `${nm(d.white, d.wr)} vs ${nm(d.black, d.br)} · ${res}`;
}
export function shareDesc(d) {
  const n = Math.ceil(d.moves.split(' ').length / 2);
  const who = d.result === '1-0' ? `${d.white} won` : d.result === '0-1' ? `${d.black} won` : d.result === '1/2-1/2' ? 'Draw' : 'Unfinished game';
  const how = d.reason && REASONS[d.reason] ? ` by ${REASONS[d.reason]}` : '';
  return `${who}${how} in ${n} move${n === 1 ? '' : 's'}${d.opening ? ' · ' + d.opening : ''}. Watch the replay and play free on Kingside Chess.`;
}

export async function shareApi(req, env, url, path, ctx) {
  const db = env.DB; const { json, err, body } = ctx;
  if (path === 'share' && req.method === 'POST') {
    const b = await body(req);
    const d = validShare(b);
    if (!d) return err('bad_game', 'That game could not be shared.');
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    const n = await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE ip = ? AND t > ?').bind(ip, Date.now() - 3600e3).first();
    if (n && n.n >= 60) return err('slow_down', 'Too many shares from this network. Try again in a while.', 429);
    let img = null;
    if (typeof b.img === 'string' && b.img.length < 400000) {
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(b.img);
      if (m) {
        const bytes = b64ToBytes(m[2]);
        const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes[0] === 0x89 && bytes[1] === 0x50;
        if ((jpeg || png) && bytes.length < 280000) { img = bytes; d.imgType = jpeg ? 'jpeg' : 'png'; }
      }
    }
    // the same game shared twice from the same network gets the same link
    // (compared here, not with LIKE: D1 caps LIKE patterns at 50 bytes)
    const recent = await db.prepare('SELECT id, data FROM shares WHERE ip = ? AND t > ? ORDER BY t DESC LIMIT 80').bind(ip, Date.now() - 86400e3).all();
    const dupe = (recent.results || []).find((row) => { try { return JSON.parse(row.data).moves === d.moves; } catch (e) { return false; } });
    if (dupe) {
      if (img) await db.prepare('UPDATE shares SET img = ? WHERE id = ?').bind(img, dupe.id).run();
      return json({ ok: true, id: dupe.id, url: `${url.origin}/g/${dupe.id}` });
    }
    for (let i = 0; i < 5; i++) {
      const id = newId();
      const r = await db.prepare('INSERT OR IGNORE INTO shares (id, data, img, ip, t) VALUES (?, ?, ?, ?, ?)').bind(id, JSON.stringify(d), img, ip, d.t).run();
      if (r.meta && r.meta.changes === 1) return json({ ok: true, id, url: `${url.origin}/g/${id}` });
    }
    return err('busy', 'Could not share right now, try again.', 500);
  }
  if (path === 'share' && req.method === 'GET') {
    const row = await db.prepare('SELECT data FROM shares WHERE id = ?').bind(String(url.searchParams.get('id') || '').slice(0, 12)).first();
    if (!row) return err('no_game', 'That shared game was not found.', 404);
    return json({ ok: true, game: JSON.parse(row.data) });
  }
  return null;
}

// GET /g/<id> (page) and /g/<id>.jpg (preview image)
export async function sharePage(req, env, url) {
  const m = /^\/g\/([a-z0-9]{4,12})(\.jpg|\.png)?\/?$/.exec(url.pathname);
  if (!m) return null;
  const db = env.DB;
  const row = await db.prepare('SELECT data, img FROM shares WHERE id = ?').bind(m[1]).first().catch(() => null);
  if (m[2]) {
    if (!row || !row.img) return env.ASSETS.fetch(new Request(url.origin + '/og.png'));
    const bytes = row.img instanceof ArrayBuffer ? new Uint8Array(row.img) : Array.isArray(row.img) ? new Uint8Array(row.img) : row.img;
    const d = JSON.parse(row.data);
    return new Response(bytes, { headers: { 'content-type': 'image/' + (d.imgType || 'jpeg'), 'cache-control': 'public, max-age=86400' } });
  }
  if (!row) return new Response(notFound(url), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  db.prepare('UPDATE shares SET views = views + 1 WHERE id = ?').bind(m[1]).run().catch(() => {});
  const d = JSON.parse(row.data);
  const img = row.img ? `${url.origin}/g/${m[1]}.${d.imgType === 'png' ? 'png' : 'jpg'}` : `${url.origin}/og.png`;
  return new Response(replayHtml(d, m[1], url.origin, img, !!row.img), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
function notFound(url) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game not found · Kingside Chess</title>
<body style="background:#262421;color:#eee;font:16px system-ui;text-align:center;padding:60px 20px"><h1>Game not found</h1><p>This shared game link does not exist.</p><p><a style="color:#9bc35c" href="${url.origin}/">Play Kingside Chess</a></p></body>`;
}
function replayHtml(d, id, origin, img, ownImg) {
  const title = shareTitle(d), desc = shareDesc(d);
  const light = d.light || '#eeeed2', dark = d.dark || '#769656';
  const setPath = d.set && d.set !== 'classic' ? `pieces/${d.set}/` : 'pieces/';
  const data = JSON.stringify({ moves: d.moves, white: d.white, black: d.black, wr: d.wr, br: d.br, result: d.result, set: setPath }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · Kingside Chess</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kingside Chess">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/g/${id}">
<meta property="og:image" content="${img}">
${ownImg ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ''}
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${img}">
<meta name="theme-color" content="#262421">
<link rel="icon" href="${origin}/icon-192.png">
<style>
*{box-sizing:border-box}body{margin:0;background:#262421;color:#e8e6e3;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari",sans-serif}
.w{max-width:520px;margin:0 auto;padding:14px 12px 30px}
.top{display:flex;align-items:center;gap:10px;margin-bottom:10px}.top img{width:34px;height:34px;border-radius:8px}.top b{font-size:17px}.top small{display:block;color:#a7a39d}
.pl{display:flex;justify-content:space-between;align-items:center;background:#1f1e1b;padding:8px 10px;border-radius:8px;margin:6px 0;font-weight:600}
.pl small{color:#a7a39d;font-weight:500;margin-left:6px}.pl .res{color:#9bc35c}
.bd{position:relative;width:100%;aspect-ratio:1;border-radius:6px;overflow:hidden;display:grid;grid-template-columns:repeat(8,1fr);box-shadow:0 4px 18px #0006}
.sq{position:relative}.sq.l{background:${light}}.sq.d{background:${dark}}.sq.hl::after{content:"";position:absolute;inset:0;background:#f6f66980}
.sq img{position:absolute;inset:0;width:100%;height:100%}
.ctl{display:flex;gap:6px;margin:10px 0}.ctl button{flex:1;background:#3a3835;border:0;color:#fff;font-size:20px;padding:10px 0;border-radius:8px}
.ctl button.on{background:#81b64c}
.mv{background:#1f1e1b;border-radius:8px;padding:8px 10px;max-height:150px;overflow:auto;font-size:14px;line-height:1.9}
.mv span{padding:2px 4px;border-radius:4px;cursor:pointer}.mv span.c{background:#81b64c;color:#fff}.mv i{color:#8b8781;font-style:normal;margin-left:4px}
.cta{display:block;text-align:center;background:#81b64c;color:#fff;font-weight:700;font-size:18px;padding:14px;border-radius:10px;margin-top:14px;text-decoration:none;box-shadow:0 4px 0 #5d8c34}
.cta2{display:block;text-align:center;color:#c8c4bd;margin-top:12px}
.meta{color:#a7a39d;text-align:center;margin-top:8px;font-size:14px}
</style></head>
<body><div class="w">
<div class="top"><img src="/icon-192.png" alt=""><div><b>Kingside Chess</b><small>Shared game replay</small></div></div>
<div class="pl" id="ptop"></div>
<div class="bd" id="bd" aria-label="Chess board"></div>
<div class="pl" id="pbot"></div>
<div class="ctl"><button id="f" aria-label="Start">⏮</button><button id="p" aria-label="Back">◀</button><button id="a" aria-label="Play" class="on">⏸</button><button id="n" aria-label="Forward">▶</button><button id="l" aria-label="End">⏭</button></div>
<div class="meta">${esc(desc)}</div>
<div class="mv" id="mv"></div>
<a class="cta" href="${origin}/?g=${id}">♟️ Analyse this game in Kingside</a>
<a class="cta2" href="${origin}/">Play free: Stockfish bots, friends, puzzles, lessons (English + हिंदी)</a>
<a class="cta2" href="https://kingside-chess-app.sites.tab.bot/">Get the Android / Windows app</a>
</div>
<script type="module">
import { Chess } from '/vendor/chess.js';
const D = ${data};
const c = new Chess(); const fens = [c.fen()], sans = [], last = [null];
for (const m of D.moves.split(' ')) { const r = c.move({ from: m.slice(0,2), to: m.slice(2,4), promotion: m[4] || undefined }); sans.push(r.san); fens.push(c.fen()); last.push([r.from, r.to]); }
let i = fens.length - 1, timer = null;
const bd = document.getElementById('bd'), mv = document.getElementById('mv');
const lab = (n, r) => n + (r ? ' <small>' + r + '</small>' : '');
const res = D.result === '1/2-1/2' ? '½-½' : D.result;
const esc = (s) => String(s).replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
document.getElementById('ptop').innerHTML = '<span>⬛ ' + lab(esc(D.black), esc(D.br)) + '</span><span class="res">' + (D.result === '0-1' ? '1' : D.result === '1-0' ? '0' : D.result === '*' ? '' : '½') + '</span>';
document.getElementById('pbot').innerHTML = '<span>⬜ ' + lab(esc(D.white), esc(D.wr)) + '</span><span class="res">' + (D.result === '1-0' ? '1' : D.result === '0-1' ? '0' : D.result === '*' ? '' : '½') + '</span>';
let html = ''; for (let k = 0; k < sans.length; k++) html += (k % 2 ? '' : '<i>' + (k / 2 + 1) + '.</i>') + '<span data-k="' + (k + 1) + '">' + sans[k] + '</span> ';
mv.innerHTML = html + (D.result !== '*' ? ' <b>' + res + '</b>' : '');
function draw() {
  const g = new Chess(fens[i]); const b = g.board(); const lm = last[i] || [];
  let h = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = b[r][f], sq = 'abcdefgh'[f] + (8 - r);
    h += '<div class="sq ' + ((r + f) % 2 ? 'd' : 'l') + (lm.includes(sq) ? ' hl' : '') + '">' + (p ? '<img alt="" src="/' + D.set + p.color + p.type.toUpperCase() + '.svg">' : '') + '</div>';
  }
  bd.innerHTML = h;
  mv.querySelectorAll('span').forEach((s) => s.classList.toggle('c', +s.dataset.k === i));
  const cur = mv.querySelector('span.c'); if (cur) cur.scrollIntoView({ block: 'nearest' });
}
const go = (k) => { i = Math.max(0, Math.min(fens.length - 1, k)); draw(); };
const stop = () => { clearInterval(timer); timer = null; document.getElementById('a').textContent = '▶️'; document.getElementById('a').classList.remove('on'); };
const play = () => { if (i >= fens.length - 1) i = 0; draw(); timer = setInterval(() => { if (i >= fens.length - 1) return stop(); go(i + 1); }, 800); document.getElementById('a').textContent = '⏸'; document.getElementById('a').classList.add('on'); };
document.getElementById('f').onclick = () => { stop(); go(0); };
document.getElementById('p').onclick = () => { stop(); go(i - 1); };
document.getElementById('n').onclick = () => { stop(); go(i + 1); };
document.getElementById('l').onclick = () => { stop(); go(fens.length - 1); };
document.getElementById('a').onclick = () => (timer ? stop() : play());
mv.onclick = (e) => { const k = e.target.dataset && e.target.dataset.k; if (k) { stop(); go(+k); } };
i = 0; play();
</script>
</body></html>`;
}
