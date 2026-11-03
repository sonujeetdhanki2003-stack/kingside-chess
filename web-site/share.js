// v1.7 Share your game: an animated GIF made right here in the browser (board + pieces in your theme, names, ratings,
// result) and a short link to a public replay page (/g/<id>) whose preview card looks good in WhatsApp.
// Phones use the native share sheet (Web Share API, or the Android app's own bridge); otherwise download + copy link.
import { Chess } from './vendor/chess.js';
import * as Crowns from './crowns.js';
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.js';
import { pieceUrl } from './board.js';

const $ = (id) => document.getElementById(id);
const W = 480, HEAD = 58, FOOT = 58, H = HEAD + W + FOOT, SQ = W / 8;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Devanagari", sans-serif';
let opts = { api: null, toast: () => {} };
let cur = null; // { info, gif: Blob, url, link, busy }
export function setup(o) { opts = { ...opts, ...o }; }

const imgCache = new Map();
function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + src)); i.src = src; });
  imgCache.set(src, p); return p;
}
function themeColors() {
  const cs = getComputedStyle(document.body);
  const pick = (v, d) => (cs.getPropertyValue(v) || '').trim() || d;
  return { light: pick('--light', '#ecedd1'), dark: pick('--dark', '#739552') };
}
const toHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : /^#[0-9a-f]{6}$/i.test(c) ? c : null; };
const resultWords = (info) => {
  const R = { checkmate: 'checkmate', resign: 'resignation', timeout: 'time', time: 'time', stalemate: 'stalemate', material: 'insufficient material', threefold: 'repetition', fifty: '50-move rule', agreed: 'agreement', abandon: 'abandonment' };
  const how = R[info.reason] ? ' by ' + R[info.reason] : '';
  if (info.result === '1-0') return `${info.white} wins${how}`;
  if (info.result === '0-1') return `${info.black} wins${how}`;
  if (info.result === '1/2-1/2') return `Draw${how}`;
  return 'Game in progress';
};

function drawBoard(ctx, x0, y0, size, g, last, pieces, col, flip) {
  const s = size / 8;
  const board = g.board();
  const checkSq = g.inCheck() ? (() => { for (const row of board) for (const p of row) if (p && p.type === 'k' && p.color === g.turn()) return p.square; })() : null;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f;
    const sq = 'abcdefgh'[ff] + (8 - rr);
    const x = x0 + f * s, y = y0 + r * s;
    ctx.fillStyle = (rr + ff) % 2 ? col.dark : col.light; ctx.fillRect(x, y, s, s);
    if (last && last.includes(sq)) { ctx.fillStyle = 'rgba(246,226,90,.55)'; ctx.fillRect(x, y, s, s); }
    if (sq === checkSq) { const gr = ctx.createRadialGradient(x + s / 2, y + s / 2, 2, x + s / 2, y + s / 2, s * 0.6); gr.addColorStop(0, 'rgba(255,40,30,1)'); gr.addColorStop(1, 'rgba(255,40,30,0)'); ctx.fillStyle = gr; ctx.fillRect(x, y, s, s); }
    const p = board[rr][ff];
    if (p) ctx.drawImage(pieces[p.color + p.type.toUpperCase()], x + s * 0.02, y + s * 0.02, s * 0.96, s * 0.96);
  }
}
function drawBar(ctx, y, h, name, rating, color, score, pieces) {
  ctx.fillStyle = '#262421'; ctx.fillRect(0, y, W, h);
  ctx.drawImage(pieces[color + 'K'], 10, y + (h - 38) / 2, 38, 38);
  ctx.fillStyle = '#ece8e1'; ctx.font = `700 21px ${FONT}`; ctx.textBaseline = 'middle';
  let nm = name; while (ctx.measureText(nm).width > W - 170 && nm.length > 3) nm = nm.slice(0, -2) + '…';
  ctx.fillText(nm, 58, y + h / 2);
  if (rating) { const wN = ctx.measureText(nm).width; ctx.font = `500 18px ${FONT}`; ctx.fillStyle = '#a8a6a3'; ctx.fillText(`(${rating})`, 58 + wN + 8, y + h / 2); }
  if (score !== null) { ctx.font = `800 24px ${FONT}`; ctx.fillStyle = score === '1' ? '#9bd25f' : '#a8a6a3'; ctx.textAlign = 'right'; ctx.fillText(score, W - 14, y + h / 2); ctx.textAlign = 'left'; }
}
function drawFrame(ctx, info, g, last, pieces, col, final) {
  const flip = info.orientation === 'b';
  const top = flip ? 'w' : 'b', bot = flip ? 'b' : 'w';
  const sc = (c) => (!final || info.result === '*' ? null : info.result === '1/2-1/2' ? '½' : (info.result === '1-0') === (c === 'w') ? '1' : '0');
  drawBar(ctx, 0, HEAD, top === 'w' ? info.white : info.black, top === 'w' ? info.wr : info.br, top, sc(top), pieces);
  drawBoard(ctx, 0, HEAD, W, g, last, pieces, col, flip);
  drawBar(ctx, HEAD + W, FOOT, bot === 'w' ? info.white : info.black, bot === 'w' ? info.wr : info.br, bot, sc(bot), pieces);
  ctx.font = `600 13px ${FONT}`; ctx.fillStyle = '#7d7a75'; ctx.textAlign = 'right'; ctx.fillText('♞ Kingside Chess', W - 14, HEAD + W + FOOT - 10); ctx.textAlign = 'left';
  if (final && info.result !== '*') {
    ctx.fillStyle = 'rgba(20,19,17,.82)'; ctx.fillRect(0, HEAD + W / 2 - 46, W, 92);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`;
    ctx.fillText(info.result === '1/2-1/2' ? '½ – ½' : info.result.replace('-', ' – '), W / 2, HEAD + W / 2 - 14);
    ctx.font = `600 18px ${FONT}`; ctx.fillStyle = '#cfe8b4'; ctx.fillText(resultWords(info), W / 2, HEAD + W / 2 + 20); ctx.textAlign = 'left';
  }
}
async function loadPieces() {
  const out = {};
  await Promise.all(['w', 'b'].flatMap((c) => ['K', 'Q', 'R', 'B', 'N', 'P'].map(async (t) => { out[c + t] = await loadImg(pieceUrl(c + t)); })));
  return out;
}
// plies -> frame delays: ~0.75 s per move for short games, faster for long ones; very long games show the last 150 plies
export function plan(n) {
  const start = n > 150 ? n - 150 : 0;
  const per = n - start <= 60 ? 750 : n - start <= 110 ? 600 : 480;
  return { start, per };
}
export async function makeGif(info, onProgress = () => {}) {
  const moves = info.moves;
  const pieces = await loadPieces();
  const col = info.col || themeColors();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const g = new Chess(); const lasts = [null], fens = [g.fen()];
  for (const m of moves) { const r = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined }); lasts.push([r.from, r.to]); fens.push(g.fen()); }
  const { start, per } = plan(moves.length);
  // palette from the first and last frames (the same pieces and squares appear throughout), one index kept for "unchanged"
  const sample = [];
  for (const k of [start, fens.length - 1]) { const gg = new Chess(fens[k]); drawFrame(ctx, info, gg, lasts[k], pieces, col, k === fens.length - 1); sample.push(ctx.getImageData(0, 0, W, H).data); }
  const both = new Uint8ClampedArray(sample[0].length * 2); both.set(sample[0]); both.set(sample[1], sample[0].length);
  const palette = quantize(both, 255); while (palette.length < 255) palette.push([0, 0, 0]);
  palette.push([255, 0, 255]); const TR = 255;
  const enc = GIFEncoder();
  let prev = null;
  const total = fens.length - start;
  for (let k = start; k < fens.length; k++) {
    const final = k === fens.length - 1;
    drawFrame(ctx, info, new Chess(fens[k]), lasts[k], pieces, col, final);
    const idx = applyPalette(ctx.getImageData(0, 0, W, H).data, palette);
    const delay = k === start ? 1100 : final ? 3500 : per;
    if (!prev) enc.writeFrame(idx, W, H, { palette, delay, repeat: 0 });
    else {
      const d = new Uint8Array(idx.length);
      for (let i = 0; i < idx.length; i++) d[i] = idx[i] === prev[i] ? TR : idx[i];
      enc.writeFrame(d, W, H, { delay, transparent: true, transparentIndex: TR, dispose: 1 });
    }
    prev = idx;
    if ((k - start) % 6 === 5) { onProgress((k - start + 1) / total); await new Promise((r) => setTimeout(r, 0)); }
  }
  enc.finish();
  onProgress(1);
  return new Blob([enc.bytes()], { type: 'image/gif' });
}
// 1200x630 preview image for the link card (final position + names + result)
export async function makeOg(info) {
  const pieces = await loadPieces(); const col = info.col || themeColors();
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 630; const ctx = cv.getContext('2d');
  const gr = ctx.createLinearGradient(0, 0, 1200, 630); gr.addColorStop(0, '#2b2926'); gr.addColorStop(1, '#1a1917'); ctx.fillStyle = gr; ctx.fillRect(0, 0, 1200, 630);
  const g = new Chess(); let last = null;
  for (const m of info.moves) { const r = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || undefined }); last = [r.from, r.to]; }
  drawBoard(ctx, 35, 35, 560, g, last, pieces, col, info.orientation === 'b');
  ctx.fillStyle = '#81b64c'; ctx.font = `800 30px ${FONT}`; ctx.fillText('♞ Kingside Chess', 640, 90);
  const line = (txt, y, size, color, weight = 700) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; let t = txt; while (ctx.measureText(t).width > 520 && t.length > 3) t = t.slice(0, -2) + '…'; ctx.fillText(t, 640, y); };
  line(`⬜ ${info.white}${info.wr ? ' (' + info.wr + ')' : ''}`, 190, 40, '#ece8e1');
  line('vs', 250, 28, '#8b8781', 600);
  line(`⬛ ${info.black}${info.br ? ' (' + info.br + ')' : ''}`, 310, 40, '#ece8e1');
  line(info.result === '1/2-1/2' ? '½ – ½' : info.result.replace('-', ' – '), 410, 64, '#fff', 800);
  line(resultWords(info), 465, 30, '#cfe8b4', 600);
  line(`${Math.ceil(info.moves.length / 2)} moves${info.opening ? ' · ' + info.opening : ''}`, 515, 26, '#a8a6a3', 500);
  ctx.fillStyle = '#81b64c'; roundRect(ctx, 640, 545, 330, 56, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `800 26px ${FONT}`; ctx.fillText('▶ Watch the replay', 662, 582);
  return cv.toDataURL('image/jpeg', 0.84);
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

const blobToB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });
const fileName = (info) => `kingside-${(info.white + '-vs-' + info.black).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase() || 'game'}.gif`;
const shareText = (info) => `♟️ ${info.white}${info.wr ? ' (' + info.wr + ')' : ''} vs ${info.black}${info.br ? ' (' + info.br + ')' : ''}: ${info.result === '1/2-1/2' ? '½-½' : info.result}. ${resultWords(info)}.`;
const N = () => window.KingsideNative || null;

export async function open(info) {
  if (!info || !info.moves || info.moves.length < 1) { opts.toast('Play at least one move to share a game'); return; }
  cur = { info, gif: null, link: null };
  const me = cur;
  $('share-img').hidden = true; $('share-wait').hidden = false; $('share-progress').textContent = 'Making your GIF…';
  ['share-gif', 'share-save', 'share-wa', 'share-copy'].forEach((id) => ($(id).disabled = true));
  $('share-link').textContent = ''; $('share-info').textContent = `${info.white} vs ${info.black} · ${Math.ceil(info.moves.length / 2)} moves`;
  $('sheet-share').hidden = false;
  const col = themeColors(); info.col = col;
  // link (needs internet) and GIF (offline) run side by side
  (async () => {
    try {
      const img = await makeOg(info);
      const d = await opts.api('share', { body: { moves: info.moves.join(' '), white: info.white, black: info.black, wr: info.wr || '', br: info.br || '', result: info.result, reason: info.reason || '',
        opening: info.opening || '', source: info.source || '', tc: info.tc || '', light: toHex(col.light), dark: toHex(col.dark), set: document.body.dataset.pieces || 'classic', img }, timeout: 20000 });
      if (cur !== me) return;
      me.link = d.url; me.id = d.id; $('share-link').textContent = d.url; $('share-wa').disabled = false; $('share-copy').disabled = false;
    } catch (e) { if (cur === me) $('share-link').textContent = 'The replay link needs internet. The GIF works offline.'; }
  })();
  try {
    const t0 = performance.now();
    me.gif = await makeGif(info, (p) => { if (cur === me) $('share-progress').textContent = `Making your GIF… ${Math.round(p * 100)}%`; });
    if (cur !== me) return;
    const url = URL.createObjectURL(me.gif); me.url = url;
    $('share-img').src = url; $('share-img').hidden = false; $('share-wait').hidden = true;
    $('share-gif').disabled = false; $('share-save').disabled = false;
    $('share-info').textContent = `${info.white} vs ${info.black} · ${Math.ceil(info.moves.length / 2)} moves · GIF ${Math.max(1, Math.round(me.gif.size / 1024))} KB`;
    window.__kingsideLastGif = { size: me.gif.size, ms: Math.round(performance.now() - t0), url };
  } catch (e) { $('share-progress').textContent = 'Could not make the GIF on this device.'; }
}
async function shareGif() {
  if (!cur || !cur.gif) return;
  credit();
  const text = shareText(cur.info) + (cur.link ? ' ' + cur.link : '');
  const n = N();
  if (n && n.shareFile) { n.shareFile(await blobToB64(cur.gif), 'image/gif', fileName(cur.info), text); return; }
  const file = new File([cur.gif], fileName(cur.info), { type: 'image/gif' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text, title: 'Kingside Chess' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  await saveGif(); if (cur.link) copyLink(true);
}
async function saveGif() {
  if (!cur || !cur.gif) return;
  const n = N();
  if (n && n.saveFile) { n.saveFile(await blobToB64(cur.gif), 'image/gif', fileName(cur.info)); return; }
  const a = document.createElement('a'); a.href = cur.url; a.download = fileName(cur.info); document.body.appendChild(a); a.click(); a.remove();
  opts.toast('GIF saved to your downloads');
}
// v1.8: the first time you really share a game (link copied, WhatsApp, GIF shared): +20 Crowns, once
function credit() { if (cur && cur.id && !cur.credited) { cur.credited = true; Crowns.shared(cur.id); } }
async function copyLink(quietAfterSave) {
  if (!cur || !cur.link) return;
  credit();
  try { await navigator.clipboard.writeText(cur.link); opts.toast(quietAfterSave ? 'GIF downloaded · link copied' : 'Link copied'); }
  catch (e) { window.prompt('Copy this link:', cur.link); }
}
function whatsapp() {
  if (!cur || !cur.link) return;
  credit();
  const text = shareText(cur.info) + ' Watch the replay: ' + cur.link;
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  const n = N();
  if (n && n.open) { n.open(url); return; }
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}
export function wire() {
  $('share-gif').onclick = shareGif; $('share-save').onclick = saveGif; $('share-copy').onclick = () => copyLink(false); $('share-wa').onclick = whatsapp;
  $('share-close').onclick = () => { $('sheet-share').hidden = true; };
}
window.__kingsideShare = { makeGif, makeOg, plan, open };
